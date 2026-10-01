import CoreText
import Foundation

@main
struct SwiftSmoke {
    static func main() throws {
        let manager = FileManager.default
        let samples = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let temporary = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try manager.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: temporary) }
        let database = temporary.appendingPathComponent("folio.sqlite").path
        let engine = try FolioEngine.open(databasePath: database)
        let empty = try engine.loadCachedLibrary()
        precondition(empty.familyCount == 0)
        for name in ["Lato-Regular.ttf", "Lato-Bold.ttf", "SourceSerif4-Regular.otf", "Inter-Variable.ttf", "Lato-Collection.ttc"] {
            let source = samples.appendingPathComponent(name)
            let destination = temporary.appendingPathComponent(name)
            try manager.copyItem(at: source, to: destination)
            try engine.validateFontFile(path: destination.path)
            _ = try engine.addFontFile(path: destination.path)
        }
        let refreshed = try engine.refreshLibrary().snapshot
        precondition(refreshed.familyCount >= 3)
        let first = try engine.queryLibrary(query: query(offset: 0, limit: 1))
        let second = try engine.queryLibrary(query: query(offset: 1, limit: 1))
        precondition(first.families.count == 1 && second.families.count == 1)
        precondition(first.families[0].id != second.families[0].id)
        let all = try engine.queryLibrary(query: query(offset: 0, limit: 100))
        let faces = all.families.flatMap(\.faces)
        precondition(faces.contains { $0.faceIndex == 1 && $0.sourcePath?.hasSuffix(".ttc") == true })
        precondition(faces.contains { !$0.axes.isEmpty })
        let family = all.families[0]
        try engine.setFavorite(identityIds: family.identityIds, favorite: true)
        let reopened = try FolioEngine.open(databasePath: database)
        let favorites = try reopened.queryLibrary(query: query(offset: 0, limit: 100, scope: .favorites))
        precondition(favorites.families.contains { $0.id == family.id })
        var rejected = false
        do { try engine.validateFontFile(path: samples.appendingPathComponent("not-a-font.ttf").path) }
        catch { rejected = true }
        precondition(rejected)

        let collection = samples.appendingPathComponent("Lato-Collection.ttc")
        let descriptors = CTFontManagerCreateFontDescriptorsFromURL(collection as CFURL) as! [CTFontDescriptor]
        precondition(descriptors.count == 2)
        let bold = CTFontCreateWithFontDescriptor(descriptors[1], 32, nil)
        precondition((CTFontCopyPostScriptName(bold) as String).contains("Bold"))
        print("PASS：Swift ↔ Rust 真实导入、分页、TTC 成员、变量轴、收藏持久化和损坏文件错误；主机 CoreText 非零 TTC 成员")
        try SwiftImportSmoke.run(samples: samples)
        try SwiftLibrarySmoke.run(samples: samples)
    }

    static func query(offset: UInt64, limit: UInt64, scope: QueryScopeDto = .all) -> LibraryQueryDto {
        LibraryQueryDto(text: nil, scope: scope, collectionId: nil, facets: [], allowedFaceIds: nil,
                        allowedSourcePaths: nil, offset: offset, limit: limit)
    }
}
