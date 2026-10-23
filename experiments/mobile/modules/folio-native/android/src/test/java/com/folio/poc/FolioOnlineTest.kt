package com.folio.poc

import com.folio.poc.ffi.FolioBrowser
import com.folio.poc.ffi.FolioEngine
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.net.URI
import java.nio.file.Files

// 使用真实 Rust 动态库验证 Kotlin 下载交接与原生导入。
class FolioOnlineTest {
    private val samples = File(requireNotNull(System.getProperty("folio.samples")))
    private val origin = """{"providerId":"test","providerName":"字体来源","sourcePageUrl":"https://example.com/font?token=secret","downloadHost":"example.com"}"""

    @Test fun customIconIsNormalizedThroughTheGeneratedBridge() {
        val root = Files.createTempDirectory("folio-icon-test").toFile()
        val browser = FolioBrowser.open(File(root, "folio.sqlite").absolutePath, File(root, "transfers").absolutePath)
        try {
            browser.acceptDisclaimer()
            val original = File(samples.parentFile, "assets/design/icon.png")
            val imported = browser.importIcon(original.absolutePath)
            val path = File(URI(field(imported, "uri")))
            assertTrue(path.exists())
            assertArrayEquals(byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10), path.readBytes().take(8).toByteArray())
            assertEquals(field(imported, "assetId"), field(browser.importIcon(original.absolutePath), "assetId"))
            val script = File(root, "script.svg").apply { writeText("<svg><script>alert(1)</script></svg>") }
            try { browser.importIcon(script.absolutePath); fail("脚本不能作为图标导入") } catch (_: Exception) { }
        } finally { browser.destroy(); root.deleteRecursively() }
    }

    @Test fun transferRetryImportAndDuplicateUseTheGeneratedBridge() {
        val root = Files.createTempDirectory("folio-online-test").toFile()
        val database = File(root, "folio.sqlite").absolutePath
        val browser = FolioBrowser.open(database, File(root, "transfers").absolutePath)
        val engine = FolioEngine.open(database)
        try {
            assertTrue(browser.state().contains("\"accepted\":false"))
            browser.acceptDisclaimer()
            val search = browser.search("maoken", "字体 &?#")
            assertTrue(search.contains("%E5%AD%97%E4%BD%93%20%26%3F%23"))
            val job = browser.createDownload("https://example.com/font?token=secret", "download", origin)
            val id = field(job, "id")
            val path = File(browser.downloadPath(id))
            File(samples, "Lato-Regular.ttf").copyTo(path)
            browser.progress(id, 4uL, null, 0uL)
            browser.setDownloadState(id, "paused", null, 0uL)
            browser.setDownloadState(id, "queued", null, 0uL)
            try { browser.finishDownload(id, 0uL); fail("旧任务不能完成重试") } catch (_: Exception) { }
            browser.finishDownload(id, 1uL)
            val state = browser.state()
            assertTrue(state.contains("\"name\":\"download.ttf\""))
            assertTrue(state.contains("\"state\":\"ready\""))
            assertFalse(state.contains("secret"))
            val selected = SelectedImportFile(path.toURI().toString(), "download.ttf")
            val importer = FolioFontImporter(engine, root, { File(URI(it)).inputStream() })
            val result = importer.importFiles(listOf(selected))
            assertEquals(listOf("imported"), result.items.map { it.status })
            assertEquals(1L, result.snapshot.faceCount.toLong())
            val repeated = FolioFontImporter(engine, root, { File(URI(it)).inputStream() }).importFiles(listOf(selected))
            assertEquals(listOf("duplicate"), repeated.items.map { it.status })
            browser.recordOrigin(id, field(engine.analyzeFontFile(path.absolutePath), "fingerprint"))
            browser.setDownloadState(id, "completed", null, 1uL)
            browser.cancelDownload(id)
            assertFalse(path.exists())
            assertEquals(1L, engine.loadCachedLibrary().faceCount.toLong())
        } finally {
            engine.destroy()
            browser.destroy()
            root.deleteRecursively()
        }
    }

    @Test fun localPayloadCreatedFromBlobUsesTheSameTransferChecks() {
        val root = Files.createTempDirectory("folio-online-local-test").toFile()
        val browser = FolioBrowser.open(File(root, "folio.sqlite").absolutePath, File(root, "transfers").absolutePath)
        try {
            browser.acceptDisclaimer()
            val job = browser.createLocalDownload("Roboto.zip", origin)
            val id = requireNotNull(Regex("\"id\":\"([^\"]+)\"").find(job)?.groupValues?.get(1))
            val generation = requireNotNull(Regex("\"generation\":(\\d+)").find(job)?.groupValues?.get(1)).toULong()
            val path = File(browser.downloadPath(id))
            File(samples, "Lato-Regular.ttf").copyTo(path)
            browser.finishDownload(id, generation)
            val state = browser.state()
            assertTrue(state.contains("\"name\":\"Roboto.ttf\""))
            assertTrue(state.contains("\"kind\":\"font\""))
            assertTrue(state.contains("\"state\":\"ready\""))
            assertFalse(state.contains("secret"))
        } finally {
            browser.destroy()
            root.deleteRecursively()
        }
    }

    private fun field(value: String, key: String): String =
        requireNotNull(Regex("\"$key\":\"([^\"]+)\"").find(value)?.groupValues?.get(1))
}
