package com.folio.poc

import com.folio.poc.ffi.FolioEngine
import com.folio.poc.ffi.LibraryQueryDto
import com.folio.poc.ffi.QueryScopeDto
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.net.URI
import java.nio.file.Files
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

// 原生导入使用真实 Rust 数据库，ZIP 与资源限制使用隔离样本。
class FolioFontImporterTest {
    private val samples = File(requireNotNull(System.getProperty("folio.samples")))

    private fun scenario(run: (File, FolioEngine) -> Unit) {
        val root = Files.createTempDirectory("folio-import-test").toFile()
        val engine = FolioEngine.open(File(root, "folio.sqlite").absolutePath)
        try { run(root, engine) } finally { engine.destroy(); root.deleteRecursively() }
    }

    private fun selected(name: String, display: String = name) = SelectedImportFile(File(samples, name).toURI().toString(), display)

    private fun importer(root: File, engine: FolioEngine, limits: FontImportLimits = FontImportLimits()) =
        FolioFontImporter(engine, root, { File(URI(it)).inputStream() }, limits)

    private fun archive(root: File, name: String, entries: List<Pair<String, ByteArray>>, stored: Boolean = false): SelectedImportFile {
        val file = File(root, name)
        ZipOutputStream(file.outputStream()).use { output ->
            for ((path, data) in entries) {
                val entry = ZipEntry(path)
                if (stored) {
                    entry.method = ZipEntry.STORED
                    entry.size = data.size.toLong()
                    entry.crc = CRC32().apply { update(data) }.value
                }
                output.putNextEntry(entry)
                output.write(data)
                output.closeEntry()
            }
        }
        return SelectedImportFile(file.toURI().toString(), name)
    }

    private fun assertClean(root: File) {
        assertTrue(File(root, "imports").listFiles().orEmpty().isEmpty())
    }

    @Test fun partialFailureAndContentDuplicatesPersist() = scenario { root, engine ->
        val files = listOf(selected("Lato-Regular.ttf", "同名.ttf"), selected("Lato-Bold.ttf", "同名.ttf"),
            selected("not-a-font.ttf"), selected("Lato-Regular.ttf", "改名.otf"),
            SelectedImportFile(File(root, "missing.ttf").toURI().toString(), "不可读.ttf"))
        val report = importer(root, engine).importFiles(files)
        assertEquals(listOf("imported", "imported", "failed", "duplicate", "failed"), report.items.map { it.status })
        assertEquals(2L, report.snapshot.faceCount.toLong())
        val page = engine.queryLibrary(LibraryQueryDto(null, QueryScopeDto.ALL, null, emptyList(), null, null, 0uL, 100uL))
        engine.setFavorite(listOf(page.families.first().faces.first().identityId), true)
        val reopened = FolioEngine.open(File(root, "folio.sqlite").absolutePath)
        try {
            assertEquals("duplicate", importer(root, reopened).importFiles(listOf(files.first())).items.single().status)
            assertTrue(reopened.queryLibrary(LibraryQueryDto(null, QueryScopeDto.FAVORITES, null, emptyList(), null, null, 0uL, 100uL)).families.isNotEmpty())
        } finally { reopened.destroy() }
        assertEquals(2, File(root, "fonts").listFiles()!!.size)
        assertClean(root)
    }

    @Test fun zipSubdirectoriesCollectionsAndVariableFonts() = scenario { root, engine ->
        val zip = archive(root, "中文.zip", listOf(
            "子目录/集合.TTC" to File(samples, "Lato-Collection.ttc").readBytes(),
            "变量.ttf" to File(samples, "Inter-Variable.ttf").readBytes(),
            "说明.txt" to "说明".toByteArray(), "nested.zip" to byteArrayOf(1)))
        val report = importer(root, engine).importFiles(listOf(zip))
        assertEquals(2, report.items.size)
        assertTrue(report.items.all { it.status == "imported" && it.archiveName == "中文.zip" })
        val faces = engine.queryLibrary(LibraryQueryDto(null, QueryScopeDto.ALL, null, emptyList(), null, null, 0uL, 100uL)).families.flatMap { it.faces }
        assertTrue(faces.any { it.faceIndex == 1u })
        assertTrue(faces.any { it.axes.isNotEmpty() })
        assertClean(root)
    }

    @Test fun storedZipSkipsDuplicateContents() = scenario { root, engine ->
        val data = File(samples, "SourceSerif4-Regular.otf").readBytes()
        val zip = archive(root, "stored.zip", listOf("a.otf" to data, "b.otf" to data), true)
        assertEquals(listOf("imported", "duplicate"), importer(root, engine).importFiles(listOf(zip)).items.map { it.status })
        assertClean(root)
    }

    @Test fun unsafePathsAndInvalidArchivesDoNotAffectValidFiles() = scenario { root, engine ->
        val zip = archive(root, "unsafe.zip", listOf("../outside.ttf" to File(samples, "Lato-Regular.ttf").readBytes()))
        val empty = archive(root, "empty.zip", listOf("README.txt" to byteArrayOf(1)))
        val noEntries = archive(root, "no-entries.zip", emptyList())
        val invalid = SelectedImportFile(File(samples, "not-a-font.ttf").toURI().toString(), "invalid.zip")
        val report = importer(root, engine).importFiles(listOf(zip, empty, noEntries, invalid, selected("Lato-Regular.ttf")))
        assertEquals(listOf("failed", "failed", "failed", "failed", "imported"), report.items.map { it.status })
        assertFalse(File(root.parentFile, "outside.ttf").exists())
        for (path in listOf("../x.ttf", "C:\\x.ttf", "/x.ttf", "a\\..\\x.ttf")) assertFalse(FolioFontImporter.safeArchivePath(path))
        assertTrue(FolioFontImporter.safeArchivePath("字体/a.ttf"))
        assertClean(root)
    }

    @Test fun corruptCrcAndEncryptedArchivesAreRejected() = scenario { root, engine ->
        val data = File(samples, "Lato-Regular.ttf").readBytes()
        val crcZip = archive(root, "crc.zip", listOf("a.ttf" to data), true)
        val crcFile = File(URI(crcZip.uri))
        val bytes = crcFile.readBytes()
        val central = bytes.indices.first { it + 4 <= bytes.size && bytes.sliceArray(it until it + 4).contentEquals(byteArrayOf(0x50, 0x4b, 1, 2)) }
        bytes[central + 16] = (bytes[central + 16].toInt() xor 1).toByte()
        crcFile.writeBytes(bytes)
        val encrypted = archive(root, "encrypted.zip", listOf("a.ttf" to data), true)
        val encryptedFile = File(URI(encrypted.uri))
        val encryptedBytes = encryptedFile.readBytes()
        encryptedBytes[6] = (encryptedBytes[6].toInt() or 1).toByte()
        encryptedBytes[central + 8] = (encryptedBytes[central + 8].toInt() or 1).toByte()
        encryptedFile.writeBytes(encryptedBytes)
        val report = importer(root, engine).importFiles(listOf(crcZip, encrypted))
        assertTrue(report.items.all { it.status == "failed" })
        assertEquals(0L, report.snapshot.faceCount.toLong())
        assertClean(root)
    }

    @Test fun limitsApplyToActualStreamsAndExpandedData() = scenario { root, engine ->
        val large = selected("Lato-Regular.ttf")
        assertEquals("failed", importer(root, engine, FontImportLimits(fontBytes = 10)).importFiles(listOf(large)).items.single().status)
        val zip = archive(root, "limit.zip", listOf("a.ttf" to File(samples, "Lato-Regular.ttf").readBytes()))
        for (limits in listOf(FontImportLimits(archiveBytes = 10), FontImportLimits(archiveEntries = 0), FontImportLimits(batchBytes = 10))) {
            assertTrue(importer(root, engine, limits).importFiles(listOf(zip)).items.all { it.status == "failed" })
        }
        val count = importer(root, engine, FontImportLimits(fonts = 1)).importFiles(listOf(large, selected("Lato-Bold.ttf")))
        assertEquals(listOf("imported", "failed"), count.items.map { it.status })
        assertClean(root)
    }

    @Test fun refreshFailureRollsBackOnlyNewSources() = scenario { root, engine ->
        importer(root, engine).importFiles(listOf(selected("Lato-Regular.ttf")))
        val query = LibraryQueryDto(null, QueryScopeDto.ALL, null, emptyList(), null, null, 0uL, 100uL)
        engine.setFavorite(listOf(engine.queryLibrary(query).families.first().faces.first().identityId), true)
        val importer = FolioFontImporter(engine, root, { File(URI(it)).inputStream() }, refresh = { error("refresh failed") })
        try { importer.importFiles(listOf(selected("Lato-Bold.ttf"))); fail("must fail") } catch (_: FontImportFailure) { }
        assertEquals(1, engine.loadCachedLibrary().roots.size)
        assertEquals(1L, engine.refreshLibrary().snapshot.faceCount.toLong())
        assertTrue(engine.queryLibrary(query).families.single().isFavorite)
        assertEquals(1, File(root, "fonts").listFiles()!!.size)
        assertClean(root)
    }

    @Test fun oldManagedFontIsRecoveredByRefresh() = scenario { root, engine ->
        val directory = File(root, "fonts").apply { mkdirs() }
        val file = File(directory, "old.font")
        File(samples, "Lato-Regular.ttf").copyTo(file)
        engine.validateFontFile(file.absolutePath)
        engine.addFontFile(file.absolutePath)
        assertEquals(1L, engine.refreshLibrary().snapshot.faceCount.toLong())
        assertEquals("duplicate", importer(root, engine).importFiles(listOf(selected("Lato-Regular.ttf"))).items.single().status)
    }
}
