#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>

namespace vocallab {

enum class SynthCmdType : uint8_t {
    NoteOn = 1,
    NoteOff = 2,
    ScheduleNote = 3,
    CancelScheduled = 4,
    StopAll = 5,
    SetParams = 6,
};

struct SynthCommand {
    SynthCmdType type{SynthCmdType::StopAll};
    int32_t id{0};
    int32_t midi{60};
    int32_t timbre{0}; // 0=piano, 1=rhodes, 2=sine
    float velocity{0.85f};
    float releaseSec{0.35f};
    float volume{0.76f};
    double a4Hz{440.0};
    double startClockSec{0.0};
    double durationSec{0.5};
    bool sustain{false};
};

template <size_t Capacity>
class LockFreeCmdQueue {
public:
    bool push(const SynthCommand& cmd) {
        const size_t head = head_.load(std::memory_order_relaxed);
        const size_t next = (head + 1) % Capacity;
        if (next == tail_.load(std::memory_order_acquire)) {
            return false;
        }
        buffer_[head] = cmd;
        head_.store(next, std::memory_order_release);
        return true;
    }

    bool pop(SynthCommand& out) {
        const size_t tail = tail_.load(std::memory_order_relaxed);
        if (tail == head_.load(std::memory_order_acquire)) {
            return false;
        }
        out = buffer_[tail];
        tail_.store((tail + 1) % Capacity, std::memory_order_release);
        return true;
    }

private:
    std::array<SynthCommand, Capacity> buffer_{};
    std::atomic<size_t> head_{0};
    std::atomic<size_t> tail_{0};
};

class PolySynth {
public:
    static constexpr int kMaxVoices = 16;
    static constexpr int kMaxScheduled = 128;
    static constexpr double kTwoPi = 6.28318530717958647692;

    bool enqueue(const SynthCommand& cmd) {
        return queue_.push(cmd);
    }

    void render(float* output,
                int32_t numFrames,
                int32_t channels,
                int32_t sampleRate,
                double blockStartClockSec) {
        drainCommands();

        const double invSr = 1.0 / static_cast<double>(std::max(8000, sampleRate));
        const double blockEndClockSec = blockStartClockSec + static_cast<double>(numFrames) * invSr;

        // Trigger scheduled notes that start within or before this block
        for (auto& ev : scheduled_) {
            if (!ev.active) continue;
            if (!ev.started && ev.startClockSec <= blockEndClockSec) {
                ev.started = true;
                startVoice(ev.midi, ev.velocity, false, ev.timbre, ev.id, ev.startClockSec + ev.durationSec);
            }
            if (ev.started && blockStartClockSec >= ev.startClockSec + ev.durationSec) {
                releaseScheduledVoice(ev.id, 0.14f);
                ev.active = false;
            }
        }

        for (int32_t i = 0; i < numFrames; ++i) {
            const double tNow = blockStartClockSec + static_cast<double>(i) * invSr;
            float mix = 0.0f;

            for (auto& v : voices_) {
                if (!v.active) continue;

                if (v.autoStopClockSec > 0.0 && !v.releasing && tNow >= v.autoStopClockSec) {
                    v.releasing = true;
                    v.releaseAgeSec = 0.0;
                    v.releaseStartAmp = v.currentAmp;
                    v.releaseDurSec = 0.14;
                }

                const float sample = stepVoice(v, invSr);
                mix += sample;
            }

            // Master volume & gentle soft clipper
            const float scaled = std::tanh(mix * volume_ * 1.32f) * 0.94f;
            if (channels == 2) {
                output[i * 2] = scaled;
                output[i * 2 + 1] = scaled;
            } else {
                for (int32_t c = 0; c < channels; ++c) {
                    output[i * channels + c] = scaled;
                }
            }
        }
    }

private:
    struct Voice {
        bool active{false};
        int32_t midi{60};
        int32_t timbre{0};
        int32_t scheduleId{0};
        bool sustain{false};
        bool releasing{false};
        float velocity{0.85f};
        double freq{261.625565};
        double phase{0.0};
        double ageSec{0.0};
        double releaseAgeSec{0.0};
        double releaseDurSec{0.35};
        float currentAmp{0.0f};
        float releaseStartAmp{0.0f};
        double autoStopClockSec{0.0};
    };

    struct ScheduledNote {
        bool active{false};
        bool started{false};
        int32_t id{0};
        int32_t midi{60};
        int32_t timbre{0};
        float velocity{0.82f};
        double startClockSec{0.0};
        double durationSec{0.5};
    };

    double midiToFreq(int32_t midi) const {
        return a4Hz_ * std::pow(2.0, (static_cast<double>(midi) - 69.0) / 12.0);
    }

    void drainCommands() {
        SynthCommand cmd;
        while (queue_.pop(cmd)) {
            switch (cmd.type) {
                case SynthCmdType::SetParams:
                    volume_ = std::max(0.0f, std::min(1.0f, cmd.volume));
                    defaultTimbre_ = cmd.timbre;
                    if (cmd.a4Hz >= 400.0 && cmd.a4Hz <= 480.0) {
                        a4Hz_ = cmd.a4Hz;
                    }
                    break;
                case SynthCmdType::NoteOn:
                    if (cmd.a4Hz >= 400.0 && cmd.a4Hz <= 480.0) {
                        a4Hz_ = cmd.a4Hz;
                    }
                    startVoice(cmd.midi, cmd.velocity, cmd.sustain, cmd.timbre, 0, 0.0);
                    break;
                case SynthCmdType::NoteOff:
                    releaseMidi(cmd.midi, cmd.releaseSec);
                    break;
                case SynthCmdType::ScheduleNote:
                    if (cmd.a4Hz >= 400.0 && cmd.a4Hz <= 480.0) {
                        a4Hz_ = cmd.a4Hz;
                    }
                    addScheduled(cmd);
                    break;
                case SynthCmdType::CancelScheduled:
                    cancelScheduled(cmd.id);
                    break;
                case SynthCmdType::StopAll:
                    for (auto& ev : scheduled_) ev.active = false;
                    for (auto& v : voices_) {
                        if (v.active && !v.releasing) {
                            v.releasing = true;
                            v.releaseAgeSec = 0.0;
                            v.releaseStartAmp = v.currentAmp;
                            v.releaseDurSec = 0.08;
                        }
                    }
                    break;
            }
        }
    }

    void addScheduled(const SynthCommand& cmd) {
        for (auto& ev : scheduled_) {
            if (!ev.active) {
                ev.active = true;
                ev.started = false;
                ev.id = cmd.id;
                ev.midi = cmd.midi;
                ev.timbre = cmd.timbre >= 0 ? cmd.timbre : defaultTimbre_;
                ev.velocity = cmd.velocity;
                ev.startClockSec = cmd.startClockSec;
                ev.durationSec = std::max(0.05, cmd.durationSec);
                return;
            }
        }
    }

    void cancelScheduled(int32_t id) {
        for (auto& ev : scheduled_) {
            if (ev.active && (id == 0 || ev.id == id)) {
                ev.active = false;
            }
        }
        for (auto& v : voices_) {
            if (v.active && v.scheduleId != 0 && (id == 0 || v.scheduleId == id)) {
                v.releasing = true;
                v.releaseAgeSec = 0.0;
                v.releaseStartAmp = v.currentAmp;
                v.releaseDurSec = 0.08;
            }
        }
    }

    void startVoice(int32_t midi,
                    float velocity,
                    bool sustain,
                    int32_t timbre,
                    int32_t scheduleId,
                    double autoStopClockSec) {
        // Retrigger existing voice for same live MIDI note to keep polyphony tidy
        Voice* slot = nullptr;
        if (scheduleId == 0) {
            for (auto& v : voices_) {
                if (v.active && v.scheduleId == 0 && v.midi == midi) {
                    slot = &v;
                    break;
                }
            }
        }
        if (!slot) {
            for (auto& v : voices_) {
                if (!v.active) {
                    slot = &v;
                    break;
                }
            }
        }
        if (!slot) {
            // Steal oldest voice
            slot = &voices_[0];
            for (auto& v : voices_) {
                if (v.ageSec > slot->ageSec) {
                    slot = &v;
                }
            }
        }

        slot->active = true;
        slot->midi = midi;
        slot->timbre = timbre >= 0 ? timbre : defaultTimbre_;
        slot->scheduleId = scheduleId;
        slot->sustain = sustain;
        slot->releasing = false;
        slot->velocity = std::max(0.1f, std::min(1.0f, velocity));
        slot->freq = midiToFreq(midi);
        slot->phase = 0.0;
        slot->ageSec = 0.0;
        slot->releaseAgeSec = 0.0;
        slot->releaseDurSec = 0.35;
        slot->currentAmp = 0.0f;
        slot->releaseStartAmp = 0.0f;
        slot->autoStopClockSec = autoStopClockSec;
    }

    void releaseMidi(int32_t midi, float releaseSec) {
        for (auto& v : voices_) {
            if (v.active && v.scheduleId == 0 && v.midi == midi && !v.releasing) {
                v.releasing = true;
                v.releaseAgeSec = 0.0;
                v.releaseStartAmp = v.currentAmp;
                v.releaseDurSec = std::max(0.05, static_cast<double>(releaseSec));
            }
        }
    }

    void releaseScheduledVoice(int32_t scheduleId, float releaseSec) {
        for (auto& v : voices_) {
            if (v.active && v.scheduleId == scheduleId && !v.releasing) {
                v.releasing = true;
                v.releaseAgeSec = 0.0;
                v.releaseStartAmp = v.currentAmp;
                v.releaseDurSec = std::max(0.05, static_cast<double>(releaseSec));
            }
        }
    }

    float stepVoice(Voice& v, double invSr) {
        v.ageSec += invSr;
        v.phase += kTwoPi * v.freq * invSr;
        if (v.phase > kTwoPi * 1024.0) {
            v.phase = std::fmod(v.phase, kTwoPi);
        }

        float env = 0.0f;
        if (v.releasing) {
            v.releaseAgeSec += invSr;
            const double frac = v.releaseAgeSec / std::max(0.04, v.releaseDurSec);
            if (frac >= 1.0) {
                v.active = false;
                v.currentAmp = 0.0f;
                return 0.0f;
            }
            env = v.releaseStartAmp * static_cast<float>((1.0 - frac) * (1.0 - frac));
        } else {
            const double attackSec = v.timbre == 2 ? 0.015 : 0.005;
            if (v.ageSec < attackSec) {
                env = static_cast<float>(v.ageSec / attackSec);
            } else if (v.sustain) {
                env = 0.72f + 0.28f * std::exp(-static_cast<float>(v.ageSec - attackSec) * 2.2f);
            } else {
                const float decayRate = v.timbre == 0 ? 1.12f : (v.timbre == 1 ? 0.96f : 0.85f);
                env = std::exp(-static_cast<float>(v.ageSec - attackSec) * decayRate);
                if (env < 0.0015f) {
                    v.active = false;
                    v.currentAmp = 0.0f;
                    return 0.0f;
                }
            }
        }
        v.currentAmp = env;

        const double p = v.phase;
        float wave = 0.0f;
        if (v.timbre == 2) {
            // Pure sine
            wave = static_cast<float>(std::sin(p));
        } else if (v.timbre == 1) {
            // Warm Rhodes electric piano
            const float tineDecay = std::exp(-static_cast<float>(v.ageSec) * 7.5f);
            wave = 0.76f * static_cast<float>(std::sin(p))
                   + 0.16f * static_cast<float>(std::sin(2.0 * p))
                   + 0.07f * tineDecay * static_cast<float>(std::sin(3.0 * p))
                   + 0.05f * tineDecay * static_cast<float>(std::sin(7.0 * p));
        } else {
            // Warm acoustic piano additive model with brightness rolloff
            const float hiDecay = std::exp(-static_cast<float>(v.ageSec) * 3.8f);
            const float hammer = std::exp(-static_cast<float>(v.ageSec) * 28.0f);
            const float pitchFactor = std::max(0.25f, std::min(1.0f, (88.0f - static_cast<float>(v.midi)) / 44.0f));
            wave = 0.72f * static_cast<float>(std::sin(p))
                   + 0.28f * (0.52f + 0.48f * hiDecay) * static_cast<float>(std::sin(2.0 * p))
                   + 0.15f * hiDecay * pitchFactor * static_cast<float>(std::sin(3.0 * p))
                   + 0.08f * hiDecay * pitchFactor * static_cast<float>(std::sin(4.0 * p))
                   + 0.05f * hammer * pitchFactor * static_cast<float>(std::sin(5.0 * p))
                   + 0.03f * hammer * pitchFactor * static_cast<float>(std::sin(6.0 * p));
        }

        return wave * env * v.velocity;
    }

    std::array<Voice, kMaxVoices> voices_{};
    std::array<ScheduledNote, kMaxScheduled> scheduled_{};
    LockFreeCmdQueue<256> queue_{};
    float volume_{0.88f};
    int32_t defaultTimbre_{0};
    double a4Hz_{440.0};
};

} // namespace vocallab
