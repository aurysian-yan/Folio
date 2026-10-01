import Foundation
import ZIPFoundation

// 使用真实 Rust 引擎验证原生批量导入与受限解压。
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
            let font = selected("Lato-Regular.ttf")
            let size = try FolioFontImporter(engine: engine, root: root, limits: FontImportLimits(fontBytes: 10)).importFiles([font])
            precondition(size.items[0].status == "failed")
            let zip = try archive(root, "limits.zip", entries: [("a.ttf", try Data(contentsOf: samples.appendingPathComponent("Lato-Regular.ttf")))])
            for limits in [FontImportLimits(archiveBytes: 10), FontImportLimits(archiveEntries: 0), FontImportLimits(batchBytes: 10)] {
                let report = try FolioFontImporter(engine: engine, root: root, limits: limits).importFiles([zip])
                precondition(report.items.allSatisfy { $0.status == "failed" })
            }
            let count = try FolioFontImporter(engine: engine, root: root, limits: FontImportLimits(fonts: 1))
                .importFiles([font, selected("Lato-Bold.ttf")])
            precondition(count.items.map(\.status) == ["imported", "failed"])
            try assertClean(root)
        }
        try scenario { root, engine in
            _ = try FolioFontImporter(engine: engine, root: root).importFiles([selected("Lato-Regular.ttf")])
            let page = try engine.queryLibrary(query: query())
            try engine.setFavorite(identityIds: [page.families[0].faces[0].identityId], favorite: true)
            let importer = FolioFontImporter(engine: engine, root: root, refresh: { throw FontImportFailure(detail: "刷新失败") })
            do { _ = try importer.importFiles([selected("Lato-Bold.ttf")]); preconditionFailure("必须失败") }
            catch is FontImportFailure { }
            try require(try engine.loadCachedLibrary().roots.count == 1)
            try require(try engine.refreshLibrary().snapshot.faceCount == 1)
            try require(try engine.queryLibrary(query: query()).families[0].isFavorite)
            try require(try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("fonts").path).count == 1)
            try assertClean(root)
        }
        print("PASS：Swift 原生批量、ZIP、内容去重、逐项失败、资源限制、回滚、TTC 与可变字体")
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
            allowedSourcePaths: nil, offset: 0, limit: 100)
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
