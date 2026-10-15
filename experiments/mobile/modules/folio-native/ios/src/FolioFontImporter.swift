import CryptoKit
import Foundation
import ZIPFoundation

// 字体全量准备、顺序分批导入与批次回滚。
struct SelectedImportFile {
    let uri: String
    let name: String
}

struct FontImportItem {
    let name: String
    let archiveName: String?
    var status: String
    var message: String? = nil
    var messageKey: String? = nil

    var dictionary: [String: Any] {
        ["name": name, "archiveName": archiveName as Any? ?? NSNull(), "status": status,
         "message": message as Any? ?? NSNull(), "messageKey": messageKey as Any? ?? NSNull()]
    }
}

struct FontImportReport {
    let snapshot: LibrarySnapshotDto
    let items: [FontImportItem]
}

struct FontImportLimits {
    var batchFonts: Int = 1_000
}

struct FontImportFailure: Error {
    let detail: String
    var terminal = false
}

final class FolioFontImporter {
    private struct PreparedFont { let file: URL; let index: Int }
    private struct AddedFont { let id: RootIdDto; let file: URL; let digest: String }
    private let engine: FolioEngine
    private let directory: URL
    private let temporary: URL
    private let limits: FontImportLimits
    private let refresh: () throws -> LibrarySnapshotDto
    private let manager = FileManager.default
    private var digests = Set<String>()
    private var added: [AddedFont] = []
    private var dependentDuplicates = Set<Int>()
    private var items: [FontImportItem] = []
    private var prepared: [PreparedFont] = []
    private static let fontExtensions: Set<String> = ["ttf", "otf", "ttc", "otc"]

    init(engine: FolioEngine, root: URL, limits: FontImportLimits = FontImportLimits(),
         refresh: (() throws -> LibrarySnapshotDto)? = nil) {
        precondition(limits.batchFonts > 0)
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
        var snapshot = try engine.loadCachedLibrary()
        try indexExistingFiles()
        var stopped = false
        for file in files {
            if stopped {
                items.append(FontImportItem(name: file.name, archiveName: nil, status: "unprocessed", messageKey: key("stopped")))
                continue
            }
            let archive = file.name.lowercased().hasSuffix(".zip")
            let staged = stagingFile()
            let start = items.count
            var queued = false
            var fallback = "read"
            defer {
                if !queued { try? manager.removeItem(at: staged) }
            }
            do {
                guard let source = URL(string: file.uri), source.isFileURL else {
                    throw FontImportFailure(detail: key("read"))
                }
                let scoped = source.startAccessingSecurityScopedResource()
                defer { if scoped { source.stopAccessingSecurityScopedResource() } }
                try copy(source, to: staged)
                if archive {
                    fallback = "invalidArchive"
                    try prepareArchive(staged, name: file.name)
                } else {
                    enqueue(staged, name: file.name, archiveName: nil)
                    queued = true
                }
            } catch {
                stopped = (error as? FontImportFailure)?.terminal == true
                if items.count == start || !stopped {
                    items.append(failure(file.name, archiveName: nil, error: error, fallback: fallback))
                }
            }
        }
        if !stopped {
            for start in stride(from: 0, to: prepared.count, by: limits.batchFonts) {
                let batch = Array(prepared[start..<min(start + limits.batchFonts, prepared.count)])
                var batchStopped = false
                for font in batch {
                    defer { try? manager.removeItem(at: font.file) }
                    do { try autoreleasepool { try importFont(font) } }
                    catch { batchStopped = true; break }
                }
                do {
                    if batchStopped { throw FontImportFailure(detail: key("save"), terminal: true) }
                    if !added.isEmpty { snapshot = try refresh() }
                } catch {
                    try rollback(batch)
                    snapshot = try engine.loadCachedLibrary()
                    break
                }
                added.removeAll()
                dependentDuplicates.removeAll()
            }
        }
        return FontImportReport(snapshot: snapshot, items: items)
    }

    private func enqueue(_ file: URL, name: String, archiveName: String?) {
        prepared.append(PreparedFont(file: file, index: items.count))
        items.append(FontImportItem(name: name, archiveName: archiveName, status: "unprocessed", messageKey: key("stopped")))
    }

    private func indexExistingFiles() throws {
        for file in try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            guard Self.fontExtensions.contains(file.pathExtension.lowercased()) || file.pathExtension.lowercased() == "font" else { continue }
            digests.insert(try fingerprint(file))
        }
    }

    private func importFont(_ font: PreparedFont) throws {
        let item = items[font.index]
        do {
            do { try engine.validateFontFile(path: font.file.path) }
            catch { throw FontImportFailure(detail: key("invalidFont")) }
            let digest = try fingerprint(font.file)
            if digests.contains(digest) {
                if added.contains(where: { $0.digest == digest }) { dependentDuplicates.insert(font.index) }
                items[font.index].status = "duplicate"
                items[font.index].messageKey = nil
                return
            }
            let proposedExtension = (item.name as NSString).pathExtension.lowercased()
            let fileExtension = Self.fontExtensions.contains(proposedExtension) ? proposedExtension : "font"
            let destination = directory.appendingPathComponent(UUID().uuidString).appendingPathExtension(fileExtension)
            do {
                try manager.moveItem(at: font.file, to: destination)
                let root = try engine.addFontFile(path: destination.path)
                added.append(AddedFont(id: root.id, file: destination, digest: digest))
            } catch {
                try? manager.removeItem(at: destination)
                throw FontImportFailure(detail: key("save"), terminal: true)
            }
            digests.insert(digest)
            items[font.index].status = "imported"
            items[font.index].messageKey = nil
        } catch {
            items[font.index] = failure(item.name, archiveName: item.archiveName, error: error, fallback: "invalidFont")
            if (error as? FontImportFailure)?.terminal == true { throw error }
        }
    }

    private func rollback(_ batch: [PreparedFont]) throws {
        // 仅撤销当前批次；引用本批新增内容的重复项同步标记失败。
        var failed = false
        for font in added.reversed() {
            do {
                try engine.removeLibraryRoot(id: font.id)
                try manager.removeItem(at: font.file)
            } catch { failed = true }
            digests.remove(font.digest)
        }
        for font in batch where items[font.index].status == "imported" || dependentDuplicates.contains(font.index) {
            items[font.index].status = "failed"
            items[font.index].messageKey = key("batchRolledBack")
        }
        added.removeAll()
        dependentDuplicates.removeAll()
        if failed { throw FontImportFailure(detail: key("rollback"), terminal: true) }
    }

    private func prepareArchive(_ source: URL, name: String) throws {
        let expected = try archiveEntryCount(source)
        let archive = try Archive(url: source, accessMode: .read)
        // 加密或损坏条目会中止迭代，完整目录核验通过后才开始解压。
        var count: UInt64 = 0
        for _ in archive { count += 1 }
        guard count == expected else { throw FontImportFailure(detail: key("invalidArchive")) }
        var found = false
        var terminalFailure: FontImportFailure?
        for entry in archive where entry.type != .directory {
            guard Self.safeArchivePath(entry.path) else {
                found = true
                items.append(FontImportItem(name: entry.path, archiveName: name, status: "failed", messageKey: key("unsafePath")))
                continue
            }
            guard Self.fontExtensions.contains((entry.path as NSString).pathExtension.lowercased()) else { continue }
            found = true
            if terminalFailure != nil {
                items.append(FontImportItem(name: entry.path, archiveName: name, status: "unprocessed", messageKey: key("stopped")))
                continue
            }
            let staged = stagingFile()
            do {
                guard entry.type == .file else { throw FontImportFailure(detail: key("link")) }
                let output = try outputFile(staged)
                defer { try? output.close() }
                var size: UInt64 = 0
                let checksum = try archive.extract(entry, bufferSize: 64 * 1024) { data in
                    size += UInt64(data.count)
                    try self.write(data, to: output)
                }
                guard checksum == entry.checksum, size == entry.uncompressedSize else {
                    throw FontImportFailure(detail: key("checksum"))
                }
                do { try output.close() }
                catch { throw FontImportFailure(detail: key("save"), terminal: true) }
                enqueue(staged, name: entry.path, archiveName: name)
            } catch {
                try? manager.removeItem(at: staged)
                items.append(failure(entry.path, archiveName: name, error: error, fallback: "invalidArchive"))
                if let failure = error as? FontImportFailure, failure.terminal { terminalFailure = failure }
            }
        }
        if let terminalFailure { throw terminalFailure }
        if !found { throw FontImportFailure(detail: key("emptyArchive")) }
    }

    private func copy(_ source: URL, to destination: URL) throws {
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        let output = try outputFile(destination)
        defer { try? output.close() }
        while try autoreleasepool(invoking: {
            guard let data = try input.read(upToCount: 64 * 1024), !data.isEmpty else { return false }
            try write(data, to: output)
            return true
        }) { }
        do { try output.close() }
        catch { throw FontImportFailure(detail: key("save"), terminal: true) }
    }

    private func write(_ data: Data, to output: FileHandle) throws {
        do { try output.write(contentsOf: data) }
        catch { throw FontImportFailure(detail: key("save"), terminal: true) }
    }

    private func fingerprint(_ source: URL) throws -> String {
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        var hash = SHA256()
        while try autoreleasepool(invoking: {
            guard let data = try input.read(upToCount: 64 * 1024), !data.isEmpty else { return false }
            hash.update(data: data)
            return true
        }) { }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func outputFile(_ destination: URL) throws -> FileHandle {
        do {
            guard manager.createFile(atPath: destination.path, contents: nil) else { throw FontImportFailure(detail: key("save"), terminal: true) }
            return try FileHandle(forWritingTo: destination)
        } catch { throw FontImportFailure(detail: key("save"), terminal: true) }
    }

    private func stagingFile() -> URL { temporary.appendingPathComponent(UUID().uuidString) }
    private func key(_ name: String) -> String { "mobile.importErrors.\(name)" }
    private func failure(_ name: String, archiveName: String?, error: Error, fallback: String) -> FontImportItem {
        let detail = (error as? FontImportFailure)?.detail
        if let detail, !detail.hasPrefix("mobile.") {
            return FontImportItem(name: name, archiveName: archiveName, status: "failed", message: detail)
        }
        return FontImportItem(name: name, archiveName: archiveName, status: "failed", messageKey: detail ?? key(fallback))
    }

    static func safeArchivePath(_ path: String) -> Bool {
        let normalized = path.replacingOccurrences(of: "\\", with: "/")
        return !normalized.isEmpty && !normalized.hasPrefix("/") && !normalized.contains("\0")
            && normalized.range(of: "^[A-Za-z]:", options: .regularExpression) == nil
            && !normalized.components(separatedBy: "/").contains("..")
    }

    // 有界读取 EOCD 与 ZIP64 记录，核对条目总数并拒绝分卷。
    private func archiveEntryCount(_ source: URL) throws -> UInt64 {
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        let size = try input.seekToEnd()
        func read(_ offset: UInt64, _ count: Int) throws -> Data {
            guard offset <= size, UInt64(count) <= size - offset else { throw FontImportFailure(detail: key("invalidArchive")) }
            try input.seek(toOffset: offset)
            let data = try input.read(upToCount: count) ?? Data()
            guard data.count == count else { throw FontImportFailure(detail: key("invalidArchive")) }
            return data
        }
        func value(_ data: Data, _ offset: Int, _ count: Int) -> UInt64 {
            (0..<count).reduce(UInt64(0)) { $0 | (UInt64(data[offset + $1]) << ($1 * 8)) }
        }
        let length = min(size, 65_557)
        let tail = try read(size - length, Int(length))
        guard tail.count >= 22 else { throw FontImportFailure(detail: key("invalidArchive")) }
        for offset in stride(from: tail.count - 22, through: 0, by: -1) {
            if value(tail, offset, 4) != 0x06054b50 || offset + 22 + Int(value(tail, offset + 20, 2)) != tail.count { continue }
            guard value(tail, offset + 4, 2) == 0, value(tail, offset + 6, 2) == 0,
                  value(tail, offset + 8, 2) == value(tail, offset + 10, 2) else {
                throw FontImportFailure(detail: key("splitArchive"))
            }
            let eocdOffset = size - length + UInt64(offset)
            if eocdOffset >= 20 {
                let locator = try read(eocdOffset - 20, 20)
                if value(locator, 0, 4) == 0x07064b50 {
                    guard value(locator, 4, 4) == 0, value(locator, 16, 4) == 1 else {
                        throw FontImportFailure(detail: key("splitArchive"))
                    }
                    let recordOffset = value(locator, 8, 8)
                    let record = try read(recordOffset, 56)
                    let recordSize = value(record, 4, 8)
                    guard value(record, 0, 4) == 0x06064b50, recordSize >= 44,
                          recordOffset <= eocdOffset - 20, eocdOffset - 20 - recordOffset >= 12,
                          recordSize == eocdOffset - 20 - recordOffset - 12 else {
                        throw FontImportFailure(detail: key("invalidArchive"))
                    }
                    guard value(record, 16, 4) == 0, value(record, 20, 4) == 0,
                          value(record, 24, 8) == value(record, 32, 8) else {
                        throw FontImportFailure(detail: key("splitArchive"))
                    }
                    let centralOffset = value(record, 48, 8)
                    let centralSize = value(record, 40, 8)
                    guard centralOffset <= recordOffset, centralSize <= recordOffset - centralOffset else {
                        throw FontImportFailure(detail: key("invalidArchive"))
                    }
                    return value(record, 32, 8)
                }
            }
            guard value(tail, offset + 10, 2) != 0xffff,
                  value(tail, offset + 12, 4) != 0xffffffff, value(tail, offset + 16, 4) != 0xffffffff else {
                throw FontImportFailure(detail: key("invalidArchive"))
            }
            let centralOffset = value(tail, offset + 16, 4)
            guard centralOffset <= eocdOffset, value(tail, offset + 12, 4) <= eocdOffset - centralOffset else {
                throw FontImportFailure(detail: key("invalidArchive"))
            }
            return value(tail, offset + 10, 2)
        }
        throw FontImportFailure(detail: key("invalidArchive"))
    }
}
