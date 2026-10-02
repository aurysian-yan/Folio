package com.folio.poc

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import com.folio.poc.ffi.FolioSync
import com.folio.poc.ffi.SyncProfileDto
import com.facebook.react.bridge.BridgeReactContext
import com.folio.poc.navigation.FolioHeaderBackdropView
import com.folio.poc.navigation.FolioHeaderControlsView
import com.folio.poc.navigation.FolioLiquidTabsView
import expo.modules.core.ModuleRegistry
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.ModulesProvider
import expo.modules.kotlin.modules.Module
import java.lang.ref.WeakReference
import java.io.File
import java.util.UUID

// 真机导航与安全存储回归使用测试 APK 私有数据，不接触开发应用字体库。
class FolioSyncInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
    override fun onStart() {
        val results = Bundle()
        val root = File(targetContext.filesDir, "sync-test-${UUID.randomUUID()}")
        val profile = SyncProfileDto("https://192.0.2.1/", UUID.randomUUID().toString(), "test", true)
        val credentials = FolioSyncCredentials(targetContext)
        var sync: FolioSync? = null
        try {
            FolioTls.initialize(targetContext.applicationContext)
            runOnMainSync {
                val reactContext = BridgeReactContext(targetContext)
                val provider = object : ModulesProvider {
                    override fun getModulesMap(): Map<Class<out Module>, String?> = emptyMap()
                }
                val appContext = AppContext(provider, ModuleRegistry(emptyList(), emptyList()), WeakReference(reactContext))
                // 重现离窗后的延迟测量，三种 Compose 宿主都不得创建窗口 composition。
                listOf(FolioHeaderControlsView(targetContext, appContext),
                    FolioHeaderBackdropView(targetContext, appContext),
                    FolioLiquidTabsView(targetContext, appContext)).forEach { view ->
                    view.layout(0, 0, 944, 116)
                    view.requestLayout()
                    view.measureAndLayout()
                    check(view.measuredWidth == 944 && view.measuredHeight == 116)
                }
            }
            check(root.mkdirs())
            val secret = UUID.randomUUID().toString()
            credentials.write(secret, profile)
            check(FolioSyncCredentials(targetContext).read(profile) == secret)
            val encrypted = targetContext.noBackupFilesDir.listFiles()!!.single { it.name.startsWith("webdav-") }
            check(!encrypted.readBytes().toString(Charsets.UTF_8).contains(secret))
            val database = File(root, "folio.sqlite")
            sync = FolioSync.open(database.path, File(root, "fonts").path)
            sync.saveProfile(profile)
            check(!database.readBytes().toString(Charsets.UTF_8).contains(secret))
            sync.destroy()
            sync = FolioSync.open(database.path, File(root, "fonts").path)
            check(sync.profile() == profile)
            val tlsProbe = SyncProfileDto("https://webdav.123pan.cn/webdav", "", "folio-invalid-test", false)
            val rejection = runCatching { checkNotNull(sync).testConnection(tlsProbe, UUID.randomUUID().toString()) }.exceptionOrNull()
            check(rejection is com.folio.poc.ffi.FolioFfiException.Operation && rejection.detail.contains("认证失败"))
            check(credentials.read(profile) == secret)
            val previewDirectory = File(targetContext.filesDir, "FolioMobilePoC/fonts")
            check(previewDirectory.isDirectory || previewDirectory.mkdirs())
            for ((name, index, axes) in listOf(
                Triple("Lato-Collection.ttc", 1, emptyMap<String, Double>()),
                Triple("Inter-Variable.ttf", 0, mapOf("wght" to 700.0)),
            )) {
                val fontFile = File(previewDirectory, "preview-test-$name")
                try {
                    context.assets.open(name).use { input -> fontFile.outputStream().use { input.copyTo(it) } }
                    val selection = FolioPreviewSelection().apply {
                        sourcePath = fontFile.path; faceIndex = index; this.axes = axes; text = "Folio Preview"
                    }
                    val (lines, supported) = FolioFontPreview.shapeSelection(targetContext, selection)
                    check(supported && lines.single().glyphCount() > 0)
                    val bitmap = android.graphics.Bitmap.createBitmap(1024, 128, android.graphics.Bitmap.Config.ARGB_8888)
                    val canvas = android.graphics.Canvas(bitmap)
                    val paint = android.graphics.Paint()
                    lines.forEach { line ->
                        for (glyph in 0 until line.glyphCount()) {
                            canvas.drawGlyphs(intArrayOf(line.getGlyphId(glyph)), 0,
                                floatArrayOf(line.getGlyphX(glyph), line.getGlyphY(glyph) + 80), 0, 1, line.getFont(glyph), paint)
                        }
                    }
                    bitmap.recycle()
                    fontFile.delete()
                    check(runCatching { FolioFontPreview.shapeSelection(targetContext, selection) }.isFailure)
                } finally { fontFile.delete() }
            }
            check(sync.startSync(secret))
            sync.cancel()
            val deadline = System.currentTimeMillis() + 5000
            while (sync.status().isRunning && System.currentTimeMillis() < deadline) Thread.sleep(50)
            check(!sync.status().isRunning && sync.status().phase == "已取消")
            val bytes = encrypted.readBytes()
            bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
            encrypted.writeBytes(bytes)
            check(runCatching { credentials.read(profile) }.isFailure)
            credentials.write(secret, profile)
            check(credentials.read(profile) == secret)
            credentials.write(null, profile)
            check(credentials.read(profile) == null)
            sync.disconnect()
            check(sync.profile() == null)
            results.putString("stream", "PASS: Keystore AES-GCM, private ciphertext, reopen, corruption, cancellation, disconnect, detached Compose measurement, Android system TLS, TTC and variable native preview\n")
            finish(Activity.RESULT_OK, results)
        } catch (_: Exception) {
            results.putString("stream", "FAIL: sync secure-storage validation\n")
            finish(Activity.RESULT_CANCELED, results)
        } finally {
            sync?.cancel(); sync?.destroy()
            runCatching { credentials.write(null, profile) }
            root.deleteRecursively()
        }
    }
}
