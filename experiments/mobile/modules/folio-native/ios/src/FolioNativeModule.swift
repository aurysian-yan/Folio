import ExpoModulesCore
import Foundation

struct FolioQuery: Record {
    @Field var text: String = ""
    @Field var scope: String = "all"
    @Field var offset: Int = 0
    @Field var limit: Int = 40
}

struct FolioPreviewSelection: Record {
    @Field var sourcePath: String = ""
    @Field var faceIndex: Int = 0
    @Field var revisionId: String = ""
    @Field var axes: [String: Double] = [:]
    @Field var text: String = ""
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
            return self.snapshot(try self.requireEngine().loadCachedLibrary())
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

        AsyncFunction("importFont") { (uri: String) throws -> [String: Any] in
            let engine = try self.requireEngine()
            guard let source = URL(string: uri), source.isFileURL else {
                throw Exception(name: "FolioImport", description: "请选择本地字体文件。", code: "ERR_FOLIO_IMPORT")
            }
            let directory = try FolioPaths.root().appendingPathComponent("fonts", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let destination = directory.appendingPathComponent(UUID().uuidString)
                .appendingPathExtension(source.pathExtension)
            let scoped = source.startAccessingSecurityScopedResource()
            defer { if scoped { source.stopAccessingSecurityScopedResource() } }
            try FileManager.default.copyItem(at: source, to: destination)
            var rootID: RootIdDto?
            do {
                try engine.validateFontFile(path: destination.path)
                rootID = try engine.addFontFile(path: destination.path).id
                return self.snapshot(try engine.refreshLibrary().snapshot)
            } catch {
                if let rootID { try? engine.removeLibraryRoot(id: rootID) }
                try? FileManager.default.removeItem(at: destination)
                throw error
            }
        }.runOnQueue(queue)

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
    }

    private func requireEngine() throws -> FolioEngine {
        guard let engine else {
            throw Exception(name: "FolioNotReady", description: "字体库尚未就绪。", code: "ERR_FOLIO_NOT_READY")
        }
        return engine
    }

    private func snapshot(_ value: LibrarySnapshotDto) -> [String: Any] {
        ["familyCount": value.familyCount, "faceCount": value.faceCount]
    }
}
