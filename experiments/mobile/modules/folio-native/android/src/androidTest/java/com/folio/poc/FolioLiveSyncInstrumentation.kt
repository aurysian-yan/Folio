package com.folio.poc

import android.app.Activity
import android.app.Application
import android.app.Instrumentation
import android.content.Context
import android.content.ContextWrapper
import android.os.Bundle
import com.folio.poc.ffi.FolioEngine
import com.folio.poc.ffi.FolioSync
import com.folio.poc.ffi.SyncResolutionDto
import java.io.File
import java.util.UUID

// 实网测试只读取已授权的连接，在独立子目录与临时库执行，不导出凭据。
class FolioLiveSyncInstrumentation : Instrumentation() {
    // 原生实网回归不启动开发客户端或 Metro 连接。
    override fun newApplication(loader: ClassLoader, name: String, context: Context): Application =
        super.newApplication(loader, Application::class.java.name, context)
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
    override fun onStart() {
        val root = File(targetContext.filesDir, "FolioMobilePoC")
        val id = "validation-${UUID.randomUUID()}"
        val temporary = File(targetContext.filesDir, id)
        val previewContext = object : ContextWrapper(targetContext) {
            override fun getFilesDir(): File = File(temporary, "b")
        }
        val peers = mutableListOf<Pair<FolioEngine, FolioSync>>()
        var stage = "saved connection"
        var password = ""
        var username = ""
        var server = ""
        val results = Bundle()
        var outcome = Activity.RESULT_CANCELED
        fun report(value: String) {
            sendStatus(0, Bundle().apply { putString("stream", "PASS: $value\n") })
        }
        fun exchange(sync: FolioSync, secret: String = password) {
            sendStatus(0, Bundle().apply { putString("stream", "RUN: $stage\n") })
            check(sync.startSync(secret))
            val deadline = System.currentTimeMillis() + 180000
            var previousStage = ""
            while (sync.status().isRunning && System.currentTimeMillis() < deadline) {
                val current = sync.status().stage
                if (current != previousStage) {
                    sendStatus(0, Bundle().apply { putString("stream", "RUN: $current\n") })
                    previousStage = current
                }
                Thread.sleep(100)
            }
            val status = sync.status()
            check(!status.isRunning && status.phase == "已同步") { status.errorMessage ?: status.phase }
        }
        try {
            FolioTls.initialize(targetContext.applicationContext)
            val saved = FolioSync.open(File(root, "folio.sqlite").path, File(root, "fonts").path)
            val profile = try { checkNotNull(saved.profile()) } finally { saved.destroy() }
            password = checkNotNull(FolioSyncCredentials(targetContext).read(profile))
            username = profile.username; server = profile.serverUrl
            val scoped = profile.copy(remoteDirectory = "${profile.remoteDirectory.trimEnd('/')}/$id", automatic = false)
            check(temporary.mkdirs())
            for (name in listOf("a", "b")) {
                val directory = File(temporary, "$name/FolioMobilePoC/fonts").apply { check(mkdirs()) }
                val database = File(temporary, "$name.sqlite")
                val engine = FolioEngine.open(database.path)
                val sync = FolioSync.open(database.path, directory.path)
                peers.add(Pair(engine, sync)); sync.saveProfile(scoped)
                engine.addLibraryRoot(directory.path)
            }
            val (a, sa) = peers[0]; val (b, sb) = peers[1]
            stage = "sample import"
            for (name in listOf("Lato-Collection.ttc", "Inter-Variable.ttf")) {
                context.assets.open(name).use { input -> File(temporary, "a/FolioMobilePoC/fonts/$name").outputStream().use { input.copyTo(it) } }
            }
            check(a.refreshLibrary().snapshot.faceCount == 3uL)
            val family = a.libraryFaceSources().first { it.paths.any { path -> path.endsWith(".ttc", true) } }.familyId
            val identities = a.familyDetails(family).faces.map { it.identityId }
            val collection = a.createCollection("Validation")
            a.setFavorite(identities, true); a.setCollectionMembers(collection.id, identities, true); a.recordRecent(identities.last())
            stage = "upload and receive"
            exchange(sa); exchange(sb)
            check(b.refreshLibrary().snapshot.faceCount == 3uL)
            report("123PAN upload, second replica download and catalog refresh")
            stage = "downloaded native preview"
            for ((index, name, axes) in listOf(Triple(1, "Lato", emptyMap<String, Double>()),
                Triple(0, "Inter", mapOf("wght" to 700.0)))) {
                val source = b.libraryFaceSources().first { it.paths.any { path -> File(path).name.contains(name, true) } }.paths.first()
                val selection = FolioPreviewSelection().apply {
                    sourcePath = source; faceIndex = index; this.axes = axes; text = "Folio Preview"
                }
                val (lines, supported) = FolioFontPreview.shapeSelection(previewContext, selection)
                check(supported && lines.single().glyphCount() > 0)
                val bitmap = android.graphics.Bitmap.createBitmap(1024, 128, android.graphics.Bitmap.Config.ARGB_8888)
                val canvas = android.graphics.Canvas(bitmap)
                val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
                lines.forEach { line ->
                    for (glyph in 0 until line.glyphCount()) {
                        canvas.drawGlyphs(intArrayOf(line.getGlyphId(glyph)), 0,
                            floatArrayOf(line.getGlyphX(glyph), line.getGlyphY(glyph) + 80), 0, 1, line.getFont(glyph), paint)
                    }
                }
                val pixels = IntArray(1024 * 128)
                bitmap.getPixels(pixels, 0, 1024, 0, 0, 1024, 128)
                check(pixels.any { it != 0 }); bitmap.recycle()
            }
            report("downloaded TTC member 1 and variable wght=700 use actual source glyphs")
            val font = sa.cloudFonts().first { it.filename.endsWith(".ttc", true) }
            stage = "cloud-only and redownload"
            sa.setCloudOnly(font.fingerprint)
            check(a.loadCachedLibrary().faceCount == 1uL)
            check(a.libraryFaceSources().none { it.paths.any { path -> path.endsWith(".ttc", true) } })
            exchange(sa); check(b.loadCachedLibrary().faceCount == 3uL)
            sa.restoreCloudFont(font.fingerprint); exchange(sa)
            check(a.refreshLibrary().snapshot.faceCount == 3uL)
            report("cloud-only removes source cache, peer retained, redownload reparsed")
            stage = "delete and restore"
            sa.deleteEverywhere(font.fingerprint); check(a.loadCachedLibrary().faceCount == 1uL)
            exchange(sa); exchange(sb); check(b.refreshLibrary().snapshot.faceCount == 1uL)
            check(sb.cloudFonts().first { it.fingerprint == font.fingerprint }.deleted)
            sb.restoreDeletedFont(font.fingerprint); exchange(sb); exchange(sa)
            for ((engine, _) in peers) {
                val snapshot = engine.refreshLibrary().snapshot
                check(snapshot.faceCount == 3uL && snapshot.recentCount == 1uL)
                check(snapshot.collections.single().memberCount == identities.size.toULong())
                check(engine.familyDetails(family).isFavorite)
            }
            report("delete propagates, recent deletion restore and collection/recent state retained")
            stage = "concurrent conflict decisions"
            for (resolution in SyncResolutionDto.entries) {
                a.renameCollection(collection.id, "local-${resolution.name}")
                b.renameCollection(collection.id, "remote-${resolution.name}")
                exchange(sa); exchange(sb); exchange(sa)
                val conflict = sa.conflicts().first { it.kind == "collection" }
                sa.resolveConflict(conflict.id, resolution); exchange(sa); exchange(sb); exchange(sa)
                check(sa.conflicts().none { it.id == conflict.id })
                report("concurrent collection conflict ${resolution.name}")
            }
            stage = "credential rejection"
            check(sb.startSync(UUID.randomUUID().toString()))
            val deadline = System.currentTimeMillis() + 30000
            while (sb.status().isRunning && System.currentTimeMillis() < deadline) Thread.sleep(100)
            check(sb.status().phase == "同步失败" && sb.status().errorMessage?.contains("认证失败") == true)
            check(b.refreshLibrary().snapshot.faceCount == 3uL)
            exchange(sb); report("invalid credentials preserve local assets, corrected credentials retry")
            stage = "cancel and resume"
            check(sb.startSync(password)); sb.cancel()
            val cancelledDeadline = System.currentTimeMillis() + 10000
            while (sb.status().isRunning && System.currentTimeMillis() < cancelledDeadline) Thread.sleep(50)
            check(!sb.status().isRunning && sb.status().phase == "已取消")
            exchange(sb); report("cancel and resume")
            results.putString("stream", "PASS: live WebDAV cycle; scoped test remote directory: $id\n")
            outcome = Activity.RESULT_OK
        } catch (error: Exception) {
            val sanitized = (error.message ?: error.javaClass.simpleName)
                .let { if (password.isNotEmpty()) it.replace(password, "[secret]") else it }
                .let { if (username.isNotEmpty()) it.replace(username, "[account]") else it }
                .let { if (server.isNotEmpty()) it.replace(server, "[server]") else it }
            results.putString("stream", "FAIL: $stage; $sanitized; scoped test remote directory: $id\n")
        } finally {
            peers.forEach { (engine, sync) -> sync.cancel(); sync.destroy(); engine.destroy() }
            temporary.deleteRecursively()
        }
        finish(outcome, results)
    }
}
