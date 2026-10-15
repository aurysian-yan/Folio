import Foundation
import ZIPFoundation

// 使用真实 Rust 引擎验证全量解压、分批导入与逐批回滚。
enum SwiftImportSmoke {
    static func run(samples: URL) throws {
        func selected(_ name: String, display: String? = nil) -> SelectedImportFile {
            SelectedImportFile(uri: samples.appendingPathComponent(name).absoluteString, name: display ?? name)
        }
        try scenario { root, engine in
            let files = [selected("Lato-Regular.ttf", display: "同名.ttf"), selected("Lato-Bold.ttf", display: "同名.ttf"),
                selected("not-a-font.ttf"), selected("Lato-Regular.ttf", display: "改名.otf"),
                SelectedImportFile(uri: root.appendingPathComponent("missing.ttf").absoluteString, name: "不可读.ttf")]
            let report = try FolioFontImporter(engine: engine, root: root).importFiles(files)
            precondition(report.items.map(\.status) == ["imported", "imported", "failed", "duplicate", "failed"])
            precondition(report.snapshot.faceCount == 2)
            let page = try engine.queryLibrary(query: query())
            try engine.setFavorite(identityIds: [page.families[0].faces[0].identityId], favorite: true)
            let reopened = try FolioEngine.open(databasePath: root.appendingPathComponent("folio.sqlite").path)
            let repeated = try FolioFontImporter(engine: reopened, root: root).importFiles([files[0]])
            precondition(repeated.items[0].status == "duplicate")
            try require(!(try reopened.queryLibrary(query: query(scope: .favorites))).families.isEmpty)
            try require(try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("fonts").path).count == 2)
            try assertClean(root)
        }
        try scenario { root, engine in
            let collection = try Data(contentsOf: samples.appendingPathComponent("Lato-Collection.ttc"))
            let variable = try Data(contentsOf: samples.appendingPathComponent("Inter-Variable.ttf"))
            let zip = try archive(root, "中文.zip", entries: [
                ("子目录/集合.TTC", collection), ("变量.ttf", variable), ("说明.txt", Data([1])), ("nested.zip", Data([1]))])
            let report = try FolioFontImporter(engine: engine, root: root).importFiles([zip])
            precondition(report.items.count == 2 && report.items.allSatisfy { $0.status == "imported" && $0.archiveName == "中文.zip" })
            let faces = try engine.queryLibrary(query: query()).families.flatMap(\.faces)
            precondition(faces.contains { $0.faceIndex == 1 } && faces.contains { !$0.axes.isEmpty })
            let stored = try archive(root, "stored.zip", entries: [("a.ttf", variable), ("b.ttf", variable)], compression: .none)
            let duplicates = try FolioFontImporter(engine: engine, root: root).importFiles([stored])
            precondition(duplicates.items.map(\.status) == ["duplicate", "duplicate"])
            try assertClean(root)
        }
        try scenario { root, engine in
            let data = try Data(contentsOf: samples.appendingPathComponent("Lato-Regular.ttf"))
            let unsafe = try archive(root, "unsafe.zip", entries: [("../outside.ttf", data)])
            let empty = try archive(root, "empty.zip", entries: [("README.txt", Data([1]))])
            let noEntries = try archive(root, "no-entries.zip", entries: [])
            let invalid = selected("not-a-font.ttf", display: "invalid.zip")
            let report = try FolioFontImporter(engine: engine, root: root).importFiles([unsafe, empty, noEntries, invalid, selected("Lato-Regular.ttf")])
            precondition(report.items.map(\.status) == ["failed", "failed", "failed", "failed", "imported"])
            for path in ["../x.ttf", "C:\\x.ttf", "/x.ttf", "a\\..\\x.ttf"] { precondition(!FolioFontImporter.safeArchivePath(path)) }
            precondition(FolioFontImporter.safeArchivePath("字体/a.ttf"))
            try assertClean(root)
        }
        try scenario { root, engine in
            let data = try Data(contentsOf: samples.appendingPathComponent("Lato-Regular.ttf"))
            let crc = try archive(root, "crc.zip", entries: [("a.ttf", data)], compression: .none)
            let encrypted = try archive(root, "encrypted.zip", entries: [("a.ttf", data)], compression: .none)
            for (file, encryption) in [(crc, false), (encrypted, true)] {
                let url = URL(string: file.uri)!
                var bytes = try Data(contentsOf: url)
                let central = (0..<bytes.count - 3).first { Array(bytes[$0..<$0 + 4]) == [0x50, 0x4b, 1, 2] }!
                if encryption { bytes[6] |= 1; bytes[central + 8] |= 1 }
                else { bytes[central + 16] ^= 1 }
                try bytes.write(to: url)
            }
            let report = try FolioFontImporter(engine: engine, root: root).importFiles([crc, encrypted])
            precondition(report.items.allSatisfy { $0.status == "failed" })
            precondition(report.snapshot.faceCount == 0)
            try assertClean(root)
        }
        try scenario { root, engine in
            let regular = try Data(contentsOf: samples.appendingPathComponent("Lato-Regular.ttf"))
            let bold = try Data(contentsOf: samples.appendingPathComponent("Lato-Bold.ttf"))
            let zip = try archive(root, "damaged.zip", entries: [("damaged.ttf", regular), ("valid.ttf", bold)])
            let url = URL(string: zip.uri)!
            var data = try Data(contentsOf: url)
            let nameLength = Int(data[26]) | Int(data[27]) << 8
            let extraLength = Int(data[28]) | Int(data[29]) << 8
            data[30 + nameLength + extraLength] = 6
            try data.write(to: url)
            let report = try FolioFontImporter(engine: engine, root: root).importFiles([zip])
            precondition(report.items.map(\.status) == ["failed", "imported"])
            precondition(report.snapshot.faceCount == 1)
            try assertClean(root)
        }
        try scenario { root, engine in
            let regular = try Data(contentsOf: samples.appendingPathComponent("Lato-Regular.ttf"))
            let bold = try Data(contentsOf: samples.appendingPathComponent("Lato-Bold.ttf"))
            let serif = try Data(contentsOf: samples.appendingPathComponent("SourceSerif4-Regular.otf"))
            let zip = try archive(root, "batches.zip", entries: [("a.ttf", regular), ("b.ttf", bold),
                ("again.ttf", regular), ("c.otf", serif), ("last.ttf", bold)])
            var refreshes = 0
            let importer = FolioFontImporter(engine: engine, root: root, limits: FontImportLimits(batchFonts: 2), refresh: {
                refreshes += 1
                let imports = root.appendingPathComponent("imports")
                let children = try FileManager.default.contentsOfDirectory(at: imports, includingPropertiesForKeys: nil)
                let staged = try children.flatMap { try FileManager.default.contentsOfDirectory(atPath: $0.path) }
                precondition(staged.count == (refreshes == 1 ? 3 : 1))
                return try engine.refreshLibrary().snapshot
            })
            let report = try importer.importFiles([zip])
            precondition(report.items.map(\.status) == ["imported", "imported", "duplicate", "imported", "duplicate"])
            precondition(report.items.map(\.name) == ["a.ttf", "b.ttf", "again.ttf", "c.otf", "last.ttf"])
            precondition(report.items.allSatisfy { $0.archiveName == "batches.zip" })
            precondition(refreshes == 2 && report.snapshot.faceCount == 3)
            try assertClean(root)
        }
        try scenario { root, engine in
            _ = try FolioFontImporter(engine: engine, root: root).importFiles([selected("Lato-Regular.ttf")])
            let identity = try engine.queryLibrary(query: query()).families[0].faces[0].identityId
            try engine.setFavorite(identityIds: [identity], favorite: true)
            var refreshes = 0
            let importer = FolioFontImporter(engine: engine, root: root, limits: FontImportLimits(batchFonts: 2), refresh: {
                refreshes += 1
                if refreshes == 2 { throw FontImportFailure(detail: "测试刷新失败") }
                return try engine.refreshLibrary().snapshot
            })
            let report = try importer.importFiles([selected("Lato-Bold.ttf"), selected("Lato-Regular.ttf"),
                selected("SourceSerif4-Regular.otf"), selected("SourceSerif4-Regular.otf", display: "copy.otf"), selected("Inter-Variable.ttf")])
            precondition(report.items.map(\.status) == ["imported", "duplicate", "failed", "failed", "unprocessed"])
            precondition(report.items[2].messageKey == "mobile.importErrors.batchRolledBack")
            precondition(report.snapshot.faceCount == 2)
            try require(try engine.loadCachedLibrary().roots.count == 2)
            try require(try engine.refreshLibrary().snapshot.faceCount == 2)
            try require(!engine.queryLibrary(query: query(scope: .favorites)).families.isEmpty)
            try require(try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("fonts").path).count == 2)
            try assertClean(root)
        }
        try scenario { root, engine in
            let font = root.appendingPathComponent("large.ttf")
            try FileManager.default.copyItem(at: samples.appendingPathComponent("Lato-Regular.ttf"), to: font)
            let output = try FileHandle(forWritingTo: font)
            try output.truncate(atOffset: 65 * 1024 * 1024)
            try output.close()
            let zipURL = root.appendingPathComponent("large.zip")
            do {
                let zip = try Archive(url: zipURL, accessMode: .create)
                let input = try FileHandle(forReadingFrom: font)
                defer { try? input.close() }
                for index in 0..<4 {
                    try zip.addEntry(with: "\(index).ttf", type: .file, uncompressedSize: Int64(65 * 1024 * 1024),
                                     compressionMethod: .none, bufferSize: 64 * 1024) { position, size in
                        try input.seek(toOffset: UInt64(position))
                        return try input.read(upToCount: size) ?? Data()
                    }
                }
            }
            let size = try FileManager.default.attributesOfItem(atPath: zipURL.path)[.size] as! NSNumber
            precondition(size.uint64Value > 256 * 1024 * 1024)
            let files = [SelectedImportFile(uri: zipURL.absoluteString, name: "large.zip")]
                + Array(repeating: SelectedImportFile(uri: font.absoluteString, name: "large.ttf"), count: 5)
            let report = try FolioFontImporter(engine: engine, root: root, limits: FontImportLimits(batchFonts: 3)).importFiles(files)
            precondition(report.items.map(\.status) == ["imported"] + Array(repeating: "duplicate", count: 8))
            precondition(report.snapshot.faceCount == 1)
            try assertClean(root)
        }
        try scenario { root, engine in
            let regular = try Data(contentsOf: samples.appendingPathComponent("Lato-Regular.ttf"))
            let bold = try Data(contentsOf: samples.appendingPathComponent("Lato-Bold.ttf"))
            let notes = (0..<10_001).map { ("notes/\($0).txt", Data([1])) }
            let fonts = (0..<1_001).map { ("\($0).ttf", $0 == 0 ? regular : $0 == 1_000 ? bold : Data([1])) }
            let zip = try storedArchive(root, "many.zip", entries: notes + fonts)
            let report = try FolioFontImporter(engine: engine, root: root).importFiles([zip])
            precondition(report.items.count == 1_001 && report.items.first?.status == "imported" && report.items.last?.status == "imported")
            precondition(report.items.filter { $0.status == "failed" }.count == 999)
            precondition(report.snapshot.faceCount == 2)
            try assertClean(root)
        }
        try scenario { root, engine in
            let regular = try Data(contentsOf: samples.appendingPathComponent("Lato-Regular.ttf"))
            let zip = try storedArchive(root, "zip64.zip", entries: [("a.ttf", regular)])
            let url = URL(string: zip.uri)!
            var data = try Data(contentsOf: url)
            let end = data.count - 22
            func value(_ offset: Int, _ count: Int) -> UInt64 {
                (0..<count).reduce(UInt64(0)) { $0 | UInt64(data[offset + $1]) << ($1 * 8) }
            }
            let record = fields([(0x06064b50, 4), (44, 8), (45, 2), (45, 2), (0, 4), (0, 4),
                (1, 8), (1, 8), (value(end + 12, 4), 8), (value(end + 16, 4), 8),
                (0x07064b50, 4), (0, 4), (UInt64(end), 8), (1, 4)])
            for offset in 8..<20 { data[end + offset] = 0xff }
            try (data.prefix(end) + record + data.suffix(22)).write(to: url)
            let report = try FolioFontImporter(engine: engine, root: root).importFiles([zip])
            precondition(report.items.map(\.status) == ["imported"])
            let split = try storedArchive(root, "split.zip", entries: [("a.ttf", regular)])
            let splitURL = URL(string: split.uri)!
            var splitData = try Data(contentsOf: splitURL)
            splitData[splitData.count - 22 + 4] = 1
            try splitData.write(to: splitURL)
            let rejected = try FolioFontImporter(engine: engine, root: root).importFiles([split])
            precondition(rejected.items[0].messageKey == "mobile.importErrors.splitArchive")
            let link = try storedArchive(root, "link.zip", entries: [("link.ttf", regular)])
            let linkURL = URL(string: link.uri)!
            var linkData = try Data(contentsOf: linkURL)
            let central = (0..<linkData.count - 3).first { Array(linkData[$0..<$0 + 4]) == [0x50, 0x4b, 1, 2] }!
            linkData[central + 5] = 3
            linkData[central + 41] = 0xa0
            try linkData.write(to: linkURL)
            let links = try FolioFontImporter(engine: engine, root: root).importFiles([link])
            precondition(links.items[0].messageKey == "mobile.importErrors.link")
            try assertClean(root)
        }
        try scenario { root, engine in
            _ = try FolioFontImporter(engine: engine, root: root).importFiles([selected("Lato-Regular.ttf")])
            let page = try engine.queryLibrary(query: query())
            try engine.setFavorite(identityIds: [page.families[0].faces[0].identityId], favorite: true)
            let importer = FolioFontImporter(engine: engine, root: root, refresh: { throw FontImportFailure(detail: "刷新失败") })
            let report = try importer.importFiles([selected("Lato-Bold.ttf")])
            precondition(report.items[0].status == "failed")
            try require(try engine.loadCachedLibrary().roots.count == 1)
            try require(try engine.refreshLibrary().snapshot.faceCount == 1)
            try require(try engine.queryLibrary(query: query()).families[0].isFavorite)
            try require(try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("fonts").path).count == 1)
            try assertClean(root)
        }
        print("PASS：Swift 原生批量、ZIP、内容去重、逐项失败、全量解压、自动分批、无固定大小上限、ZIP64、批次回滚、TTC 与可变字体")
    }

    // 直接生成 Stored ZIP，避免大量条目反复重写整个中央目录。
    private static func fields(_ values: [(UInt64, Int)]) -> Data {
        Data(values.flatMap { value, count in (0..<count).map { UInt8(truncatingIfNeeded: value >> ($0 * 8)) } })
    }

    private static func storedArchive(_ root: URL, _ name: String, entries: [(String, Data)]) throws -> SelectedImportFile {
        let url = root.appendingPathComponent(name)
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let output = try FileHandle(forWritingTo: url)
        defer { try? output.close() }
        var central = Data()
        var offset: UInt64 = 0
        for (path, data) in entries {
            let nameData = Data(path.utf8)
            let length = UInt64(data.count)
            let nameLength = UInt64(nameData.count)
            let crc = UInt64(data.crc32(checksum: 0))
            let header = fields([(0x04034b50, 4), (20, 2), (0x800, 2), (0, 2), (0, 2), (0, 2),
                (crc, 4), (length, 4), (length, 4), (nameLength, 2), (0, 2)])
            try output.write(contentsOf: header + nameData + data)
            central += fields([(0x02014b50, 4), (20, 2), (20, 2), (0x800, 2), (0, 2), (0, 2), (0, 2),
                (crc, 4), (length, 4), (length, 4), (nameLength, 2), (0, 2), (0, 2), (0, 2), (0, 2), (0, 4), (offset, 4)]) + nameData
            offset += UInt64(header.count + nameData.count + data.count)
        }
        try output.write(contentsOf: central)
        try output.write(contentsOf: fields([(0x06054b50, 4), (0, 2), (0, 2), (UInt64(entries.count), 2),
            (UInt64(entries.count), 2), (UInt64(central.count), 4), (offset, 4), (0, 2)]))
        try output.close()
        return SelectedImportFile(uri: url.absoluteString, name: name)
    }

    private static func require(_ condition: @autoclosure () throws -> Bool) throws {
        let valid = try condition()
        precondition(valid)
    }

    private static func scenario(_ run: (URL, FolioEngine) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let engine = try FolioEngine.open(databasePath: root.appendingPathComponent("folio.sqlite").path)
        try run(root, engine)
    }

    private static func query(scope: QueryScopeDto = .all) -> LibraryQueryDto {
        LibraryQueryDto(text: nil, scope: scope, collectionId: nil, facets: [], allowedFaceIds: nil,
            allowedSourcePaths: nil, locationFilter: nil, fileFingerprint: nil, offset: 0, limit: 100)
    }

    private static func archive(_ root: URL, _ name: String, entries: [(String, Data)],
                                compression: CompressionMethod = .deflate) throws -> SelectedImportFile {
        let url = root.appendingPathComponent(name)
        let archive = try Archive(url: url, accessMode: .create)
        for (path, bytes) in entries {
            try archive.addEntry(with: path, type: .file, uncompressedSize: Int64(bytes.count), compressionMethod: compression) { position, size in
                bytes.subdata(in: Int(position)..<Int(position) + size)
            }
        }
        return SelectedImportFile(uri: url.absoluteString, name: name)
    }

    private static func assertClean(_ root: URL) throws {
        try require(try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("imports").path).isEmpty)
    }
}
