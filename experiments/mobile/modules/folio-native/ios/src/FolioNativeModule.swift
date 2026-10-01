import ExpoModulesCore
import Foundation
import UIKit

struct FolioQuery: Record {
    @Field var text: String = ""
    @Field var scope: String = "all"
    @Field var collectionId: String? = nil
    @Field var facets: [FolioFacetSelection] = []
    @Field var offset: Int = 0
    @Field var limit: Int = 40
}

struct FolioFacetSelection: Record {
    @Field var kind: String = ""
    @Field var value: String = ""
}

struct FolioCollectionInput: Record {
    @Field var name: String = ""
    @Field var icon: String = "folder"
    @Field var color: String = "gray"
}

struct FolioImportFile: Record {
    @Field var uri: String = ""
    @Field var name: String = ""
}

struct FolioPreviewSelection: Record {
    @Field var sourcePath: String = ""
    @Field var faceIndex: Int = 0
    @Field var revisionId: String = ""
    @Field var axes: [String: Double] = [:]
    @Field var text: String = ""
    @Field var fontSize: Double = 32
    @Field var centered: Bool = false
}

enum FolioPaths {
    static func root() throws -> URL {
        try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                    appropriateFor: nil, create: true)
            .appendingPathComponent("FolioMobilePoC", isDirectory: true)
    }

    static func managedFont(_ path: String) throws -> URL {
        let fonts = try root().appendingPathComponent("fonts", isDirectory: true).resolvingSymlinksInPath()
        let source = URL(fileURLWithPath: path).resolvingSymlinksInPath()
        guard source.path.hasPrefix(fonts.path + "/"), FileManager.default.isReadableFile(atPath: source.path) else {
            throw Exception(name: "FolioSource", description: "字体文件不可用。", code: "ERR_FOLIO_SOURCE")
        }
        return source
    }

    // 应用更新后只重定位实验沙盒内的托管字体。
    static func relocatedFont(_ path: String) throws -> URL? {
        guard let range = path.range(of: "/FolioMobilePoC/fonts/", options: .backwards) else { return nil }
        let name = String(path[range.upperBound...])
        guard !name.isEmpty, !name.contains("/"), name != ".", name != ".." else { return nil }
        let candidate = try root().appendingPathComponent("fonts", isDirectory: true).appendingPathComponent(name)
        guard candidate.path != path, FileManager.default.isReadableFile(atPath: candidate.path) else { return nil }
        return try managedFont(candidate.path)
    }
}

public final class FolioNativeModule: Module {
    private let queue = DispatchQueue(label: "com.folio.mobile.poc.library", qos: .userInitiated)
    private var engine: FolioEngine?

    public func definition() -> ModuleDefinition {
        Name("FolioNative")

        AsyncFunction("initialize") { () throws -> [String: Any] in
            if self.engine == nil {
                let root = try FolioPaths.root()
                try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
                self.engine = try FolioEngine.open(databasePath: root.appendingPathComponent("folio.sqlite").path)
            }
            let engine = try self.requireEngine()
            let cached = try engine.loadCachedLibrary()
            var relocated = false
            for root in cached.roots where root.kind == "file" {
                if let source = try FolioPaths.relocatedFont(root.displayPath) {
                    try engine.validateFontFile(path: source.path)
                    _ = try engine.addFontFile(path: source.path)
                    try engine.removeLibraryRoot(id: root.id)
                    relocated = true
                }
            }
            return self.snapshot(relocated ? try engine.refreshLibrary().snapshot : cached)
        }.runOnQueue(queue)

        AsyncFunction("snapshot") { () throws -> [String: Any] in
            self.snapshot(try self.requireEngine().loadCachedLibrary())
        }.runOnQueue(queue)

        AsyncFunction("query") { (request: FolioQuery) throws -> [String: Any] in
            let query = try FolioLibraryMapper.query(text: request.text, scope: request.scope,
                collectionId: request.collectionId, facets: request.facets.map { ($0.kind, $0.value) },
                offset: request.offset, limit: request.limit)
            return FolioLibraryMapper.page(try self.requireEngine().queryLibrary(query: query))
        }.runOnQueue(queue)

        AsyncFunction("importFonts") { (files: [FolioImportFile]) throws -> [String: Any] in
            do {
                let importer = FolioFontImporter(engine: try self.requireEngine(), root: try FolioPaths.root())
                let report = try importer.importFiles(files.map { SelectedImportFile(uri: $0.uri, name: $0.name) })
                return ["snapshot": self.snapshot(report.snapshot), "items": report.items.map(\.dictionary)]
            } catch let failure as FontImportFailure {
                throw Exception(name: "FolioImport", description: failure.detail, code: "ERR_FOLIO_IMPORT")
            }
        }.runOnQueue(queue)

        AsyncFunction("setFavorite") { (identityIds: [String], favorite: Bool) throws -> [String: Any] in
            let engine = try self.requireEngine()
            try engine.setFavorite(identityIds: identityIds.map { IdentityIdDto(value: $0) }, favorite: favorite)
            return self.snapshot(try engine.loadCachedLibrary())
        }.runOnQueue(queue)

        AsyncFunction("createCollection") { (input: FolioCollectionInput) throws -> [String: Any] in
            let engine = try self.requireEngine()
            _ = try engine.createCollectionWithIcon(name: input.name, icon: input.icon, color: input.color)
            return self.snapshot(try engine.loadCachedLibrary())
        }.runOnQueue(queue)

        AsyncFunction("updateCollection") { (id: String, input: FolioCollectionInput) throws -> [String: Any] in
            let engine = try self.requireEngine()
            try engine.updateCollection(id: CollectionIdDto(value: id), name: input.name, icon: input.icon, color: input.color)
            return self.snapshot(try engine.loadCachedLibrary())
        }.runOnQueue(queue)

        AsyncFunction("deleteCollection") { (id: String) throws -> [String: Any] in
            let engine = try self.requireEngine()
            try engine.deleteCollection(id: CollectionIdDto(value: id))
            return self.snapshot(try engine.loadCachedLibrary())
        }.runOnQueue(queue)

        AsyncFunction("setCollectionMembers") { (id: String, identityIds: [String], member: Bool) throws -> [String: Any] in
            let engine = try self.requireEngine()
            try engine.setCollectionMembers(collectionId: CollectionIdDto(value: id),
                identityIds: identityIds.map { IdentityIdDto(value: $0) }, member: member)
            return self.snapshot(try engine.loadCachedLibrary())
        }.runOnQueue(queue)

        AsyncFunction("copyText") { (text: String) in
            UIPasteboard.general.string = text
        }.runOnQueue(.main)

        OnDestroy {
            self.queue.async { self.engine = nil }
        }

        View(FolioFontPreview.self) {
            Events("onStatus")
            Prop("selection") { (view: FolioFontPreview, selection: FolioPreviewSelection) in
                view.selection = selection
            }
            OnViewDidUpdateProps { (view: FolioFontPreview) in view.renderSelection() }
        }

        View(FolioTabContent.self)

        View(FolioScrollContainer.self) {
            Events("onInsetsChange")
            Prop("hasHeader") { (view: FolioScrollContainer, value: Bool) in
                view.hasHeader = value
            }
        }
    }

    private func requireEngine() throws -> FolioEngine {
        guard let engine else {
            throw Exception(name: "FolioNotReady", description: "字体库尚未就绪。", code: "ERR_FOLIO_NOT_READY")
        }
        return engine
    }

    private func snapshot(_ value: LibrarySnapshotDto) -> [String: Any] {
        FolioLibraryMapper.snapshot(value)
    }
}
