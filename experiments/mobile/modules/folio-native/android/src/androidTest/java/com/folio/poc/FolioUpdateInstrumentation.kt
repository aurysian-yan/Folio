package com.folio.poc

import android.app.Activity
import android.app.Instrumentation
import android.app.DownloadManager
import android.content.Context
import android.content.ContextWrapper
import android.os.Bundle
import android.os.Environment
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.security.MessageDigest
import org.json.JSONObject
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import expo.modules.kotlin.types.descriptors.typeDescriptorOf
import expo.modules.kotlin.types.toReturnType

// 使用临时签名 APK 与独立测试数据校验安装边界，不读写用户字体库。
class FolioUpdateInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
    override fun onStart() {
        val results = Bundle()
        val testContext = targetContext
        val official = object : ContextWrapper(testContext) { override fun getPackageName() = "com.folio.mobile.poc" }
        var checks = 0
        try {
            val descriptor = typeDescriptorOf<List<String>>()
            check(descriptor.jClass == List::class.java && descriptor.params.single().jClass == String::class.java); checks++
            toReturnType<List<String>>(); checks++
            FolioUpdater.cancel(official)
            check(FolioUpdater.compareVersion("1.10.0", "1.9.9") > 0); checks++
            check(runCatching { FolioUpdater.start(testContext, "{}") }.exceptionOrNull()?.message == "softwareUpdate.errors.identity"); checks++
            val arch = folioAndroidArch()
            fun taskFileName(version: String = "9.9.9") = "Folio-v$version-glasmio-$arch-9992.apk"
            fun taskMetadata(task: JSONObject): JSONObject = task.put("versionCode", 9992).put("androidVariant", "glasmio").put("arch", arch).put("minSdk", 33)
            fun prepare(asset: String, sha: String? = null, version: String = "9.9.9"): File {
                FolioUpdater.cancel(official)
                val file = File(testContext.filesDir, "updates/${taskFileName(version)}")
                file.parentFile!!.mkdirs()
                context.assets.open("updates/$asset.apk").use { input -> file.outputStream().use { input.copyTo(it) } }
                val digest = MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { "%02x".format(it) }
                val task = taskMetadata(JSONObject()).put("downloadId", -1).put("version", version).put("size", file.length()).put("sha256", sha ?: digest)
                    .put("created", System.currentTimeMillis()).put("status", "ready").put("modified", file.lastModified()).put("autoInstall", false)
                check(testContext.getSharedPreferences("folio-update-v1", Context.MODE_PRIVATE).edit().putString("task", task.toString()).commit())
                return file
            }
            prepare("good")
            check(FolioUpdater.state(official)["status"] == "ready"); checks++
            check(FolioUpdater.state(official)["version"] == "9.9.9"); checks++
            val permission = FolioUpdater.installIntent(official)
            check(permission.action == Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES && permission.data.toString() == "package:com.folio.mobile.poc"); checks++
            FolioUpdater.resumePermission(official)
            check(FolioUpdater.state(official)["autoInstall"] == false); checks++
            for ((asset, error) in listOf("wrong-signature" to "signature", "old-build" to "version", "wrong-package" to "identity", "wrong-version" to "identity", "wrong-variant" to "package", "wrong-minimum" to "package", "wrong-abi" to "package")) {
                val file = prepare(asset)
                check(runCatching { FolioUpdater.installIntent(official) }.exceptionOrNull()?.message == "softwareUpdate.errors.$error") { asset }
                check(!file.exists() && FolioUpdater.state(official)["status"] == "failed"); checks++
            }
            prepare("same-version", version = "0.1.0")
            check(FolioUpdater.state(official)["status"] == "ready"); checks++
            check(FolioUpdater.installIntent(official).action == Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES); checks++
            var file = prepare("good", "0".repeat(64))
            check(runCatching { FolioUpdater.installIntent(official) }.exceptionOrNull()?.message == "softwareUpdate.errors.checksum")
            check(!file.exists()); checks++
            file = prepare("good")
            file.appendBytes(byteArrayOf(1))
            check(FolioUpdater.state(official)["error"] == "softwareUpdate.errors.checksum" && !file.exists()); checks++
            file = prepare("good")
            val taskPrefs = testContext.getSharedPreferences("folio-update-v1", Context.MODE_PRIVATE)
            val stale = JSONObject(taskPrefs.getString("task", "")!!).put("created", 0)
            taskPrefs.edit().putString("task", stale.toString()).commit()
            check(FolioUpdater.state(official)["status"] == "idle" && !file.exists()); checks++
            file = prepare("good")
            FolioUpdater.cancel(official)
            check(!file.exists() && FolioUpdater.state(official)["status"] == "idle"); checks++
            file = prepare("good")
            val uri = FileProvider.getUriForFile(testContext, "${testContext.packageName}.updates", file)
            check(testContext.contentResolver.openInputStream(uri)!!.use { it.readBytes() }.contentEquals(file.readBytes())); checks++
            val outside = File(testContext.filesDir, "outside.apk").apply { writeText("private") }
            check(runCatching { FileProvider.getUriForFile(testContext, "${testContext.packageName}.updates", outside) }.isFailure); checks++
            outside.delete()
            // 独立本地服务仅用于测试系统下载、取消与完成后的持久恢复。
            fun transfer(corrupt: Boolean, cancel: Boolean) {
                FolioUpdater.cancel(official)
                val payload = context.assets.open("updates/good.apk").use { it.readBytes() }
                val socket = ServerSocket(0)
                val connected = CountDownLatch(1)
                val release = CountDownLatch(if (cancel) 1 else 0)
                val server = Thread {
                    runCatching {
                        socket.accept().use { client ->
                            client.soTimeout = 15000
                            val reader = client.getInputStream().bufferedReader()
                            while (!reader.readLine().isNullOrEmpty()) { }
                            client.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: ${payload.size}\r\nConnection: close\r\n\r\n".toByteArray())
                            client.getOutputStream().flush()
                            connected.countDown()
                            check(release.await(15, TimeUnit.SECONDS))
                            client.getOutputStream().write(payload)
                        }
                    }
                }.apply { isDaemon = true; start() }
                try {
                    val manager = testContext.getSystemService(DownloadManager::class.java)
                    val id = manager.enqueue(DownloadManager.Request(Uri.parse("http://127.0.0.1:${socket.localPort}/update.apk"))
                        .setDestinationInExternalFilesDir(testContext, Environment.DIRECTORY_DOWNLOADS, "updates/${taskFileName()}"))
                    val digest = MessageDigest.getInstance("SHA-256").digest(payload).joinToString("") { "%02x".format(it) }
                    val task = taskMetadata(JSONObject()).put("downloadId", id).put("version", "9.9.9").put("size", payload.size)
                        .put("sha256", if (corrupt) "0".repeat(64) else digest).put("created", System.currentTimeMillis())
                        .put("status", "downloading").put("autoInstall", false)
                    taskPrefs.edit().putString("task", task.toString()).commit()
                    check(connected.await(15, TimeUnit.SECONDS)) { "download did not reach local fixture" }
                    if (cancel) {
                        check(FolioUpdater.state(official)["status"] == "downloading")
                        FolioUpdater.cancel(official)
                        check(FolioUpdater.state(official)["status"] == "idle")
                        manager.query(DownloadManager.Query().setFilterById(id)).use { check(!it.moveToFirst()) }
                    } else {
                        var result = FolioUpdater.state(official)
                        val deadline = System.currentTimeMillis() + 15000
                        while (result["status"] in listOf("downloading", "paused") && System.currentTimeMillis() < deadline) {
                            Thread.sleep(100)
                            result = FolioUpdater.state(official)
                        }
                        check(result["status"] == if (corrupt) "failed" else "ready") { result.toString() }
                        check(FolioUpdater.state(official)["status"] == result["status"])
                        if (corrupt) check(!File(testContext.filesDir, "updates/${taskFileName()}").exists())
                    }
                    checks++
                } finally { release.countDown(); socket.close(); server.join(1000); FolioUpdater.cancel(official) }
            }
            transfer(corrupt = false, cancel = true)
            transfer(corrupt = false, cancel = false)
            transfer(corrupt = true, cancel = false)
            results.putString("stream", "OK: $checks update security checks\n")
            finish(Activity.RESULT_OK, results)
        } catch (cause: Throwable) {
            results.putString("stream", "FAILED: ${cause.stackTraceToString()}\n")
            finish(Activity.RESULT_CANCELED, results)
        } finally { FolioUpdater.cancel(official) }
    }
}
