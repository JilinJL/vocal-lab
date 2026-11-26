package com.vocallab.app;

import android.Manifest;
import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "VocalLabAudio",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class VocalLabAudioPlugin extends Plugin {

    static {
        System.loadLibrary("vocallab_audio");
    }

    private native void nativeInit();
    private native double nativeGetClockTime();
    private native boolean nativeStartCapture(double minHz, double maxHz);
    private native void nativeStopCapture();
    private native void nativeNoteOn(int midi, float velocity, boolean sustain, int timbre, double a4Hz);
    private native void nativeNoteOff(int midi, float releaseSec);
    private native void nativeScheduleNote(
        int id,
        int midi,
        double startClockSec,
        double durationSec,
        float velocity,
        int timbre,
        double a4Hz
    );
    private native void nativeCancelScheduled(int id);
    private native void nativeStopAllNotes();
    private native void nativeSetSynthParams(float volume, int timbre, double a4Hz);
    private native void nativeRelease();

    @Override
    public void load() {
        super.load();
        nativeInit();
    }

    @Override
    protected void handleOnDestroy() {
        nativeRelease();
        super.handleOnDestroy();
    }

    private void ensureMediaAudioMode() {
        Context ctx = getContext();
        if (ctx == null) return;
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (am != null && am.getMode() != AudioManager.MODE_NORMAL) {
            am.setMode(AudioManager.MODE_NORMAL);
        }
    }

    private String detectAudioRoute() {
        Context ctx = getContext();
        if (ctx == null) return "speaker";
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return "speaker";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            AudioDeviceInfo[] outputs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
            for (AudioDeviceInfo dev : outputs) {
                int t = dev.getType();
                if (t == AudioDeviceInfo.TYPE_WIRED_HEADSET
                    || t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                    || t == AudioDeviceInfo.TYPE_USB_HEADSET) {
                    return "wired";
                }
                if (t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
                    || t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                    || t == AudioDeviceInfo.TYPE_BLE_HEADSET) {
                    return "bluetooth";
                }
            }
        }
        return "speaker";
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        ret.put("engine", "oboe-cpp-v1");
        ret.put("route", detectAudioRoute());
        call.resolve(ret);
    }

    @PluginMethod
    public void getClockTime(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("time", nativeGetClockTime());
        call.resolve(ret);
    }

    @PluginMethod
    public void startCapture(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermissionCallback");
            return;
        }
        beginCapture(call);
    }

    @PermissionCallback
    private void micPermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            beginCapture(call);
        } else {
            call.reject("麦克风权限被拒绝，请在系统设置中允许 VocalLab 使用麦克风。");
        }
    }

    private void beginCapture(PluginCall call) {
        ensureMediaAudioMode();
        double minHz = call.getDouble("minHz", 60.0);
        double maxHz = call.getDouble("maxHz", 1250.0);
        boolean ok = nativeStartCapture(minHz, maxHz);
        if (!ok) {
            call.reject("无法启动低延迟音频采集，请检查是否有其他应用占用麦克风。");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("started", true);
        ret.put("clockTime", nativeGetClockTime());
        ret.put("route", detectAudioRoute());
        call.resolve(ret);
    }

    @PluginMethod
    public void stopCapture(PluginCall call) {
        nativeStopCapture();
        call.resolve();
    }

    @PluginMethod
    public void noteOn(PluginCall call) {
        ensureMediaAudioMode();
        int midi = call.getInt("midi", 60);
        double velocity = call.getDouble("velocity", 0.85);
        boolean sustain = Boolean.TRUE.equals(call.getBoolean("sustain", false));
        int timbre = call.getInt("timbre", 0);
        double a4Hz = call.getDouble("a4Hz", 440.0);
        nativeNoteOn(midi, (float) velocity, sustain, timbre, a4Hz);
        call.resolve();
    }

    @PluginMethod
    public void noteOff(PluginCall call) {
        int midi = call.getInt("midi", 60);
        double releaseSec = call.getDouble("releaseSec", 0.35);
        nativeNoteOff(midi, (float) releaseSec);
        call.resolve();
    }

    @PluginMethod
    public void scheduleNote(PluginCall call) {
        ensureMediaAudioMode();
        int id = call.getInt("id", 1);
        int midi = call.getInt("midi", 60);
        double startTime = call.getDouble("startTime", nativeGetClockTime());
        double duration = call.getDouble("duration", 0.5);
        double velocity = call.getDouble("velocity", 0.82);
        int timbre = call.getInt("timbre", 0);
        double a4Hz = call.getDouble("a4Hz", 440.0);
        nativeScheduleNote(id, midi, startTime, duration, (float) velocity, timbre, a4Hz);
        call.resolve();
    }

    @PluginMethod
    public void cancelScheduled(PluginCall call) {
        int id = call.getInt("id", 0);
        nativeCancelScheduled(id);
        call.resolve();
    }

    @PluginMethod
    public void stopAllNotes(PluginCall call) {
        nativeStopAllNotes();
        call.resolve();
    }

    @PluginMethod
    public void setSynthParams(PluginCall call) {
        double volume = call.getDouble("volume", 0.76);
        int timbre = call.getInt("timbre", 0);
        double a4Hz = call.getDouble("a4Hz", 440.0);
        nativeSetSynthParams((float) volume, timbre, a4Hz);
        call.resolve();
    }

    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                if (enabled) {
                    getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }
        call.resolve();
    }

    // Called from native C++ DSP worker thread via JNI
    @SuppressWarnings("unused")
    public void onNativePitchFrame(
        double time,
        double frequency,
        double clarity,
        double rms,
        int sampleRate
    ) {
        JSObject payload = new JSObject();
        payload.put("time", time);
        if (frequency > 0.0) {
            payload.put("frequency", frequency);
        } else {
            payload.put("frequency", JSObject.NULL);
        }
        payload.put("clarity", clarity);
        payload.put("rms", rms);
        payload.put("sampleRate", sampleRate);
        notifyListeners("pitchFrame", payload);
    }
}
