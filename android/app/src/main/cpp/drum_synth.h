#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>

namespace vocallab {

enum class DrumSound : int32_t {
    Pulse = 0,
    Sub = 1,
    Kick = 2,
    Snare = 3,
    Hat = 4,
    Fill = 5,
};

enum class DrumCmdType : uint8_t {
    ScheduleHit = 1,
    CancelAll = 2,
};

struct DrumCommand {
    DrumCmdType type{DrumCmdType::CancelAll};
    int32_t sound{0};
    int32_t velocityLevel{1}; // 1=heavy, 2=medium, 3=light
    float volume{0.92f};
    double startClockSec{0.0};
};

template <size_t Capacity>
class LockFreeDrumQueue {
public:
    bool push(const DrumCommand& cmd) {
        const size_t head = head_.load(std::memory_order_relaxed);
        const size_t next = (head + 1) % Capacity;
        if (next == tail_.load(std::memory_order_acquire)) {
            return false;
        }
        buffer_[head] = cmd;
        head_.store(next, std::memory_order_release);
        return true;
    }

    bool pop(DrumCommand& out) {
        const size_t tail = tail_.load(std::memory_order_relaxed);
        if (tail == head_.load(std::memory_order_acquire)) {
            return false;
        }
        out = buffer_[tail];
        tail_.store((tail + 1) % Capacity, std::memory_order_release);
        return true;
    }

private:
    std::array<DrumCommand, Capacity> buffer_{};
    std::atomic<size_t> head_{0};
    std::atomic<size_t> tail_{0};
};

class DrumSynth {
public:
    static constexpr int kMaxVoices = 24;
    static constexpr int kMaxScheduled = 128;
    static constexpr double kTwoPi = 6.28318530717958647692;

    bool enqueue(const DrumCommand& cmd) {
        return queue_.push(cmd);
    }

    void renderAdd(float* output,
                   int32_t numFrames,
                   int32_t channels,
                   int32_t sampleRate,
                   double blockStartClockSec) {
        drainCommands();

        const double invSr = 1.0 / static_cast<double>(std::max(8000, sampleRate));
        const double blockEndClockSec = blockStartClockSec + static_cast<double>(numFrames) * invSr;

        // Trigger scheduled hits falling inside this audio block
        for (auto& ev : scheduled_) {
            if (!ev.active) continue;
            if (ev.startClockSec <= blockEndClockSec) {
                const int32_t offsetFrames = std::max<int32_t>(
                    0,
                    std::min<int32_t>(
                        numFrames - 1,
                        static_cast<int32_t>((ev.startClockSec - blockStartClockSec) * sampleRate)));
                triggerVoice(ev.sound, ev.velocityLevel, ev.volume, offsetFrames);
                ev.active = false;
            }
        }

        for (int32_t i = 0; i < numFrames; ++i) {
            float mix = 0.0f;
            for (auto& v : voices_) {
                if (!v.active) continue;
                if (v.delayFrames > 0) {
                    v.delayFrames--;
                    continue;
                }
                mix += stepVoice(v, invSr);
            }

            if (mix == 0.0f) continue;
            const float drumOut = std::tanh(mix * 1.08f) * 0.92f;
            if (channels == 2) {
                const float l = std::tanh(output[i * 2] + drumOut);
                const float r = std::tanh(output[i * 2 + 1] + drumOut);
                output[i * 2] = l;
                output[i * 2 + 1] = r;
            } else {
                for (int32_t c = 0; c < channels; ++c) {
                    output[i * channels + c] = std::tanh(output[i * channels + c] + drumOut);
                }
            }
        }
    }

private:
    struct Voice {
        bool active{false};
        int32_t sound{0};
        int32_t velocityLevel{1};
        int32_t delayFrames{0};
        float gain{1.0f};
        float rawVolume{1.0f};
        double ageSec{0.0};
        double phase{0.0};
        float prevNoise{0.0f};
        float lpState{0.0f};
        float hpState{0.0f};
    };

    struct ScheduledHit {
        bool active{false};
        int32_t sound{0};
        int32_t velocityLevel{1};
        float volume{0.92f};
        double startClockSec{0.0};
    };

    static float velocityGain(int32_t level) {
        if (level == 3) return 0.34f;
        if (level == 2) return 0.66f;
        return 1.0f;
    }

    float nextNoise() {
        uint32_t x = rngState_;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        rngState_ = x;
        return static_cast<float>(static_cast<int32_t>(x)) * (1.0f / 2147483648.0f);
    }

    void drainCommands() {
        DrumCommand cmd;
        while (queue_.pop(cmd)) {
            if (cmd.type == DrumCmdType::CancelAll) {
                for (auto& ev : scheduled_) ev.active = false;
            } else if (cmd.type == DrumCmdType::ScheduleHit) {
                addScheduled(cmd);
            }
        }
    }

    void addScheduled(const DrumCommand& cmd) {
        for (auto& ev : scheduled_) {
            if (!ev.active) {
                ev.active = true;
                ev.sound = cmd.sound;
                ev.velocityLevel = cmd.velocityLevel;
                ev.volume = std::max(0.0f, std::min(1.5f, cmd.volume));
                ev.startClockSec = cmd.startClockSec;
                return;
            }
        }
    }

    void triggerVoice(int32_t sound, int32_t velocityLevel, float volume, int32_t delayFrames) {
        Voice* slot = nullptr;
        for (auto& v : voices_) {
            if (!v.active) {
                slot = &v;
                break;
            }
        }
        if (!slot) {
            slot = &voices_[0];
            for (auto& v : voices_) {
                if (v.ageSec > slot->ageSec) slot = &v;
            }
        }
        slot->active = true;
        slot->sound = sound;
        slot->velocityLevel = velocityLevel;
        slot->delayFrames = delayFrames;
        slot->gain = velocityGain(velocityLevel) * volume;
        slot->rawVolume = volume;
        slot->ageSec = 0.0;
        slot->phase = 0.0;
        slot->prevNoise = 0.0f;
        slot->lpState = 0.0f;
        slot->hpState = 0.0f;
    }

    float stepVoice(Voice& v, double invSr) {
        const double t = v.ageSec;
        v.ageSec += invSr;

        switch (static_cast<DrumSound>(v.sound)) {
            case DrumSound::Pulse: {
                if (t > 0.055) { v.active = false; return 0.0f; }
                const double freq = v.velocityLevel == 3 ? 1980.0 : (v.velocityLevel == 2 ? 1560.0 : 1280.0);
                v.phase += kTwoPi * freq * invSr;
                const float attack = t < 0.002 ? static_cast<float>(t / 0.002) : 1.0f;
                const float decay = std::exp(-static_cast<float>(t) * 85.0f);
                const float pulseAmp = v.velocityLevel == 3 ? 1.0f : (v.velocityLevel == 2 ? 0.68f : 0.42f);
                return static_cast<float>(std::sin(v.phase)) * attack * decay * 0.52f * pulseAmp * v.rawVolume;
            }
            case DrumSound::Sub: {
                if (t > 0.036) { v.active = false; return 0.0f; }
                const double freq = 920.0;
                v.phase += kTwoPi * freq * invSr;
                const float attack = t < 0.002 ? static_cast<float>(t / 0.002) : 1.0f;
                const float decay = std::exp(-static_cast<float>(t) * 115.0f);
                return static_cast<float>(std::sin(v.phase)) * attack * decay * 0.24f * v.gain;
            }
            case DrumSound::Kick: {
                if (t > 0.22) { v.active = false; return 0.0f; }
                const double hi = v.velocityLevel == 3 ? 118.0 : (v.velocityLevel == 2 ? 138.0 : 165.0);
                const double lo = v.velocityLevel == 3 ? 52.0 : 44.0;
                const double freq = lo + (hi - lo) * std::exp(-t * 28.0);
                v.phase += kTwoPi * freq * invSr;
                const float attack = t < 0.004 ? static_cast<float>(t / 0.004) : 1.0f;
                const float decay = std::exp(-static_cast<float>(t) * 17.0f);
                return static_cast<float>(std::sin(v.phase)) * attack * decay * 1.15f * v.gain;
            }
            case DrumSound::Snare: {
                if (t > 0.16) { v.active = false; return 0.0f; }
                const float n = nextNoise();
                // Simple band-shaped noise
                v.hpState = 0.75f * (v.hpState + n - v.prevNoise);
                v.prevNoise = n;
                v.lpState += 0.35f * (v.hpState - v.lpState);
                const float noiseEnv = std::exp(-static_cast<float>(t) * 28.0f);

                const double bodyFreq = v.velocityLevel == 3 ? 235.0 : 195.0;
                v.phase += kTwoPi * bodyFreq * invSr;
                const float bodyEnv = std::exp(-static_cast<float>(t) * 42.0f);
                const float tri = static_cast<float>(std::sin(v.phase));
                return (v.lpState * noiseEnv * 0.95f + tri * bodyEnv * 0.42f) * v.gain;
            }
            case DrumSound::Hat: {
                const double maxDur = v.velocityLevel == 3 ? 0.035 : 0.06;
                if (t > maxDur) { v.active = false; return 0.0f; }
                const float n = nextNoise();
                const float hp = n - v.prevNoise;
                v.prevNoise = n;
                const float decayRate = v.velocityLevel == 3 ? 115.0f : 68.0f;
                const float env = std::exp(-static_cast<float>(t) * decayRate);
                return hp * env * 0.34f * v.gain;
            }
            case DrumSound::Fill: {
                if (t > 0.17) { v.active = false; return 0.0f; }
                const double hi = v.velocityLevel == 3 ? 260.0 : 330.0;
                const double lo = 105.0;
                const double freq = lo + (hi - lo) * std::exp(-t * 22.0);
                v.phase += kTwoPi * freq * invSr;
                const float attack = t < 0.004 ? static_cast<float>(t / 0.004) : 1.0f;
                const float decay = std::exp(-static_cast<float>(t) * 22.0f);
                return static_cast<float>(std::sin(v.phase)) * attack * decay * 0.85f * v.gain;
            }
        }
        v.active = false;
        return 0.0f;
    }

    std::array<Voice, kMaxVoices> voices_{};
    std::array<ScheduledHit, kMaxScheduled> scheduled_{};
    LockFreeDrumQueue<256> queue_{};
    uint32_t rngState_{0x9e3779b9u};
};

} // namespace vocallab
