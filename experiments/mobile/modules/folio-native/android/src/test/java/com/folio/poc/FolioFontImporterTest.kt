package com.folio.poc

import com.folio.poc.ffi.FolioEngine
import com.folio.poc.ffi.LibraryQueryDto
import com.folio.poc.ffi.QueryScopeDto
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.net.URI
import java.nio.file.Files
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

// 原生导入使用真实 Rust 数据库，ZIP 与批次使用隔离样本。
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
        val page = engine.queryLibrary(LibraryQueryDto(null, QueryScopeDto.ALL, null, emptyList(), null, null, null, null, 0uL, 100uL))
        engine.setFavorite(listOf(page.families.first().faces.first().identityId), true)
        val reopened = FolioEngine.open(File(root, "folio.sqlite").absolutePath)
        try {
            assertEquals("duplicate", importer(root, reopened).importFiles(listOf(files.first())).items.single().status)
            assertTrue(reopened.queryLibrary(LibraryQueryDto(null, QueryScopeDto.FAVORITES, null, emptyList(), null, null, null, null, 0uL, 100uL)).families.isNotEmpty())
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
        val faces = engine.queryLibrary(LibraryQueryDto(null, QueryScopeDto.ALL, null, emptyList(), null, null, null, null, 0uL, 100uL)).families.flatMap { it.faces }
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

    @Test fun zipIsFullyPreparedAndDuplicatesSpanBatches() = scenario { root, engine ->
        val zip = archive(root, "batches.zip", listOf(
            "a.ttf" to File(samples, "Lato-Regular.ttf").readBytes(),
            "b.ttf" to File(samples, "Lato-Bold.ttf").readBytes(),
            "again.ttf" to File(samples, "Lato-Regular.ttf").readBytes(),
            "c.otf" to File(samples, "SourceSerif4-Regular.otf").readBytes(),
            "last.ttf" to File(samples, "Lato-Bold.ttf").readBytes()))
        var refreshes = 0
        val importer = FolioFontImporter(engine, root, { File(URI(it)).inputStream() }, FontImportLimits(batchFonts = 2), refresh = {
            refreshes++
            val staged = File(root, "imports").walkTopDown().filter { it.isFile }.toList()
            assertEquals(if (refreshes == 1) 3 else 1, staged.size)
            engine.refreshLibrary().snapshot
        })
        val report = importer.importFiles(listOf(zip))
        assertEquals(listOf("imported", "imported", "duplicate", "imported", "duplicate"), report.items.map { it.status })
        assertEquals(2, refreshes)
        assertEquals(3L, report.snapshot.faceCount.toLong())
        assertEquals(listOf("a.ttf", "b.ttf", "again.ttf", "c.otf", "last.ttf"), report.items.map { it.name })
        assertTrue(report.items.all { it.archiveName == "batches.zip" })
        assertClean(root)
    }

    @Test fun damagedDeflateEntryDoesNotStopOtherFonts() = scenario { root, engine ->
        val zip = archive(root, "damaged.zip", listOf(
            "damaged.ttf" to File(samples, "Lato-Regular.ttf").readBytes(),
            "valid.ttf" to File(samples, "Lato-Bold.ttf").readBytes()))
        RandomAccessFile(File(URI(zip.uri)), "rw").use { file ->
            file.seek(26)
            val nameLength = file.readUnsignedByte() or (file.readUnsignedByte() shl 8)
            val extraLength = file.readUnsignedByte() or (file.readUnsignedByte() shl 8)
            file.seek((30 + nameLength + extraLength).toLong())
            file.write(6)
        }
        val report = importer(root, engine).importFiles(listOf(zip))
        assertEquals(listOf("failed", "imported"), report.items.map { it.status })
        assertEquals(1L, report.snapshot.faceCount.toLong())
        assertClean(root)
    }

    @Test fun laterRefreshFailureKeepsCommittedFontsAndStopsQueue() = scenario { root, engine ->
        importer(root, engine).importFiles(listOf(selected("Lato-Regular.ttf")))
        val query = LibraryQueryDto(null, QueryScopeDto.ALL, null, emptyList(), null, null, null, null, 0uL, 100uL)
        engine.setFavorite(listOf(engine.queryLibrary(query).families.first().faces.first().identityId), true)
        var refreshes = 0
        val importer = FolioFontImporter(engine, root, { File(URI(it)).inputStream() }, FontImportLimits(batchFonts = 2), refresh = {
            if (++refreshes == 2) error("refresh failed")
            engine.refreshLibrary().snapshot
        })
        val report = importer.importFiles(listOf(selected("Lato-Bold.ttf"), selected("Lato-Regular.ttf"),
            selected("SourceSerif4-Regular.otf"), selected("SourceSerif4-Regular.otf", "copy.otf"), selected("Inter-Variable.ttf")))
        assertEquals(listOf("imported", "duplicate", "failed", "failed", "unprocessed"), report.items.map { it.status })
        assertEquals("mobile.importErrors.batchRolledBack", report.items[2].messageKey)
        assertEquals(2L, report.snapshot.faceCount.toLong())
        assertEquals(2, engine.loadCachedLibrary().roots.size)
        assertEquals(2L, engine.refreshLibrary().snapshot.faceCount.toLong())
        assertTrue(engine.queryLibrary(query.copy(scope = QueryScopeDto.FAVORITES)).families.isNotEmpty())
        assertEquals(2, File(root, "fonts").listFiles()!!.size)
        assertClean(root)
    }

    @Test fun largeFontsArchivesAndCumulativeBytesHaveNoFixedLimit() = scenario { root, engine ->
        val font = File(root, "large.ttf")
        File(samples, "Lato-Regular.ttf").copyTo(font)
        RandomAccessFile(font, "rw").use { it.setLength(65L * 1024 * 1024) }
        val crc = CRC32()
        font.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) { val count = input.read(buffer); if (count < 0) break; crc.update(buffer, 0, count) }
        }
        val zip = File(root, "large.zip")
        ZipOutputStream(zip.outputStream()).use { output ->
            repeat(4) { index ->
                output.putNextEntry(ZipEntry("$index.ttf").apply {
                    method = ZipEntry.STORED; size = font.length(); this.crc = crc.value
                })
                font.inputStream().use { it.copyTo(output, 64 * 1024) }
                output.closeEntry()
            }
        }
        assertTrue(zip.length() > 256L * 1024 * 1024)
        val direct = SelectedImportFile(font.toURI().toString(), "large.ttf")
        val report = importer(root, engine, FontImportLimits(batchFonts = 3)).importFiles(
            listOf(SelectedImportFile(zip.toURI().toString(), "large.zip")) + List(5) { direct })
        assertEquals(listOf("imported") + List(8) { "duplicate" }, report.items.map { it.status })
        assertEquals(1L, report.snapshot.faceCount.toLong())
        assertClean(root)
    }

    @Test fun entryCountAndTaskFontCountDoNotTruncateImport() = scenario { root, engine ->
        val entries = (0 until 10_001).map { "notes/$it.txt" to byteArrayOf(1) } +
            (0 until 1_001).map { "$it.ttf" to when (it) {
                0 -> File(samples, "Lato-Regular.ttf").readBytes()
                1_000 -> File(samples, "Lato-Bold.ttf").readBytes()
                else -> byteArrayOf(1)
            } }
        val report = importer(root, engine).importFiles(listOf(archive(root, "many.zip", entries)))
        assertEquals(1_001, report.items.size)
        assertEquals("imported", report.items.first().status)
        assertEquals("imported", report.items.last().status)
        assertEquals(999, report.items.count { it.status == "failed" })
        assertEquals(2L, report.snapshot.faceCount.toLong())
        assertClean(root)
    }

    @Test fun zip64AndSplitArchivesAndLinksAreChecked() = scenario { root, engine ->
        val font = File(samples, "Lato-Regular.ttf").readBytes()
        val zip = archive(root, "zip64.zip", listOf("a.ttf" to font), true)
        val file = File(URI(zip.uri))
        val original = file.readBytes()
        val end = original.size - 22
        val eocd = ByteBuffer.wrap(original, end, 22).slice().order(ByteOrder.LITTLE_ENDIAN)
        val size = eocd.getInt(12).toLong() and 0xffffffffL
        val offset = eocd.getInt(16).toLong() and 0xffffffffL
        val record = ByteBuffer.allocate(76).order(ByteOrder.LITTLE_ENDIAN)
        record.putInt(0x06064b50).putLong(44).putShort(45).putShort(45).putInt(0).putInt(0)
            .putLong(1).putLong(1).putLong(size).putLong(offset)
            .putInt(0x07064b50).putInt(0).putLong(end.toLong()).putInt(1)
        eocd.putShort(8, (-1).toShort()).putShort(10, (-1).toShort()).putInt(12, -1).putInt(16, -1)
        file.writeBytes(original.copyOfRange(0, end) + record.array() + original.copyOfRange(end, original.size))
        assertEquals("imported", importer(root, engine).importFiles(listOf(zip)).items.single().status)
        val split = archive(root, "split.zip", listOf("a.ttf" to font), true)
        val splitFile = File(URI(split.uri))
        val splitBytes = splitFile.readBytes().also { it[it.size - 22 + 4] = 1 }
        splitFile.writeBytes(splitBytes)
        assertEquals("mobile.importErrors.splitArchive", importer(root, engine).importFiles(listOf(split)).items.single().messageKey)
        val link = archive(root, "link.zip", listOf("link.ttf" to font), true)
        val linkFile = File(URI(link.uri))
        val bytes = linkFile.readBytes()
        val central = bytes.indices.first { it + 4 <= bytes.size && bytes[it] == 0x50.toByte() && bytes[it + 1] == 0x4b.toByte() && bytes[it + 2] == 1.toByte() && bytes[it + 3] == 2.toByte() }
        bytes[central + 5] = 3
        bytes[central + 41] = 0xa0.toByte()
        linkFile.writeBytes(bytes)
        assertEquals("mobile.importErrors.link", importer(root, engine).importFiles(listOf(link)).items.single().messageKey)
        assertClean(root)
    }

    @Test fun terminalPreparationFailureStopsEveryPreparedFont() = scenario { root, engine ->
        var reads = 0
        val importer = FolioFontImporter(engine, root, { uri ->
            if (++reads == 2) throw FontImportFailure("mobile.importErrors.save", true)
            File(URI(uri)).inputStream()
        })
        val report = importer.importFiles(listOf(selected("Lato-Regular.ttf"), selected("Lato-Bold.ttf"), selected("Inter-Variable.ttf")))
        assertEquals(listOf("unprocessed", "failed", "unprocessed"), report.items.map { it.status })
        assertEquals(0L, report.snapshot.faceCount.toLong())
        assertEquals(2, reads)
        assertClean(root)
    }

    @Test fun refreshFailureRollsBackOnlyNewSources() = scenario { root, engine ->
        importer(root, engine).importFiles(listOf(selected("Lato-Regular.ttf")))
        val query = LibraryQueryDto(null, QueryScopeDto.ALL, null, emptyList(), null, null, null, null, 0uL, 100uL)
        engine.setFavorite(listOf(engine.queryLibrary(query).families.first().faces.first().identityId), true)
        val importer = FolioFontImporter(engine, root, { File(URI(it)).inputStream() }, refresh = { error("refresh failed") })
        assertEquals("failed", importer.importFiles(listOf(selected("Lato-Bold.ttf"))).items.single().status)
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
