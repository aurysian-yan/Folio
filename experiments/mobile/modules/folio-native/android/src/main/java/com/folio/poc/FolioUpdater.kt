package com.folio.poc

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.math.BigInteger
import java.security.MessageDigest

class FolioUpdateFileProvider : FileProvider()

// 更新任务独立于字体下载，持久化系统任务与已校验安装包。
object FolioUpdater {
    private const val IDENTITY = "com.folio.mobile.poc"
    private const val REPOSITORY = "https://github.com/aurysian-yan/Folio"
    private const val MAX_AGE = 7L * 24 * 60 * 60 * 1000
    private val prefixes = mapOf("direct" to "", "ghfast" to "https://ghfast.top/", "ghproxy" to "https://gh-proxy.com/",
        "ghproxyorg" to "https://gh-proxy.org/", "ghddlc" to "https://gh.ddlc.top/", "isteed" to "https://cors.isteed.cc/")
    private fun prefs(context: Context) = context.getSharedPreferences("folio-update-v1", Context.MODE_PRIVATE)
    private fun manager(context: Context) = context.getSystemService(DownloadManager::class.java)
    private fun saved(context: Context) = prefs(context).getString("task", null)?.let { JSONObject(it) }
    private fun save(context: Context, task: JSONObject) { check(prefs(context).edit().putString("task", task.toString()).commit()) }
    private fun installed(context: Context): PackageInfo = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
    private fun target(context: Context, version: String) = File(context.filesDir, "updates/Folio-v$version.apk")
    private fun source(context: Context, version: String) = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: error("storage"), "updates/Folio-v$version.apk")
    private fun error(code: String): Nothing = throw IllegalStateException("softwareUpdate.errors.$code")
    private fun failure(cause: Exception) = cause.message?.takeIf { it.startsWith("softwareUpdate.errors.") } ?: "softwareUpdate.errors.download"

    fun compareVersion(left: String, right: String): Int {
        val a = left.split('.').map { it.toBigIntegerOrNull() ?: BigInteger.ZERO }
        val b = right.split('.').map { it.toBigIntegerOrNull() ?: BigInteger.ZERO }
        return (0..2).firstNotNullOfOrNull { index -> (a.getOrElse(index) { BigInteger.ZERO }.compareTo(b.getOrElse(index) { BigInteger.ZERO })).takeIf { it != 0 } } ?: 0
    }

    @Synchronized fun cancel(context: Context): Map<String, Any> {
        saved(context)?.let { task ->
            manager(context).remove(task.optLong("downloadId"))
            val version = task.optString("version")
            if (Regex("[0-9]+\\.[0-9]+\\.[0-9]+").matches(version)) {
                target(context, version).delete()
                File(target(context, version).path + ".part").delete()
                source(context, version).delete()
            }
        }
        prefs(context).edit().remove("task").commit()
        return mapOf("status" to "idle")
    }

    @Synchronized fun start(context: Context, request: String): Map<String, Any> {
        if (context.packageName != IDENTITY) error("identity")
        val data = JSONObject(request)
        val version = data.getString("version")
        if (!Regex("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)").matches(version)) error("package")
        if (compareVersion(version, installed(context).versionName ?: "0.0.0") <= 0) error("version")
        val artifact = data.getJSONObject("artifact")
        val original = "$REPOSITORY/releases/download/v$version/Folio-v$version-android-universal.apk"
        if (artifact.getString("url") != original || artifact.getString("platform") != "android"
            || artifact.getString("arch") != "universal" || artifact.getString("format") != "apk") error("package")
        val size = artifact.getLong("size")
        if (size <= 0 || size > 4L * 1024 * 1024 * 1024 || !Regex("[a-f0-9]{64}").matches(artifact.getString("sha256"))) error("package")
        val prefix = prefixes[data.getString("mirror")] ?: error("package")
        val existing = saved(context)
        if (existing != null && existing.optString("status") != "failed") return state(context)
        cancel(context)
        val external = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: error("storage")
        if (external.usableSpace < size || context.filesDir.usableSpace < size) error("storage")
        source(context, version).parentFile?.mkdirs()
        val url = if (prefix.isEmpty()) original else prefix + original.removePrefix("https://")
        val download = DownloadManager.Request(Uri.parse(url))
            .setTitle(FolioFileRuntime.localized(context, "softwareUpdate.title"))
            .setDescription("Folio $version")
            .setMimeType("application/vnd.android.package-archive")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, "updates/Folio-v$version.apk")
        val id = manager(context).enqueue(download)
        val task = JSONObject().put("downloadId", id).put("version", version).put("size", size)
            .put("sha256", artifact.getString("sha256")).put("created", System.currentTimeMillis())
            .put("status", "downloading").put("autoInstall", true)
        try { save(context, task) } catch (cause: Exception) { manager(context).remove(id); throw cause }
        return state(context)
    }

    @Synchronized fun state(context: Context): Map<String, Any> {
        val task = saved(context) ?: return mapOf("status" to "idle")
        val version = task.getString("version")
        if (System.currentTimeMillis() - task.getLong("created") > MAX_AGE || compareVersion(installed(context).versionName ?: "0.0.0", version) >= 0) return cancel(context)
        val base = mutableMapOf<String, Any>("id" to task.getLong("downloadId").toString(), "version" to version,
            "total" to task.getLong("size").toDouble(), "bytes" to 0.0, "autoInstall" to task.optBoolean("autoInstall"),
            "canInstall" to context.packageManager.canRequestPackageInstalls())
        if (task.optString("status") == "failed") return base + mapOf("status" to "failed", "error" to task.optString("error"))
        try {
            val file = target(context, version)
            if (task.optString("status") == "ready") {
                if (!file.isFile || file.length() != task.getLong("size") || file.lastModified() != task.optLong("modified")) error("checksum")
                return base + mapOf("status" to "ready", "bytes" to file.length().toDouble())
            }
            manager(context).query(DownloadManager.Query().setFilterById(task.getLong("downloadId"))).use { cursor ->
                if (!cursor.moveToFirst()) error("download")
                val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                base["bytes"] = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)).coerceAtLeast(0).toDouble()
                if (status == DownloadManager.STATUS_FAILED) {
                    val reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                    error(if (reason == DownloadManager.ERROR_INSUFFICIENT_SPACE) "storage" else "download")
                }
                if (status != DownloadManager.STATUS_SUCCESSFUL) return base + mapOf("status" to if (status == DownloadManager.STATUS_PAUSED) "paused" else "downloading")
            }
            val incoming = source(context, version)
            validate(context, incoming, task)
            file.parentFile?.mkdirs()
            val temporary = File(file.path + ".part")
            incoming.inputStream().use { input -> temporary.outputStream().use { input.copyTo(it) } }
            validate(context, temporary, task)
            if (!temporary.renameTo(file)) error("storage")
            task.put("status", "ready").put("modified", file.lastModified())
            save(context, task)
            manager(context).remove(task.getLong("downloadId"))
            return base + mapOf("status" to "ready", "bytes" to file.length().toDouble())
        } catch (cause: Exception) {
            manager(context).remove(task.getLong("downloadId"))
            source(context, version).delete()
            target(context, version).delete()
            File(target(context, version).path + ".part").delete()
            task.put("status", "failed").put("error", failure(cause)).put("autoInstall", false)
            save(context, task)
            return base + mapOf("status" to "failed", "error" to failure(cause), "autoInstall" to false)
        }
    }

    // 安装前再次校验私有文件，系统安装器继续执行最终签名验证。
    private fun validate(context: Context, file: File, task: JSONObject) {
        if (!file.isFile || file.length() != task.getLong("size")) error("checksum")
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input -> val buffer = ByteArray(64 * 1024); while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) } }
        if (digest.digest().joinToString("") { "%02x".format(it) } != task.getString("sha256")) error("checksum")
        val archive = context.packageManager.getPackageArchiveInfo(file.path, PackageManager.GET_SIGNING_CERTIFICATES) ?: error("package")
        val current = installed(context)
        if (archive.packageName != IDENTITY || context.packageName != IDENTITY || archive.versionName != task.getString("version")) error("identity")
        if (archive.longVersionCode <= current.longVersionCode) error("version")
        val incoming = archive.signingInfo ?: error("signature")
        val existing = current.signingInfo ?: error("signature")
        val currentSigners = existing.apkContentsSigners.map { it.toCharsString() }.toSet()
        val targetSigners = incoming.apkContentsSigners.map { it.toCharsString() }.toSet()
        val compatible = if (incoming.hasMultipleSigners() || existing.hasMultipleSigners()) currentSigners == targetSigners
            else incoming.signingCertificateHistory.map { it.toCharsString() }.toSet().containsAll(currentSigners)
        if (currentSigners.isEmpty() || !compatible) error("signature")
    }

    @Synchronized fun installIntent(context: Context): Intent {
        val snapshot = state(context)
        if (snapshot["status"] != "ready") error("download")
        val task = saved(context) ?: error("download")
        val file = target(context, task.getString("version"))
        try { validate(context, file, task) } catch (cause: Exception) {
            file.delete()
            task.put("status", "failed").put("error", failure(cause)).put("autoInstall", false)
            save(context, task)
            throw cause
        }
        // 进入授权或安装器后不重复自动弹出；授权恢复由前台生命周期接续。
        val permitted = context.packageManager.canRequestPackageInstalls()
        task.put("autoInstall", false).put("awaitingPermission", !permitted)
        save(context, task)
        if (!permitted) return Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
        return Intent(Intent.ACTION_VIEW).setDataAndType(FileProvider.getUriForFile(context, "${context.packageName}.updates", file), "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    @Synchronized fun resumePermission(context: Context) {
        val task = saved(context) ?: return
        if (task.optBoolean("awaitingPermission")) {
            task.put("awaitingPermission", false).put("autoInstall", context.packageManager.canRequestPackageInstalls())
            save(context, task)
        }
    }
    @Synchronized fun deferInstall(context: Context) {
        saved(context)?.let { task -> task.put("autoInstall", true); save(context, task) }
    }
}
