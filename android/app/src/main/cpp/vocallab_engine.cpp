#include <android/log.h>
#include <jni.h>
#include <oboe/Oboe.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <ctime>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

#include "poly_synth.h"
#include "drum_synth.h"
#include "yin_detector.h"

#define LOG_TAG "VocalLabAudio"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

double monotonicSeconds() {
    struct timespec ts {};
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return static_cast<double>(ts.tv_sec) + static_cast<double>(ts.tv_nsec) * 1e-9;
}

class VocalLabEngine : public oboe::AudioStreamDataCallback,
                       public oboe::AudioStreamErrorCallback {
public:
    static constexpr size_t kRingSize = 8192;
    static constexpr size_t kWindowSize = 2048;

    void setJavaCallback(JavaVM* vm, jobject pluginGlobalRef, jmethodID onPitchMethod) {
        std::lock_guard<std::mutex> lock(cbMutex_);
        javaVm_ = vm;
        pluginRef_ = pluginGlobalRef;
        onPitchMethod_ = onPitchMethod;
    }

    bool startCapture(double minHz, double maxHz) {
        std::lock_guard<std::mutex> lock(streamMutex_);
        minHz_.store(minHz > 20.0 ? minHz : 60.0);
        maxHz_.store(maxHz > 200.0 ? maxHz : 1250.0);

        if (captureRunning_.load()) {
            return true;
        }

        writeCount_.store(0, std::memory_order_release);
        ring_.fill(0.0f);

        const oboe::InputPreset presets[] = {
            oboe::InputPreset::Unprocessed,
            oboe::InputPreset::VoiceRecognition,
            oboe::InputPreset::Generic,
        };

        oboe::Result result = oboe::Result::ErrorUnavailable;
        for (auto preset : presets) {
            oboe::AudioStreamBuilder builder;
            builder.setDirection(oboe::Direction::Input)
                ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
                ->setSharingMode(oboe::SharingMode::Exclusive)
                ->setFormat(oboe::AudioFormat::Float)
                ->setChannelCount(oboe::ChannelCount::Mono)
                ->setInputPreset(preset)
                ->setDataCallback(&inputCallback_)
                ->setErrorCallback(this);

            result = builder.openStream(inputStream_);
            if (result != oboe::Result::OK) {
                builder.setSharingMode(oboe::SharingMode::Shared);
                result = builder.openStream(inputStream_);
            }
            if (result == oboe::Result::OK && inputStream_) {
                LOGI("Opened Oboe input stream preset=%d sr=%d framesPerBurst=%d",
                     static_cast<int>(preset),
                     inputStream_->getSampleRate(),
                     inputStream_->getFramesPerBurst());
                break;
            }
        }

        if (result != oboe::Result::OK || !inputStream_) {
            LOGE("Failed to open Oboe input stream: %s", oboe::convertToText(result));
            return false;
        }

        inputSampleRate_.store(inputStream_->getSampleRate());
        result = inputStream_->requestStart();
        if (result != oboe::Result::OK) {
            LOGE("Failed to start Oboe input stream: %s", oboe::convertToText(result));
            inputStream_->close();
            inputStream_.reset();
            return false;
        }

        captureRunning_.store(true);
        dspThread_ = std::thread([this]() { dspLoop(); });
        return true;
    }

    void stopCapture() {
        {
            std::lock_guard<std::mutex> lock(streamMutex_);
            captureRunning_.store(false);
            if (inputStream_) {
                inputStream_->requestStop();
                inputStream_->close();
                inputStream_.reset();
            }
        }
        if (dspThread_.joinable()) {
            dspThread_.join();
        }
    }

    bool ensureOutputStream() {
        std::lock_guard<std::mutex> lock(outMutex_);
        if (outputStream_ && outputStream_->getState() == oboe::StreamState::Started) {
            return true;
        }
        if (outputStream_) {
            outputStream_->close();
            outputStream_.reset();
        }

        oboe::AudioStreamBuilder builder;
        builder.setDirection(oboe::Direction::Output)
            ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
            ->setSharingMode(oboe::SharingMode::Shared)
            ->setFormat(oboe::AudioFormat::Float)
            ->setChannelCount(oboe::ChannelCount::Stereo)
            ->setUsage(oboe::Usage::Media)
            ->setContentType(oboe::ContentType::Music)
            ->setDataCallback(this)
            ->setErrorCallback(this);

        oboe::Result result = builder.openStream(outputStream_);
        if (result != oboe::Result::OK || !outputStream_) {
            LOGE("Failed to open Oboe output stream: %s", oboe::convertToText(result));
            return false;
        }

        outputStream_->setBufferSizeInFrames(outputStream_->getFramesPerBurst() * 2);
        result = outputStream_->requestStart();
        if (result != oboe::Result::OK) {
            LOGE("Failed to start Oboe output stream: %s", oboe::convertToText(result));
            outputStream_->close();
            outputStream_.reset();
            return false;
        }

        LOGI("Started Oboe output stream sr=%d framesPerBurst=%d",
             outputStream_->getSampleRate(),
             outputStream_->getFramesPerBurst());
        return true;
    }

    void stopOutputStream() {
        std::lock_guard<std::mutex> lock(outMutex_);
        if (outputStream_) {
            outputStream_->requestStop();
            outputStream_->close();
            outputStream_.reset();
        }
    }

    void pushSynthCommand(const vocallab::SynthCommand& cmd) {
        if (cmd.type == vocallab::SynthCmdType::NoteOn ||
            cmd.type == vocallab::SynthCmdType::ScheduleNote) {
            ensureOutputStream();
        }
        synth_.enqueue(cmd);
    }

    void pushDrumCommand(const vocallab::DrumCommand& cmd) {
        if (cmd.type == vocallab::DrumCmdType::ScheduleHit) {
            ensureOutputStream();
        }
        drumSynth_.enqueue(cmd);
    }

    // Oboe Output Callback (Real-Time Audio Thread)
    oboe::DataCallbackResult onAudioReady(oboe::AudioStream* stream,
                                          void* audioData,
                                          int32_t numFrames) override {
        auto* out = static_cast<float*>(audioData);
        const double blockNow = monotonicSeconds();
        const int32_t ch = stream->getChannelCount();
        const int32_t sr = stream->getSampleRate();
        synth_.render(out, numFrames, ch, sr, blockNow);
        drumSynth_.renderAdd(out, numFrames, ch, sr, blockNow);
        return oboe::DataCallbackResult::Continue;
    }

    void onErrorAfterClose(oboe::AudioStream* stream, oboe::Result error) override {
        LOGE("Oboe stream error after close: %s", oboe::convertToText(error));
        if (stream && stream->getDirection() == oboe::Direction::Output) {
            ensureOutputStream();
        }
    }

private:
    class InputCallback : public oboe::AudioStreamDataCallback {
    public:
        explicit InputCallback(VocalLabEngine* owner) : owner_(owner) {}

        oboe::DataCallbackResult onAudioReady(oboe::AudioStream* /*stream*/,
                                              void* audioData,
                                              int32_t numFrames) override {
            const auto* in = static_cast<const float*>(audioData);
            owner_->writeInputSamples(in, static_cast<size_t>(numFrames));
            return oboe::DataCallbackResult::Continue;
        }

    private:
        VocalLabEngine* owner_;
    };

    void writeInputSamples(const float* samples, size_t count) {
        uint64_t pos = writeCount_.load(std::memory_order_relaxed);
        for (size_t i = 0; i < count; ++i) {
            ring_[pos & (kRingSize - 1)] = samples[i];
            ++pos;
        }
        lastWriteClockSec_.store(monotonicSeconds(), std::memory_order_relaxed);
        writeCount_.store(pos, std::memory_order_release);
    }

    void dspLoop() {
        JNIEnv* env = nullptr;
        bool attached = false;
        {
            std::lock_guard<std::mutex> lock(cbMutex_);
            if (javaVm_ && javaVm_->AttachCurrentThread(&env, nullptr) == JNI_OK) {
                attached = true;
            }
        }

        vocallab::YinDetector detector(kWindowSize);
        std::array<float, kWindowSize> window{};

        while (captureRunning_.load()) {
            std::this_thread::sleep_for(std::chrono::milliseconds(28));
            if (!captureRunning_.load()) break;

            const uint64_t totalWritten = writeCount_.load(std::memory_order_acquire);
            if (totalWritten < kWindowSize) continue;

            const uint64_t startPos = totalWritten - kWindowSize;
            for (size_t i = 0; i < kWindowSize; ++i) {
                window[i] = ring_[(startPos + i) & (kRingSize - 1)];
            }

            const int sr = inputSampleRate_.load();
            const double captureEnd = lastWriteClockSec_.load(std::memory_order_relaxed);
            const double frameTime = captureEnd - (static_cast<double>(kWindowSize) * 0.5) / static_cast<double>(std::max(8000, sr));

            const auto res = detector.detect(
                window.data(),
                kWindowSize,
                sr,
                minHz_.load(),
                maxHz_.load());

            if (env && pluginRef_ && onPitchMethod_) {
                env->CallVoidMethod(
                    pluginRef_,
                    onPitchMethod_,
                    frameTime,
                    res.frequency,
                    res.clarity,
                    res.rms,
                    static_cast<jint>(sr));
                if (env->ExceptionCheck()) {
                    env->ExceptionClear();
                }
            }
        }

        if (attached && javaVm_) {
            javaVm_->DetachCurrentThread();
        }
    }

    InputCallback inputCallback_{this};
    std::shared_ptr<oboe::AudioStream> inputStream_;
    std::shared_ptr<oboe::AudioStream> outputStream_;
    std::mutex streamMutex_;
    std::mutex outMutex_;
    std::mutex cbMutex_;

    std::array<float, kRingSize> ring_{};
    std::atomic<uint64_t> writeCount_{0};
    std::atomic<double> lastWriteClockSec_{0.0};
    std::atomic<int> inputSampleRate_{48000};
    std::atomic<double> minHz_{60.0};
    std::atomic<double> maxHz_{1250.0};
    std::atomic<bool> captureRunning_{false};
    std::thread dspThread_;

    vocallab::PolySynth synth_;
    vocallab::DrumSynth drumSynth_;

    JavaVM* javaVm_{nullptr};
    jobject pluginRef_{nullptr};
    jmethodID onPitchMethod_{nullptr};
};

VocalLabEngine gEngine;

} // namespace

extern "C" {

JNIEXPORT void JNICALL
Java_com_vocallab_app_VocalLabAudioPlugin_nativeInit(JNIEnv* env, jobject thiz) {
    JavaVM* vm = nullptr;
    env->GetJavaVM(&vm);
    jobject globalRef = env->NewGlobalRef(thiz);
    jclass cls = env->GetObjectClass(thiz);
    jmethodID method = env->GetMethodID(cls, "onNativePitchFrame", "(DDDDI)V");
    gEngine.setJavaCallback(vm, globalRef, method);
}

JNIEXPORT jdouble JNICALL
Java_com_vocallab_app_VocalLabAudioPlugin_nativeGetClockTime(JNIEnv* /*env*/, jobject /*thiz*/) {
    return monotonicSeconds();
}

JNIEXPORT jboolean JNICALL
Java_com_vocallab_app_VocalLabAudioPlugin_nativeStartCapture(JNIEnv* /*env*/,
                                                             jobject /*thiz*/,
                                                             jdouble minHz,
                                                             jdouble maxHz) {
    return gEngine.startCapture(minHz, maxHz) ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_com_vocallab_app_VocalLabAudioPlugin_nativeStopCapture(JNIEnv* /*env*/, jobject /*thiz*/) {
    gEngine.stopCapture();
}

JNIEXPORT void JNICALL
Java_com_vocallab_app_VocalLabAudioPlugin_nativeNoteOn(JNIEnv* /*env*/,
                                                       jobject /*thiz*/,
                                                       jint midi,
                                                       jfloat velocity,
                                                       jboolean sustain,
                                                       jint timbre,
                                                       jdouble a4Hz) {
    vocallab::SynthCommand cmd;
    cmd.type = vocallab::SynthCmdType::NoteOn;
    cmd.midi = midi;
    cmd.velocity = velocity;
    cmd.sustain = (sustain == JNI_TRUE);
    cmd.timbre = timbre;
    cmd.a4Hz = a4Hz;
    gEngine.pushSynthCommand(cmd);
}

JNIEXPORT void JNICALL
Java_com_vocallab_app_VocalLabAudioPlugin_nativeNoteOff(JNIEnv* /*env*/,
                                                        jobject /*thiz*/,
                                                        jint midi,
                                                        jfloat releaseSec) {
    vocallab::SynthCommand cmd;
    cmd.type = vocallab::SynthCmdType::NoteOff;
    cmd.midi = midi;
    cmd.releaseSec = releaseSec;
    gEngine.pushSynthCommand(cmd);
}

JNIEXPORT void JNICALL
Java_com_vocallab_app_VocalLabAudioPlugin_nativeScheduleNote(JNIEnv* /*env*/,
                                                             jobject /*thiz*/,
                                                             jint id,
                                                             jint midi,
                                                             jdouble startClockSec,
                                                             jdouble durationSec,
                                                             jfloat velocity,
                                                             jint timbre,
                                                             jdouble a4Hz) {
    vocallab::SynthCommand cmd;
    cmd.type = vocallab::SynthCmdType::ScheduleNote;
    cmd.id = id;
    cmd.midi = midi;
    cmd.startClockSec = startClockSec;
    cmd.durationSec = durationSec;
    cmd.velocity = velocity;
    cmd.timbre = timbre;
    cmd.a4Hz = a4Hz;
    gEngine.pushSynthCommand(cmd);
}

JNIEXPORT void JNICALL
Java_com_vocallab_app_VocalLabAudioPlugin_nativeCancelScheduled(JNIEnv* /*env*/,
                                                                jobject /*thiz*/,
                                                                jint id) {
    vocallab::SynthCommand cmd;
    cmd.type = vocallab::SynthCmdType::CancelScheduled;
    cmd.id = id;
    gEngine.pushSynthCommand(cmd);
}

JNIEXPORT void JNICALL
Java_com_vocallab_app_VocalLabAudioPlugin_nativeStopAllNotes(JNIEnv* /*env*/, jobject /*thiz*/) {
    vocallab::SynthCommand cmd;
    cmd.type = vocallab::SynthCmdType::StopAll;
    gEngine.pushSynthCommand(cmd);
}

JNIEXPORT void JNICALL
Java_com_vocallab_app_VocalLabAudioPlugin_nativeSetSynthParams(JNIEnv* /*env*/,
                                                               jobject /*thiz*/,
                                                               jfloat volume,
                                                               jint timbre,
                                                               jdouble a4Hz) {
    vocallab::SynthCommand cmd;
    cmd.type = vocallab::SynthCmdType::SetParams;
    cmd.volume = volume;
    cmd.timbre = timbre;
    cmd.a4Hz = a4Hz;
    gEngine.pushSynthCommand(cmd);
}

JNIEXPORT void JNICALL
Java_com_vocallab_app_VocalLabAudioPlugin_nativeScheduleDrum(JNIEnv* /*env*/,
                                                             jobject /*thiz*/,
                                                             jint sound,
                                                             jdouble startClockSec,
                                                             jint velocityLevel,
                                                             jfloat volume) {
    vocallab::DrumCommand cmd;
    cmd.type = vocallab::DrumCmdType::ScheduleHit;
    cmd.sound = sound;
    cmd.startClockSec = startClockSec;
    cmd.velocityLevel = velocityLevel;
    cmd.volume = volume;
    gEngine.pushDrumCommand(cmd);
}

JNIEXPORT void JNICALL
Java_com_vocallab_app_VocalLabAudioPlugin_nativeCancelScheduledDrums(JNIEnv* /*env*/,
                                                                     jobject /*thiz*/) {
    vocallab::DrumCommand cmd;
    cmd.type = vocallab::DrumCmdType::CancelAll;
    gEngine.pushDrumCommand(cmd);
}

JNIEXPORT void JNICALL
Java_com_vocallab_app_VocalLabAudioPlugin_nativeRelease(JNIEnv* /*env*/, jobject /*thiz*/) {
    gEngine.stopCapture();
    gEngine.stopOutputStream();
}

} // extern "C"
