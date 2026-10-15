package com.folio.poc

import com.folio.poc.ffi.FolioEngine
import com.folio.poc.ffi.LibrarySnapshotDto
import com.folio.poc.ffi.RootIdDto
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.CRC32
import java.util.zip.ZipFile

// 字体全量准备、顺序分批导入与批次回滚。
internal data class SelectedImportFile(val uri: String, val name: String)
internal data class FontImportItem(
    val name: String, val archiveName: String?, val status: String, val message: String? = null,
    val messageKey: String? = null
) {
    fun dictionary() = mapOf("name" to name, "archiveName" to archiveName, "status" to status,
        "message" to message, "messageKey" to messageKey)
}
internal data class FontImportReport(val snapshot: LibrarySnapshotDto, val items: List<FontImportItem>)
internal data class FontImportLimits(val batchFonts: Int = 1_000) {
    init { require(batchFonts > 0) }
}
internal class FontImportFailure(val detail: String, val terminal: Boolean = false) : Exception(detail)

internal class FolioFontImporter(
    private val engine: FolioEngine,
    private val root: File,
    private val openSource: (String) -> InputStream,
    private val limits: FontImportLimits = FontImportLimits(),
    private val refresh: () -> LibrarySnapshotDto = { engine.refreshLibrary().snapshot }
) {
    private data class PreparedFont(val file: File, val index: Int)
    private data class AddedFont(val id: RootIdDto, val file: File, val digest: String)
    private val directory = File(root, "fonts")
    private val temporary = File(root, "imports/${UUID.randomUUID()}")
    private val digests = mutableSetOf<String>()
    private val added = mutableListOf<AddedFont>()
    private val dependentDuplicates = mutableSetOf<Int>()
    private val items = mutableListOf<FontImportItem>()
    private val prepared = mutableListOf<PreparedFont>()

    fun importFiles(files: List<SelectedImportFile>): FontImportReport {
        check(directory.isDirectory || directory.mkdirs())
        check(temporary.mkdirs())
        try {
            var snapshot = engine.loadCachedLibrary()
            indexExistingFiles()
            var stopped = false
            for (file in files) {
                if (stopped) {
                    items.add(FontImportItem(file.name, null, "unprocessed", messageKey = key("stopped")))
                    continue
                }
                val archive = file.name.endsWith(".zip", ignoreCase = true)
                val staged = stagingFile()
                val start = items.size
                var queued = false
                var fallback = "read"
                try {
                    openSource(file.uri).use { copy(it, staged) }
                    if (archive) {
                        fallback = "invalidArchive"
                        prepareArchive(staged, file.name)
                    } else {
                        enqueue(staged, file.name, null)
                        queued = true
                    }
                } catch (error: Exception) {
                    stopped = error is FontImportFailure && error.terminal
                    if (items.size == start || !stopped) items.add(failure(file.name, null, error, fallback))
                } finally {
                    if (!queued) staged.delete()
                }
            }
            if (!stopped) {
                for (start in prepared.indices step limits.batchFonts) {
                    val batch = prepared.subList(start, minOf(start + limits.batchFonts, prepared.size))
                    var batchStopped = false
                    for (font in batch) {
                        try { importFont(font) }
                        catch (error: FontImportFailure) {
                            batchStopped = true
                            break
                        } finally { font.file.delete() }
                    }
                    try {
                        if (batchStopped) throw FontImportFailure(key("save"), true)
                        if (added.isNotEmpty()) snapshot = refresh()
                    } catch (error: Exception) {
                        rollback(batch)
                        snapshot = engine.loadCachedLibrary()
                        break
                    }
                    added.clear()
                    dependentDuplicates.clear()
                }
            }
            return FontImportReport(snapshot, items.toList())
        } finally { temporary.deleteRecursively() }
    }

    private fun enqueue(file: File, name: String, archiveName: String?) {
        prepared.add(PreparedFont(file, items.size))
        items.add(FontImportItem(name, archiveName, "unprocessed", messageKey = key("stopped")))
    }

    private fun indexExistingFiles() {
        for (file in directory.listFiles().orEmpty()) {
            if (file.isFile && (file.extension.lowercase() in fontExtensions || file.extension.lowercase() == "font")) {
                digests.add(fingerprint(file))
            }
        }
    }

    private fun importFont(font: PreparedFont) {
        val item = items[font.index]
        try {
            try { engine.validateFontFile(font.file.absolutePath) }
            catch (error: Exception) { throw FontImportFailure(key("invalidFont")) }
            val digest = fingerprint(font.file)
            if (digest in digests) {
                if (added.any { it.digest == digest }) dependentDuplicates.add(font.index)
                items[font.index] = item.copy(status = "duplicate", messageKey = null)
                return
            }
            val extension = item.name.substringAfterLast('.', "").lowercase().takeIf { it in fontExtensions } ?: "font"
            val destination = File(directory, "${UUID.randomUUID()}.$extension")
            try {
                check(font.file.renameTo(destination))
                val id = engine.addFontFile(destination.absolutePath).id
                added.add(AddedFont(id, destination, digest))
            } catch (error: Exception) {
                destination.delete()
                throw FontImportFailure(key("save"), true)
            }
            digests.add(digest)
            items[font.index] = item.copy(status = "imported", messageKey = null)
        } catch (error: Exception) {
            items[font.index] = failure(item.name, item.archiveName, error, "invalidFont")
            if (error is FontImportFailure && error.terminal) throw error
        }
    }

    private fun rollback(batch: List<PreparedFont>) {
        // 仅撤销当前批次；引用本批新增内容的重复项同步标记失败。
        var failed = false
        for (font in added.asReversed()) {
            try {
                engine.removeLibraryRoot(font.id)
                if (!font.file.delete() && font.file.exists()) failed = true
            } catch (error: Exception) { failed = true }
            digests.remove(font.digest)
        }
        for (font in batch) {
            val item = items[font.index]
            if (item.status == "imported" || font.index in dependentDuplicates) {
                items[font.index] = item.copy(status = "failed", messageKey = key("batchRolledBack"))
            }
        }
        added.clear()
        dependentDuplicates.clear()
        if (failed) throw FontImportFailure(key("rollback"), true)
    }

    private fun prepareArchive(source: File, archiveName: String) {
        val links = archiveLinks(source)
        ZipFile(source).use { archive ->
            var found = false
            var entryIndex = 0
            var terminalFailure: FontImportFailure? = null
            val entries = archive.entries()
            while (entries.hasMoreElements()) {
                val entry = entries.nextElement()
                val linked = entryIndex++ in links
                if (entry.isDirectory) continue
                if (!safeArchivePath(entry.name)) {
                    found = true
                    items.add(FontImportItem(entry.name, archiveName, "failed", messageKey = key("unsafePath")))
                    continue
                }
                if (entry.name.substringAfterLast('.', "").lowercase() !in fontExtensions) continue
                found = true
                if (terminalFailure != null) {
                    items.add(FontImportItem(entry.name, archiveName, "unprocessed", messageKey = key("stopped")))
                    continue
                }
                val staged = stagingFile()
                try {
                    if (linked) throw FontImportFailure(key("link"))
                    if (entry.method !in listOf(0, 8)) throw FontImportFailure(key("method"))
                    val crc = CRC32()
                    archive.getInputStream(entry).use { copy(it, staged, crc) }
                    if (crc.value != entry.crc || (entry.size >= 0 && staged.length() != entry.size)) {
                        throw FontImportFailure(key("checksum"))
                    }
                    enqueue(staged, entry.name, archiveName)
                } catch (error: Exception) {
                    staged.delete()
                    items.add(failure(entry.name, archiveName, error, "invalidArchive"))
                    if (error is FontImportFailure && error.terminal) terminalFailure = error
                }
            }
            terminalFailure?.let { throw it }
            if (!found) throw FontImportFailure(key("emptyArchive"))
        }
    }

    // 有界读取 ZIP 目录元数据，拒绝分卷、加密与链接条目。
    private fun archiveLinks(source: File): Set<Int> = RandomAccessFile(source, "r").use { input ->
        val size = input.length()
        fun read(offset: Long, count: Int): ByteArray {
            if (offset < 0 || offset > size || count.toLong() > size - offset) throw FontImportFailure(key("invalidArchive"))
            return ByteArray(count).also { input.seek(offset); input.readFully(it) }
        }
        fun value(data: ByteArray, offset: Int, count: Int): Long {
            var result = 0L
            for (index in 0 until count) result = result or ((data[offset + index].toLong() and 255) shl (index * 8))
            if (result < 0) throw FontImportFailure(key("invalidArchive"))
            return result
        }
        val tail = read(size - minOf(size, 65_557), minOf(size, 65_557).toInt())
        val end = (tail.size - 22 downTo 0).firstOrNull {
            value(tail, it, 4) == 0x06054b50L && it + 22 + value(tail, it + 20, 2) == tail.size.toLong()
        } ?: throw FontImportFailure(key("invalidArchive"))
        if (value(tail, end + 4, 2) != 0L || value(tail, end + 6, 2) != 0L ||
            value(tail, end + 8, 2) != value(tail, end + 10, 2)) throw FontImportFailure(key("splitArchive"))
        val eocdOffset = size - tail.size + end
        var count = value(tail, end + 10, 2)
        var centralSize = value(tail, end + 12, 4)
        var centralOffset = value(tail, end + 16, 4)
        var centralEnd = eocdOffset
        val locator = if (eocdOffset >= 20) read(eocdOffset - 20, 20) else null
        if (locator != null && value(locator, 0, 4) == 0x07064b50L) {
            if (value(locator, 4, 4) != 0L || value(locator, 16, 4) != 1L) throw FontImportFailure(key("splitArchive"))
            val recordOffset = value(locator, 8, 8)
            val record = read(recordOffset, 56)
            if (value(record, 0, 4) != 0x06064b50L || value(record, 4, 8) < 44 ||
                recordOffset > eocdOffset - 32 || value(record, 4, 8) != eocdOffset - 32 - recordOffset) {
                throw FontImportFailure(key("invalidArchive"))
            }
            if (value(record, 16, 4) != 0L || value(record, 20, 4) != 0L ||
                value(record, 24, 8) != value(record, 32, 8)) throw FontImportFailure(key("splitArchive"))
            count = value(record, 32, 8)
            centralSize = value(record, 40, 8)
            centralOffset = value(record, 48, 8)
            centralEnd = recordOffset
        } else if (count == 0xffffL || centralSize == 0xffffffffL || centralOffset == 0xffffffffL) {
            throw FontImportFailure(key("invalidArchive"))
        }
        if (centralOffset > centralEnd || centralSize > centralEnd - centralOffset || count > centralSize / 46) {
            throw FontImportFailure(key("invalidArchive"))
        }
        val links = mutableSetOf<Int>()
        var offset = centralOffset
        for (index in 0 until count) {
            if (centralOffset + centralSize - offset < 46) throw FontImportFailure(key("invalidArchive"))
            val entry = read(offset, 46)
            if (value(entry, 0, 4) != 0x02014b50L || value(entry, 8, 2) and 1 != 0L) {
                throw FontImportFailure(key("invalidArchive"))
            }
            if (value(entry, 34, 2) != 0L) throw FontImportFailure(key("splitArchive"))
            if ((value(entry, 38, 4) ushr 16) and 0xf000 == 0xa000L) links.add(index.toInt())
            val length = 46 + value(entry, 28, 2) + value(entry, 30, 2) + value(entry, 32, 2)
            if (length > centralOffset + centralSize - offset) throw FontImportFailure(key("invalidArchive"))
            offset += length
        }
        if (offset != centralOffset + centralSize) throw FontImportFailure(key("invalidArchive"))
        links
    }

    private fun copy(input: InputStream, destination: File, crc: CRC32? = null) {
        val buffer = ByteArray(64 * 1024)
        val output = try { destination.outputStream() }
        catch (error: IOException) { throw FontImportFailure(key("save"), true) }
        try {
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                try { output.write(buffer, 0, count) }
                catch (error: IOException) { throw FontImportFailure(key("save"), true) }
                crc?.update(buffer, 0, count)
            }
        } finally {
            try { output.close() }
            catch (error: IOException) { throw FontImportFailure(key("save"), true) }
        }
    }

    private fun fingerprint(file: File): String {
        val hash = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(64 * 1024)
        file.inputStream().use { input ->
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                hash.update(buffer, 0, count)
            }
        }
        return hash.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private fun stagingFile() = File(temporary, UUID.randomUUID().toString())
    private fun key(name: String) = "mobile.importErrors.$name"
    private fun failure(name: String, archive: String?, error: Exception, fallback: String): FontImportItem {
        val detail = (error as? FontImportFailure)?.detail
        return if (detail != null && !detail.startsWith("mobile.")) FontImportItem(name, archive, "failed", detail)
        else FontImportItem(name, archive, "failed", messageKey = detail ?: key(fallback))
    }

    companion object {
        private val fontExtensions = setOf("ttf", "otf", "ttc", "otc")
        fun safeArchivePath(path: String): Boolean {
            val normalized = path.replace('\\', '/')
            return normalized.isNotEmpty() && !normalized.startsWith('/') && !normalized.contains('\u0000')
                && !Regex("^[A-Za-z]:").containsMatchIn(normalized) && normalized.split('/').none { it == ".." }
        }
    }
}
