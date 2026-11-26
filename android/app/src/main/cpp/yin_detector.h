#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <vector>

namespace vocallab {

struct PitchResult {
    double frequency; // -1.0 if unvoiced
    double clarity;   // 0..1
    double rms;       // 0..1
};

class YinDetector {
public:
    explicit YinDetector(size_t maxWindowSize = 2048)
        : diff_(maxWindowSize / 2, 0.0f) {}

    PitchResult detect(const float* samples,
                       size_t count,
                       int sampleRate,
                       double minFreq = 60.0,
                       double maxFreq = 1250.0,
                       float rmsGate = 0.008f,
                       float threshold = 0.15f) {
        if (!samples || count < 256 || sampleRate <= 0) {
            return {-1.0, 0.0, 0.0};
        }

        double sumSq = 0.0;
        for (size_t i = 0; i < count; ++i) {
            const double v = static_cast<double>(samples[i]);
            sumSq += v * v;
        }
        const double rms = std::sqrt(sumSq / static_cast<double>(count));
        if (rms < static_cast<double>(rmsGate)) {
            return {-1.0, 0.0, rms};
        }

        const size_t halfSize = count / 2;
        if (diff_.size() < halfSize) {
            diff_.resize(halfSize, 0.0f);
        }

        const size_t minTau = std::max<size_t>(
            2, static_cast<size_t>(std::floor(static_cast<double>(sampleRate) / maxFreq)));
        const size_t maxTau = std::min<size_t>(
            halfSize - 1,
            static_cast<size_t>(std::ceil(static_cast<double>(sampleRate) / minFreq)));

        if (maxTau <= minTau + 2) {
            return {-1.0, 0.0, rms};
        }

        // 1. Difference function d(tau)
        diff_[0] = 1.0f;
        for (size_t tau = 1; tau <= maxTau; ++tau) {
            float sum = 0.0f;
            for (size_t j = 0; j < halfSize; ++j) {
                const float delta = samples[j] - samples[j + tau];
                sum += delta * delta;
            }
            diff_[tau] = sum;
        }

        // 2. Cumulative mean normalized difference function (CMNDF)
        float runningSum = 0.0f;
        for (size_t tau = 1; tau <= maxTau; ++tau) {
            runningSum += diff_[tau];
            diff_[tau] = runningSum > 1e-12f
                             ? (diff_[tau] * static_cast<float>(tau)) / runningSum
                             : 1.0f;
        }

        // 3. Absolute threshold search for first local minimum
        size_t bestTau = 0;
        float bestVal = 1.0f;

        for (size_t tau = minTau; tau <= maxTau; ++tau) {
            if (diff_[tau] < threshold) {
                while (tau + 1 <= maxTau && diff_[tau + 1] < diff_[tau]) {
                    ++tau;
                }
                bestTau = tau;
                bestVal = diff_[tau];
                break;
            }
        }

        // Fallback to global minimum if reasonably periodic
        if (bestTau == 0) {
            for (size_t tau = minTau; tau <= maxTau; ++tau) {
                if (diff_[tau] < bestVal) {
                    bestVal = diff_[tau];
                    bestTau = tau;
                }
            }
            if (bestVal > 0.35f) {
                return {-1.0, std::max(0.0, 1.0 - static_cast<double>(bestVal)), rms};
            }
        }

        // 4. Parabolic interpolation around bestTau
        double refinedTau = static_cast<double>(bestTau);
        if (bestTau > 1 && bestTau + 1 <= maxTau) {
            const double s0 = static_cast<double>(diff_[bestTau - 1]);
            const double s1 = static_cast<double>(diff_[bestTau]);
            const double s2 = static_cast<double>(diff_[bestTau + 1]);
            const double denom = 2.0 * (2.0 * s1 - s2 - s0);
            if (std::abs(denom) > 1e-9) {
                const double shift = (s2 - s0) / denom;
                if (std::abs(shift) < 1.0) {
                    refinedTau += shift;
                }
            }
        }

        const double freq = static_cast<double>(sampleRate) / refinedTau;
        if (freq < minFreq || freq > maxFreq || !std::isfinite(freq)) {
            return {-1.0, 0.0, rms};
        }

        const double clarity = std::max(0.0, std::min(1.0, 1.0 - static_cast<double>(bestVal)));
        return {freq, clarity, rms};
    }

private:
    std::vector<float> diff_;
};

} // namespace vocallab
