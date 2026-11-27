package com.vocallab.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

@CapacitorPlugin(name = "VocalLabUpdater")
public class VocalLabUpdaterPlugin extends Plugin {

    private static final String DEFAULT_MANIFEST_URL =
        "https://github.com/JilinJL/vocal-lab/releases/latest/download/update.json";
    private static final int MAX_REDIRECTS = 8;
    private static final int CONNECT_TIMEOUT_MS = 12000;
    private static final int READ_TIMEOUT_MS = 20000;

    private final ExecutorService ioExecutor = Executors.newFixedThreadPool(2);
    private final AtomicBoolean downloadCancelled = new AtomicBoolean(false);
    private final AtomicReference<HttpURLConnection> activeConnection = new AtomicReference<>(null);

    @Override
    protected void handleOnDestroy() {
        cancelActiveDownloadInternal();
        ioExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    private long getCurrentVersionCode(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return info.getLongVersionCode();
        }
        //noinspection deprecation
        return info.versionCode;
    }

    private PackageInfo getPackageInfoWithSignatures(Context ctx) throws PackageManager.NameNotFoundException {
        PackageManager pm = ctx.getPackageManager();
        String pkg = ctx.getPackageName();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES);
        }
        //noinspection deprecation
        return pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES);
    }

    private String extractCertSha256(PackageInfo info) {
        try {
            Signature[] sigs = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                SigningInfo signingInfo = info.signingInfo;
                if (signingInfo != null) {
                    sigs = signingInfo.hasMultipleSigners()
                        ? signingInfo.getApkContentsSigners()
                        : signingInfo.getSigningCertificateHistory();
                }
            } else {
                //noinspection deprecation
                sigs = info.signatures;
            }
            if (sigs == null || sigs.length == 0) {
                return "";
            }
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(sigs[0].toByteArray());
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < digest.length; i++) {
                if (i > 0) sb.append(':');
                sb.append(String.format(Locale.US, "%02X", digest[i]));
            }
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.US, "%02x", b));
        }
        return sb.toString();
    }

    private HttpURLConnection openHttpsWithRedirects(String initialUrl, boolean trackAsDownload) throws IOException {
        String currentUrl = initialUrl;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            if (trackAsDownload && downloadCancelled.get()) {
                throw new IOException("CANCELLED");
            }
            URL url = new URL(currentUrl);
            if (!"https".equalsIgnoreCase(url.getProtocol())) {
                throw new IOException("仅允许通过 HTTPS 安全链接检查或下载更新。");
            }
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setRequestProperty("User-Agent", "VocalLab-Android-Updater/1.5");
            conn.setRequestProperty("Accept", "*/*");
            if (trackAsDownload) {
                activeConnection.set(conn);
            }
            int code = conn.getResponseCode();
            if (code == HttpURLConnection.HTTP_MOVED_PERM
                || code == HttpURLConnection.HTTP_MOVED_TEMP
                || code == HttpURLConnection.HTTP_SEE_OTHER
                || code == 307
                || code == 308) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null || location.trim().isEmpty()) {
                    throw new IOException("更新服务器返回了无效的重定向地址。");
                }
                URL resolved = new URL(url, location);
                currentUrl = resolved.toString();
                continue;
            }
            if (code < 200 || code >= 300) {
                conn.disconnect();
                throw new IOException("服务器响应异常（HTTP " + code + "）");
            }
            return conn;
        }
        throw new IOException("更新链接重定向次数过多。");
    }

    private File getUpdatesDir(Context ctx) {
        File dir = new File(ctx.getCacheDir(), "updates");
        if (!dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return dir;
    }

    private String sanitizeVersion(String versionName) {
        if (versionName == null || versionName.trim().isEmpty()) {
            return "latest";
        }
        return versionName.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    private void emitProgress(String phase, long receivedBytes, long totalBytes, int progress, String extraMessage) {
        JSObject payload = new JSObject();
        payload.put("phase", phase);
        payload.put("receivedBytes", receivedBytes);
        payload.put("totalBytes", totalBytes);
        payload.put("progress", progress);
        if (extraMessage != null) {
            payload.put("message", extraMessage);
        }
        notifyListeners("updateProgress", payload);
    }

    private void cancelActiveDownloadInternal() {
        downloadCancelled.set(true);
        HttpURLConnection conn = activeConnection.getAndSet(null);
        if (conn != null) {
            try {
                conn.disconnect();
            } catch (Exception ignored) {
                // ignore
            }
        }
    }

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("应用上下文不可用");
            return;
        }
        try {
            PackageInfo info = getPackageInfoWithSignatures(ctx);
            JSObject ret = new JSObject();
            ret.put("packageName", ctx.getPackageName());
            ret.put("versionName", info.versionName != null ? info.versionName : "0.0.0");
            ret.put("versionCode", getCurrentVersionCode(info));
            ret.put("signingCertSha256", extractCertSha256(info));
            ret.put("sdkInt", Build.VERSION.SDK_INT);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读取应用版本信息失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("应用上下文不可用");
            return;
        }
        final String manifestUrl = call.getString("manifestUrl", DEFAULT_MANIFEST_URL);
        ioExecutor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                PackageInfo info = getPackageInfoWithSignatures(ctx);
                long localVersionCode = getCurrentVersionCode(info);
                String localVersionName = info.versionName != null ? info.versionName : "0.0.0";

                conn = openHttpsWithRedirects(manifestUrl, false);
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                try (InputStream in = new BufferedInputStream(conn.getInputStream())) {
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        baos.write(buf, 0, n);
                        if (baos.size() > 512 * 1024) {
                            throw new IOException("更新清单体积异常");
                        }
                    }
                }
                String body = baos.toString(StandardCharsets.UTF_8.name());
                JSONObject manifest = new JSONObject(body);

                String remoteVersionName = manifest.optString("versionName", "");
                long remoteVersionCode = manifest.optLong("versionCode", 0L);
                String apkUrl = manifest.optString("apkUrl", "");
                String sha256 = manifest.optString("sha256", "");
                long sizeBytes = manifest.optLong("sizeBytes", 0L);
                String releaseNotes = manifest.optString("releaseNotes", "");
                String publishedAt = manifest.optString("publishedAt", "");
                String apkName = manifest.optString("apkName", "");
                int minAndroidSdk = manifest.optInt("minAndroidSdk", 24);

                if (remoteVersionName.isEmpty() || remoteVersionCode <= 0 || apkUrl.isEmpty()) {
                    throw new IOException("更新清单缺少必要字段");
                }

                boolean compatible = Build.VERSION.SDK_INT >= minAndroidSdk;
                boolean hasUpdate = compatible && remoteVersionCode > localVersionCode;

                // Check if this exact version APK is already downloaded & cached locally
                String cachedFilePath = null;
                if (hasUpdate) {
                    File candidate = new File(
                        getUpdatesDir(ctx),
                        "VocalLab-" + sanitizeVersion(remoteVersionName) + ".apk"
                    );
                    if (candidate.exists() && candidate.length() > 100000) {
                        cachedFilePath = candidate.getAbsolutePath();
                    }
                }

                JSObject latestObj = new JSObject();
                latestObj.put("versionName", remoteVersionName);
                latestObj.put("versionCode", remoteVersionCode);
                latestObj.put("apkUrl", apkUrl);
                latestObj.put("sha256", sha256);
                latestObj.put("sizeBytes", sizeBytes);
                latestObj.put("releaseNotes", releaseNotes);
                latestObj.put("publishedAt", publishedAt);
                latestObj.put("apkName", apkName);
                latestObj.put("minAndroidSdk", minAndroidSdk);

                JSObject ret = new JSObject();
                ret.put("hasUpdate", hasUpdate);
                ret.put("currentVersionName", localVersionName);
                ret.put("currentVersionCode", localVersionCode);
                ret.put("latest", latestObj);
                if (cachedFilePath != null) {
                    ret.put("cachedFilePath", cachedFilePath);
                }
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("检查更新失败：" + (e.getMessage() != null ? e.getMessage() : "网络不可用"));
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        });
    }

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("应用上下文不可用");
            return;
        }
        final String apkUrl = call.getString("apkUrl", "");
        final String expectedSha256 = call.getString("expectedSha256", "");
        final String versionName = call.getString("versionName", "latest");

        if (apkUrl == null || !apkUrl.toLowerCase(Locale.US).startsWith("https://")) {
            call.reject("无效的 HTTPS 下载地址");
            return;
        }

        cancelActiveDownloadInternal();
        downloadCancelled.set(false);

        ioExecutor.execute(() -> {
            HttpURLConnection conn = null;
            File updatesDir = getUpdatesDir(ctx);
            String safeVer = sanitizeVersion(versionName);
            File finalFile = new File(updatesDir, "VocalLab-" + safeVer + ".apk");
            File partFile = new File(updatesDir, "VocalLab-" + safeVer + ".apk.part");

            // Clean older cached files to avoid filling cache
            File[] existing = updatesDir.listFiles();
            if (existing != null) {
                for (File f : existing) {
                    if (!f.getName().equals(partFile.getName())) {
                        //noinspection ResultOfMethodCallIgnored
                        f.delete();
                    }
                }
            }
            if (partFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                partFile.delete();
            }

            try {
                emitProgress("downloading", 0L, 0L, 0, null);
                conn = openHttpsWithRedirects(apkUrl, true);
                long totalBytes = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
                    ? conn.getContentLengthLong()
                    : conn.getContentLength();

                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long received = 0L;
                long lastEmitAt = 0L;
                int lastPct = -1;

                try (
                    InputStream in = new BufferedInputStream(conn.getInputStream());
                    FileOutputStream out = new FileOutputStream(partFile)
                ) {
                    byte[] buffer = new byte[16384];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        if (downloadCancelled.get()) {
                            throw new IOException("CANCELLED");
                        }
                        out.write(buffer, 0, read);
                        digest.update(buffer, 0, read);
                        received += read;

                        long now = System.currentTimeMillis();
                        int pct = totalBytes > 0
                            ? (int) Math.min(99L, (received * 100L) / totalBytes)
                            : 0;
                        if (now - lastEmitAt >= 120L || pct != lastPct) {
                            lastEmitAt = now;
                            lastPct = pct;
                            emitProgress("downloading", received, Math.max(0L, totalBytes), pct, null);
                        }
                    }
                    out.flush();
                }

                if (downloadCancelled.get()) {
                    throw new IOException("CANCELLED");
                }

                emitProgress("verifying", received, Math.max(received, totalBytes), 100, null);
                String actualSha256 = toHex(digest.digest());
                if (expectedSha256 != null && !expectedSha256.trim().isEmpty()) {
                    if (!actualSha256.equalsIgnoreCase(expectedSha256.trim())) {
                        //noinspection ResultOfMethodCallIgnored
                        partFile.delete();
                        emitProgress("error", received, Math.max(received, totalBytes), 0, "校验失败");
                        call.reject("安装包 SHA-256 校验未通过，已删除损坏文件，请重试下载。");
                        return;
                    }
                }

                if (finalFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    finalFile.delete();
                }
                if (!partFile.renameTo(finalFile)) {
                    throw new IOException("保存下载文件失败");
                }

                emitProgress("ready", received, received, 100, null);
                JSObject ret = new JSObject();
                ret.put("cancelled", false);
                ret.put("filePath", finalFile.getAbsolutePath());
                ret.put("sha256", actualSha256);
                ret.put("sizeBytes", received);
                call.resolve(ret);
            } catch (Exception e) {
                if (partFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    partFile.delete();
                }
                if (downloadCancelled.get() || "CANCELLED".equals(e.getMessage())) {
                    emitProgress("cancelled", 0L, 0L, 0, null);
                    JSObject ret = new JSObject();
                    ret.put("cancelled", true);
                    call.resolve(ret);
                } else {
                    String msg = e.getMessage() != null ? e.getMessage() : "网络连接中断";
                    emitProgress("error", 0L, 0L, 0, msg);
                    call.reject("下载更新失败：" + msg);
                }
            } finally {
                activeConnection.set(null);
                if (conn != null) {
                    conn.disconnect();
                }
            }
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancelActiveDownloadInternal();
        call.resolve();
    }

    @PluginMethod
    public void canRequestPackageInstalls(PluginCall call) {
        Context ctx = getContext();
        boolean granted = true;
        if (ctx != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            granted = ctx.getPackageManager().canRequestPackageInstalls();
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void openUnknownSourcesSettings(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("应用上下文不可用");
            return;
        }
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + ctx.getPackageName())
                );
            } else {
                intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开安装来源授权页面：" + e.getMessage());
        }
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("应用上下文不可用");
            return;
        }
        String filePath = call.getString("filePath", "");
        if (filePath == null || filePath.trim().isEmpty()) {
            call.reject("未找到安装包路径");
            return;
        }

        try {
            File updatesDir = getUpdatesDir(ctx).getCanonicalFile();
            File apkFile = new File(filePath).getCanonicalFile();
            if (!apkFile.getPath().startsWith(updatesDir.getPath() + File.separator)) {
                call.reject("非法的安装包路径");
                return;
            }
            if (!apkFile.exists() || apkFile.length() <= 0) {
                call.reject("安装包不存在或已过期，请重新下载。");
                return;
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !ctx.getPackageManager().canRequestPackageInstalls()) {
                JSObject ret = new JSObject();
                ret.put("launched", false);
                ret.put("needsPermission", true);
                call.resolve(ret);
                return;
            }

            Uri contentUri = FileProvider.getUriForFile(
                ctx,
                ctx.getPackageName() + ".fileprovider",
                apkFile
            );
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(installIntent);

            JSObject ret = new JSObject();
            ret.put("launched", true);
            ret.put("needsPermission", false);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("调起系统安装界面失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void saveBackupFile(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("应用上下文不可用");
            return;
        }
        String rawFilename = call.getString("filename", "vocallab-backup.json");
        String content = call.getString("content", "");
        if (content == null || content.isEmpty()) {
            call.reject("备份内容为空");
            return;
        }
        String filename = rawFilename.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (!filename.endsWith(".json")) {
            filename = filename + ".json";
        }

        try {
            byte[] data = content.getBytes(StandardCharsets.UTF_8);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = ctx.getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/VocalLab");
                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    throw new IOException("无法写入系统下载目录");
                }
                try (OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) throw new IOException("无法打开输出流");
                    out.write(data);
                    out.flush();
                }
                JSObject ret = new JSObject();
                ret.put("saved", true);
                ret.put("location", "Download/VocalLab/" + filename);
                call.resolve(ret);
                return;
            }

            File backupDir = new File(ctx.getCacheDir(), "backups");
            if (!backupDir.exists()) {
                //noinspection ResultOfMethodCallIgnored
                backupDir.mkdirs();
            }
            File file = new File(backupDir, filename);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(data);
                out.flush();
            }
            Uri shareUri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType("application/json");
            shareIntent.putExtra(Intent.EXTRA_STREAM, shareUri);
            shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(shareIntent, "保存 VocalLab 备份文件");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(chooser);

            JSObject ret = new JSObject();
            ret.put("saved", true);
            ret.put("location", "已打开系统分享保存 " + filename);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("导出备份失败：" + e.getMessage());
        }
    }
}
