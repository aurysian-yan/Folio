import CryptoKit
import Foundation
import ZIPFoundation

// 托管副本、批量去重与受限 ZIP 导入。
struct SelectedImportFile {
    let uri: String
    let name: String
}

struct FontImportItem {
    let name: String
    let archiveName: String?
    let status: String
    var message: String? = nil

    var dictionary: [String: Any] {
        ["name": name, "archiveName": archiveName as Any? ?? NSNull(), "status": status,
         "message": message as Any? ?? NSNull()]
    }
}

struct FontImportReport {
    let snapshot: LibrarySnapshotDto
    let items: [FontImportItem]
}

struct FontImportLimits {
    var fontBytes: UInt64 = 64 * 1024 * 1024
    var archiveBytes: UInt64 = 256 * 1024 * 1024
    var archiveEntries: Int = 10_000
    var fonts: Int = 1_000
    var batchBytes: UInt64 = 512 * 1024 * 1024
}

struct FontImportFailure: Error {
    let detail: String
    var batchLimit = false
}

final class FolioFontImporter {
    private let engine: FolioEngine
    private let directory: URL
    private let temporary: URL
    private let limits: FontImportLimits
    private let refresh: () throws -> LibrarySnapshotDto
    private let manager = FileManager.default
    private var digests = Set<String>()
    private var added: [(RootIdDto, URL)] = []
    private var items: [FontImportItem] = []
    private var fontCount = 0
    private var expandedBytes: UInt64 = 0
    private static let fontExtensions: Set<String> = ["ttf", "otf", "ttc", "otc"]

    init(engine: FolioEngine, root: URL, limits: FontImportLimits = FontImportLimits(),
         refresh: (() throws -> LibrarySnapshotDto)? = nil) {
        self.engine = engine
        self.directory = root.appendingPathComponent("fonts", isDirectory: true)
        self.temporary = root.appendingPathComponent("imports", isDirectory: true).appendingPathComponent(UUID().uuidString)
        self.limits = limits
        self.refresh = refresh ?? { try engine.refreshLibrary().snapshot }
    }

    func importFiles(_ files: [SelectedImportFile]) throws -> FontImportReport {
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        try manager.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: temporary) }
        try indexExistingFiles()
        for file in files {
            let archive = file.name.lowercased().hasSuffix(".zip")
            let staged = stagingFile()
            defer { try? manager.removeItem(at: staged) }
            do {
                if !archive { try claimFont() }
                guard let source = URL(string: file.uri), source.isFileURL else {
                    throw FontImportFailure(detail: "请选择可读取的字体文件。")
                }
                let scoped = source.startAccessingSecurityScopedResource()
                defer { if scoped { source.stopAccessingSecurityScopedResource() } }
                try copy(source, to: staged, maximum: archive ? limits.archiveBytes : limits.fontBytes, chargeBatch: !archive)
                if archive { importArchive(staged, name: file.name) }
                else { importFont(staged, name: file.name, archiveName: nil) }
            } catch {
                items.append(FontImportItem(name: file.name, archiveName: nil, status: "failed",
                    message: message(error, fallback: "无法读取文件，请确认文件可用。")))
            }
        }
        let snapshot: LibrarySnapshotDto
        do {
            snapshot = try added.isEmpty ? engine.loadCachedLibrary() : refresh()
        } catch {
            // 刷新失败仅撤销本批新增来源，保留既有文件与收藏。
            for (id, file) in added.reversed() {
                try? engine.removeLibraryRoot(id: id)
                try? manager.removeItem(at: file)
            }
            _ = try? engine.loadCachedLibrary()
            throw FontImportFailure(detail: "无法更新字体库，本次新增字体未保留，请重试。")
        }
        return FontImportReport(snapshot: snapshot, items: items)
    }

    private func indexExistingFiles() throws {
        let managed = directory.resolvingSymlinksInPath().path + "/"
        for source in try engine.loadCachedLibrary().roots where source.kind == "file" {
            let file = URL(fileURLWithPath: source.displayPath).resolvingSymlinksInPath()
            if file.path.hasPrefix(managed), let digest = try? fingerprint(file) { digests.insert(digest) }
        }
    }

    private func importFont(_ staged: URL, name: String, archiveName: String?) {
        do {
            do { try engine.validateFontFile(path: staged.path) }
            catch { throw FontImportFailure(detail: "字体文件损坏或格式不受支持。") }
            let digest = try fingerprint(staged)
            if digests.contains(digest) {
                items.append(FontImportItem(name: name, archiveName: archiveName, status: "duplicate"))
                return
            }
            let proposedExtension = (name as NSString).pathExtension.lowercased()
            let fileExtension = Self.fontExtensions.contains(proposedExtension) ? proposedExtension : "font"
            let destination = directory.appendingPathComponent(UUID().uuidString).appendingPathExtension(fileExtension)
            var id: RootIdDto?
            do {
                try manager.moveItem(at: staged, to: destination)
                let root = try engine.addFontFile(path: destination.path)
                id = root.id
                added.append((root.id, destination))
                digests.insert(digest)
                items.append(FontImportItem(name: name, archiveName: archiveName, status: "imported"))
            } catch {
                if let id { try? engine.removeLibraryRoot(id: id) }
                try? manager.removeItem(at: destination)
                throw FontImportFailure(detail: "无法保存字体，请检查可用空间后重试。")
            }
        } catch {
            items.append(FontImportItem(name: name, archiveName: archiveName, status: "failed",
                message: message(error, fallback: "无法导入字体，请重试。")))
        }
    }

    private func importArchive(_ source: URL, name: String) {
        do {
            let expected = try archiveEntryCount(source)
            if expected > limits.archiveEntries {
                throw FontImportFailure(detail: "压缩包条目过多，最多支持 \(limits.archiveEntries) 个条目。")
            }
            let archive = try Archive(url: source, accessMode: .read)
            var entries: [Entry] = []
            for entry in archive {
                guard entries.count < limits.archiveEntries else {
                    throw FontImportFailure(detail: "压缩包条目过多，最多支持 \(limits.archiveEntries) 个条目。")
                }
                entries.append(entry)
            }
            // 加密或损坏条目会中止库的迭代，必须拒绝不完整的目录。
            guard entries.count == expected else {
                throw FontImportFailure(detail: "压缩包损坏或已加密。")
            }
            var found = false
            for entry in entries where entry.type != .directory {
                guard Self.safeArchivePath(entry.path) else {
                    found = true
                    items.append(FontImportItem(name: entry.path, archiveName: name, status: "failed",
                        message: "压缩包包含不安全的文件路径。"))
                    continue
                }
                guard Self.fontExtensions.contains((entry.path as NSString).pathExtension.lowercased()) else { continue }
                found = true
                let staged = stagingFile()
                defer { try? manager.removeItem(at: staged) }
                do {
                    try claimFont()
                    guard entry.type == .file else { throw FontImportFailure(detail: "不支持压缩包中的链接。") }
                    guard entry.uncompressedSize <= limits.fontBytes else {
                        throw FontImportFailure(detail: "字体文件超过 \(limits.fontBytes / 1024 / 1024) MiB 限制。")
                    }
                    let output = try outputFile(staged)
                    defer { try? output.close() }
                    var size: UInt64 = 0
                    let checksum = try archive.extract(entry, bufferSize: 64 * 1024) { data in
                        size += UInt64(data.count)
                        try self.charge(UInt64(data.count))
                        guard size <= self.limits.fontBytes else {
                            throw FontImportFailure(detail: "字体文件超过 \(self.limits.fontBytes / 1024 / 1024) MiB 限制。")
                        }
                        try output.write(contentsOf: data)
                    }
                    guard checksum == entry.checksum, size == entry.uncompressedSize else {
                        throw FontImportFailure(detail: "压缩包中的文件校验失败。")
                    }
                    try output.close()
                    importFont(staged, name: entry.path, archiveName: name)
                } catch {
                    items.append(FontImportItem(name: entry.path, archiveName: name, status: "failed",
                        message: message(error, fallback: "无法解压字体，压缩包可能已损坏。")))
                    if let failure = error as? FontImportFailure, failure.batchLimit { break }
                }
            }
            if !found { throw FontImportFailure(detail: "压缩包中没有 TTF、OTF、TTC 或 OTC 字体。") }
        } catch {
            items.append(FontImportItem(name: name, archiveName: nil, status: "failed",
                message: message(error, fallback: "压缩包损坏、已加密或压缩方式不受支持。")))
        }
    }

    private func claimFont() throws {
        guard fontCount < limits.fonts else {
            throw FontImportFailure(detail: "一次最多导入 \(limits.fonts) 个字体文件。", batchLimit: true)
        }
        guard expandedBytes < limits.batchBytes else {
            throw FontImportFailure(detail: "本次导入超过 \(limits.batchBytes / 1024 / 1024) MiB 总量限制。", batchLimit: true)
        }
        fontCount += 1
    }

    private func charge(_ count: UInt64) throws {
        expandedBytes += count
        guard expandedBytes <= limits.batchBytes else {
            throw FontImportFailure(detail: "本次导入超过 \(limits.batchBytes / 1024 / 1024) MiB 总量限制。", batchLimit: true)
        }
    }

    private func copy(_ source: URL, to destination: URL, maximum: UInt64, chargeBatch: Bool) throws {
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        let output = try outputFile(destination)
        defer { try? output.close() }
        var size: UInt64 = 0
        while let data = try input.read(upToCount: 64 * 1024), !data.isEmpty {
            size += UInt64(data.count)
            if chargeBatch { try charge(UInt64(data.count)) }
            guard size <= maximum else { throw FontImportFailure(detail: "文件超过 \(maximum / 1024 / 1024) MiB 限制。") }
            try output.write(contentsOf: data)
        }
    }

    private func fingerprint(_ source: URL) throws -> String {
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        var hash = SHA256()
        while let data = try input.read(upToCount: 64 * 1024), !data.isEmpty { hash.update(data: data) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func outputFile(_ destination: URL) throws -> FileHandle {
        guard manager.createFile(atPath: destination.path, contents: nil) else {
            throw FontImportFailure(detail: "无法保存文件，请检查可用空间后重试。")
        }
        return try FileHandle(forWritingTo: destination)
    }

    private func stagingFile() -> URL { temporary.appendingPathComponent(UUID().uuidString) }
    private func message(_ error: Error, fallback: String) -> String { (error as? FontImportFailure)?.detail ?? fallback }

    static func safeArchivePath(_ path: String) -> Bool {
        let normalized = path.replacingOccurrences(of: "\\", with: "/")
        return !normalized.isEmpty && !normalized.hasPrefix("/") && !normalized.contains("\0")
            && normalized.range(of: "^[A-Za-z]:", options: .regularExpression) == nil
            && !normalized.components(separatedBy: "/").contains("..")
    }

    // 只读取有界尾部，核对 ZIP 声明的条目数与迭代结果。
    private func archiveEntryCount(_ source: URL) throws -> Int {
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        let size = try input.seekToEnd()
        let length = min(size, 65_557)
        try input.seek(toOffset: size - length)
        let tail = try input.read(upToCount: Int(length)) ?? Data()
        guard tail.count >= 22 else { throw FontImportFailure(detail: "压缩包损坏或格式不受支持。") }
        func value(_ offset: Int, _ count: Int) -> Int {
            (0..<count).reduce(0) { $0 | (Int(tail[offset + $1]) << ($1 * 8)) }
        }
        for offset in stride(from: tail.count - 22, through: 0, by: -1) {
            if value(offset, 4) != 0x06054b50 || offset + 22 + value(offset + 20, 2) != tail.count { continue }
            guard value(offset + 4, 2) == 0, value(offset + 6, 2) == 0,
                  value(offset + 8, 2) == value(offset + 10, 2) else {
                throw FontImportFailure(detail: "不支持分卷 ZIP 压缩包。")
            }
            return value(offset + 10, 2)
        }
        throw FontImportFailure(detail: "压缩包损坏或格式不受支持。")
    }
}
