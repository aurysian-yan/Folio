package com.folio.poc

import com.folio.poc.ffi.FolioEngine
import com.folio.poc.ffi.LibrarySnapshotDto
import com.folio.poc.ffi.RootIdDto
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.CRC32
import java.util.zip.ZipFile

// 托管副本、批量去重与受限 ZIP 导入。
internal data class SelectedImportFile(val uri: String, val name: String)
internal data class FontImportItem(
    val name: String, val archiveName: String?, val status: String, val message: String? = null
) {
    fun dictionary() = mapOf("name" to name, "archiveName" to archiveName, "status" to status, "message" to message)
}
internal data class FontImportReport(val snapshot: LibrarySnapshotDto, val items: List<FontImportItem>)
internal data class FontImportLimits(
    val fontBytes: Long = 64L * 1024 * 1024,
    val archiveBytes: Long = 256L * 1024 * 1024,
    val archiveEntries: Int = 10_000,
    val fonts: Int = 1_000,
    val batchBytes: Long = 512L * 1024 * 1024
)

internal class FontImportFailure(val detail: String, val batchLimit: Boolean = false) : Exception(detail)

internal class FolioFontImporter(
    private val engine: FolioEngine,
    private val root: File,
    private val openSource: (String) -> InputStream,
    private val limits: FontImportLimits = FontImportLimits(),
    private val refresh: () -> LibrarySnapshotDto = { engine.refreshLibrary().snapshot }
) {
    private val directory = File(root, "fonts")
    private val temporary = File(root, "imports/${UUID.randomUUID()}")
    private val digests = mutableSetOf<String>()
    private val added = mutableListOf<Pair<RootIdDto, File>>()
    private val items = mutableListOf<FontImportItem>()
    private var fontCount = 0
    private var expandedBytes = 0L

    fun importFiles(files: List<SelectedImportFile>): FontImportReport {
        check(directory.isDirectory || directory.mkdirs())
        check(temporary.mkdirs())
        try {
            indexExistingFiles()
            for (file in files) {
                val archive = file.name.endsWith(".zip", ignoreCase = true)
                val staged = stagingFile()
                try {
                    if (!archive) claimFont()
                    openSource(file.uri).use { input ->
                        copy(input, staged, if (archive) limits.archiveBytes else limits.fontBytes, !archive)
                    }
                    if (archive) importArchive(staged, file.name) else importFont(staged, file.name, null)
                } catch (error: Exception) {
                    items.add(FontImportItem(file.name, null, "failed", message(error, "无法读取文件，请确认文件可用。")))
                } finally {
                    staged.delete()
                }
            }
            val snapshot = try {
                if (added.isEmpty()) engine.loadCachedLibrary() else refresh()
            } catch (error: Exception) {
                // 刷新失败仅撤销本批新增来源，保留既有文件与收藏。
                for ((id, file) in added.asReversed()) {
                    runCatching { engine.removeLibraryRoot(id) }
                    file.delete()
                }
                runCatching { engine.loadCachedLibrary() }
                throw FontImportFailure("无法更新字体库，本次新增字体未保留，请重试。")
            }
            return FontImportReport(snapshot, items.toList())
        } finally {
            temporary.deleteRecursively()
        }
    }

    private fun indexExistingFiles() {
        for (file in directory.listFiles().orEmpty()) {
            if (file.isFile && (file.extension.lowercase() in fontExtensions || file.extension.lowercase() == "font")) {
                digests.add(fingerprint(file))
            }
        }
    }

    private fun importFont(staged: File, name: String, archiveName: String?) {
        try {
            try {
                engine.validateFontFile(staged.absolutePath)
            } catch (error: Exception) {
                throw FontImportFailure("字体文件损坏或格式不受支持。")
            }
            val digest = fingerprint(staged)
            if (digest in digests) {
                items.add(FontImportItem(name, archiveName, "duplicate"))
                return
            }
            val extension = name.substringAfterLast('.', "").lowercase().takeIf { it in fontExtensions } ?: "font"
            val destination = File(directory, "${UUID.randomUUID()}.$extension")
            var id: RootIdDto? = null
            try {
                check(staged.renameTo(destination))
                id = engine.addFontFile(destination.absolutePath).id
                added.add(id to destination)
                digests.add(digest)
                items.add(FontImportItem(name, archiveName, "imported"))
            } catch (error: Exception) {
                id?.let { runCatching { engine.removeLibraryRoot(it) } }
                destination.delete()
                throw FontImportFailure("无法保存字体，请检查可用空间后重试。")
            }
        } catch (error: Exception) {
            items.add(FontImportItem(name, archiveName, "failed", message(error, "无法导入字体，请重试。")))
        }
    }

    private fun importArchive(source: File, archiveName: String) {
        try {
            ZipFile(source).use { archive ->
                if (archive.size() > limits.archiveEntries) throw FontImportFailure("压缩包条目过多，最多支持 ${limits.archiveEntries} 个条目。")
                var found = false
                val entries = archive.entries()
                while (entries.hasMoreElements()) {
                    val entry = entries.nextElement()
                    if (entry.isDirectory) continue
                    if (!safeArchivePath(entry.name)) {
                        found = true
                        items.add(FontImportItem(entry.name, archiveName, "failed", "压缩包包含不安全的文件路径。"))
                        continue
                    }
                    if (entry.name.substringAfterLast('.', "").lowercase() !in fontExtensions) continue
                    found = true
                    val staged = stagingFile()
                    try {
                        claimFont()
                        if (entry.method !in listOf(0, 8)) throw FontImportFailure("不支持此 ZIP 压缩方式。")
                        if (entry.size > limits.fontBytes) throw FontImportFailure("字体文件超过 ${limits.fontBytes / 1024 / 1024} MiB 限制。")
                        val crc = CRC32()
                        archive.getInputStream(entry).use { input -> copy(input, staged, limits.fontBytes, true, crc) }
                        if (crc.value != entry.crc || (entry.size >= 0 && staged.length() != entry.size)) {
                            throw FontImportFailure("压缩包中的文件校验失败。")
                        }
                        importFont(staged, entry.name, archiveName)
                    } catch (error: Exception) {
                        items.add(FontImportItem(entry.name, archiveName, "failed", message(error, "无法解压字体，压缩包可能已损坏。")))
                        if (error is FontImportFailure && error.batchLimit) break
                    } finally {
                        staged.delete()
                    }
                }
                if (!found) throw FontImportFailure("压缩包中没有 TTF、OTF、TTC 或 OTC 字体。")
            }
        } catch (error: Exception) {
            items.add(FontImportItem(archiveName, null, "failed", message(error, "压缩包损坏、已加密或压缩方式不受支持。")))
        }
    }

    private fun claimFont() {
        if (fontCount >= limits.fonts) throw FontImportFailure("一次最多导入 ${limits.fonts} 个字体文件。", true)
        if (expandedBytes >= limits.batchBytes) throw FontImportFailure("本次导入超过 ${limits.batchBytes / 1024 / 1024} MiB 总量限制。", true)
        fontCount += 1
    }

    private fun copy(input: InputStream, destination: File, maximum: Long, chargeBatch: Boolean, crc: CRC32? = null) {
        var size = 0L
        val buffer = ByteArray(64 * 1024)
        destination.outputStream().use { output ->
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                size += count
                if (chargeBatch) {
                    expandedBytes += count
                    if (expandedBytes > limits.batchBytes) throw FontImportFailure("本次导入超过 ${limits.batchBytes / 1024 / 1024} MiB 总量限制。", true)
                }
                if (size > maximum) throw FontImportFailure("文件超过 ${maximum / 1024 / 1024} MiB 限制。")
                output.write(buffer, 0, count)
                crc?.update(buffer, 0, count)
            }
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
    private fun message(error: Exception, fallback: String) = (error as? FontImportFailure)?.detail ?: fallback

    companion object {
        private val fontExtensions = setOf("ttf", "otf", "ttc", "otc")

        fun safeArchivePath(path: String): Boolean {
            val normalized = path.replace('\\', '/')
            return normalized.isNotEmpty() && !normalized.startsWith('/') && !normalized.contains('\u0000')
                && !Regex("^[A-Za-z]:").containsMatchIn(normalized) && normalized.split('/').none { it == ".." }
        }
    }
}
