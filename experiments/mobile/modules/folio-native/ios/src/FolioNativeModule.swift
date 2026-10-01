import ExpoModulesCore
import Foundation
import UIKit

struct FolioQuery: Record {
    @Field var text: String = ""
    @Field var scope: String = "all"
    @Field var offset: Int = 0
    @Field var limit: Int = 40
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

        AsyncFunction("query") { (request: FolioQuery) throws -> [String: Any] in
            guard request.offset >= 0, (1...100).contains(request.limit) else {
                throw Exception(name: "FolioQuery", description: "查询范围无效。", code: "ERR_FOLIO_QUERY")
            }
            let scope: QueryScopeDto
            switch request.scope {
            case "all": scope = .all
            case "favorites": scope = .favorites
            case "recent": scope = .recent
            default: throw Exception(name: "FolioQuery", description: "查询范围无效。", code: "ERR_FOLIO_QUERY")
            }
            let page = try self.requireEngine().queryLibrary(query: LibraryQueryDto(
                text: request.text.isEmpty ? nil : request.text, scope: scope, collectionId: nil,
                facets: [], allowedFaceIds: nil, allowedSourcePaths: nil,
                offset: UInt64(request.offset), limit: UInt64(request.limit)))
            return ["totalMatches": page.totalMatches, "families": page.families.map { family in
                ["id": family.id.value, "displayName": family.displayName,
                 "isFavorite": family.isFavorite, "faces": family.faces.map { face in
                    ["id": face.id.value, "identityId": face.identityId.value,
                     "revisionId": face.revisionId, "styleName": face.styleName,
                     "sourcePath": face.sourcePath as Any? ?? NSNull(), "faceIndex": face.faceIndex,
                     "axes": face.axes.map { axis in
                        ["tag": axis.tag, "name": axis.name, "minimum": axis.minValue,
                         "defaultValue": axis.defaultValue, "maximum": axis.maxValue] as [String: Any]
                     }] as [String: Any]
                 }] as [String: Any]
            }]
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

        AsyncFunction("setFavorite") { (identityIds: [String], favorite: Bool) throws in
            try self.requireEngine().setFavorite(identityIds: identityIds.map { IdentityIdDto(value: $0) },
                                                favorite: favorite)
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
        ["familyCount": value.familyCount, "faceCount": value.faceCount,
         "variableFamilyCount": value.variableFamilyCount, "recentCount": value.recentCount,
         "damagedCount": value.health.damagedFiles]
    }
}
