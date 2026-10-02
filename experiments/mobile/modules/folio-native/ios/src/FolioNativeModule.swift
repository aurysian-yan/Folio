import ExpoModulesCore
import Foundation
import UIKit

struct FolioSyncProfile: Record {
    @Field var serverUrl: String = ""
    @Field var remoteDirectory: String = ""
    @Field var username: String = ""
    @Field var automatic: Bool = false
    var dto: SyncProfileDto { SyncProfileDto(serverUrl: serverUrl, remoteDirectory: remoteDirectory, username: username, automatic: automatic) }
}

struct FolioQuery: Record {
    @Field var text: String = ""
    @Field var scope: String = "all"
    @Field var collectionId: String? = nil
    @Field var smartFolderId: String? = nil
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

struct FolioSmartConditions: Record {
    @Field var text: String = ""
    @Field var facets: [FolioFacetSelection] = []
}

struct FolioSmartInput: Record {
    @Field var name: String = ""
    @Field var icon: String = "folder"
    @Field var color: String = "gray"
    @Field var query: FolioSmartConditions = FolioSmartConditions()
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
    private var sync: FolioSync?
    private let lifecycleLock = NSLock()
    private var foreground = true

    public func definition() -> ModuleDefinition {
        Name("FolioNative")

        AsyncFunction("initialize") { () throws -> [String: Any] in
            if self.engine == nil {
                let root = try FolioPaths.root()
                try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
                self.engine = try FolioEngine.open(databasePath: root.appendingPathComponent("folio.sqlite").path)
            }
            let engine = try self.requireEngine()
            try self.syncEngine().prepareManagedSources()
            return self.snapshot(try engine.refreshLibrary().snapshot)
        }.runOnQueue(queue)

        AsyncFunction("snapshot") { () throws -> [String: Any] in
            self.snapshot(try self.syncEngine().status().isRunning ? self.requireEngine().loadCachedLibrary() : self.requireEngine().refreshLibrary().snapshot)
        }.runOnQueue(queue)

        AsyncFunction("query") { (request: FolioQuery) throws -> [String: Any] in
            let page = try FolioLibraryMapper.read(engine: self.requireEngine(), text: request.text, scope: request.scope,
                collectionId: request.collectionId, smartFolderId: request.smartFolderId,
                facets: request.facets.map { ($0.kind, $0.value) }, offset: request.offset, limit: request.limit)
            return FolioLibraryMapper.page(page)
        }.runOnQueue(queue)

        AsyncFunction("importFonts") { (files: [FolioImportFile]) throws -> [String: Any] in
            guard try !self.syncEngine().status().isRunning else { throw self.syncBusy() }
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

        AsyncFunction("getSmartFolder") { (id: String) throws -> [String: Any] in
            FolioLibraryMapper.smartFolder(try self.requireEngine().getSmartFolder(id: SmartFolderIdDto(value: id)))
        }.runOnQueue(queue)

        AsyncFunction("saveSmartFolder") { (id: String?, input: FolioSmartInput) throws -> [String: Any] in
            let engine = try self.requireEngine()
            let query = try FolioLibraryMapper.conditions(text: input.query.text, facets: input.query.facets.map { ($0.kind, $0.value) })
            let savedId: SmartFolderIdDto
            if let id {
                savedId = SmartFolderIdDto(value: id)
                try engine.updateSmartFolderWithStyle(id: savedId, name: input.name, query: query, icon: input.icon, color: input.color)
            } else {
                savedId = try engine.createSmartFolderWithStyle(name: input.name, query: query, icon: input.icon, color: input.color)
            }
            return ["snapshot": self.snapshot(try engine.loadCachedLibrary()), "target": ["scope": "smart", "smartFolderId": savedId.value]]
        }.runOnQueue(queue)

        AsyncFunction("deleteSmartFolder") { (id: String) throws -> [String: Any] in
            let engine = try self.requireEngine()
            try engine.deleteSmartFolder(id: SmartFolderIdDto(value: id))
            return self.snapshot(try engine.loadCachedLibrary())
        }.runOnQueue(queue)

        AsyncFunction("convertCollectionToSmart") { (id: String, input: FolioSmartInput) throws -> [String: Any] in
            let engine = try self.requireEngine()
            let query = try FolioLibraryMapper.conditions(text: input.query.text, facets: input.query.facets.map { ($0.kind, $0.value) })
            let savedId = try engine.convertCollectionToSmartFolder(id: CollectionIdDto(value: id), name: input.name,
                query: query, icon: input.icon, color: input.color)
            return ["snapshot": self.snapshot(try engine.loadCachedLibrary()), "target": ["scope": "smart", "smartFolderId": savedId.value]]
        }.runOnQueue(queue)

        AsyncFunction("convertSmartToCollection") { (id: String, input: FolioCollectionInput) throws -> [String: Any] in
            let engine = try self.requireEngine()
            let saved = try engine.convertSmartFolderToCollection(id: SmartFolderIdDto(value: id), name: input.name, icon: input.icon, color: input.color)
            return ["snapshot": self.snapshot(try engine.loadCachedLibrary()), "target": ["scope": "collection", "collectionId": saved.id.value]]
        }.runOnQueue(queue)

        AsyncFunction("recordRecent") { (id: String) throws -> [String: Any] in
            let engine = try self.requireEngine()
            try engine.recordRecent(identityId: IdentityIdDto(value: id))
            return self.snapshot(try engine.loadCachedLibrary())
        }.runOnQueue(queue)

        AsyncFunction("syncState") { () throws -> [String: Any] in
            try self.syncState()
        }.runOnQueue(queue)

        AsyncFunction("testSyncConnection") { (profile: FolioSyncProfile, password: String?) throws in
            guard try !self.syncEngine().status().isRunning else { throw self.syncBusy() }
            let dto = profile.dto
            try self.syncOperation { try self.syncEngine().testConnection(profile: dto, password: self.password(password, profile: dto)) }
        }.runOnQueue(queue)

        AsyncFunction("saveSyncConnection") { (profile: FolioSyncProfile, password: String?) throws in
            let sync = try self.syncEngine()
            guard try !sync.status().isRunning else { throw self.syncBusy() }
            let dto = profile.dto
            let secret = try self.password(password, profile: dto)
            try self.syncOperation { try sync.testConnection(profile: dto, password: secret) }
            let previous = try? FolioSyncCredentials.read(dto)
            try FolioSyncCredentials.write(secret, profile: dto)
            do { try self.syncOperation { try sync.saveProfile(profile: dto) } }
            catch {
                try FolioSyncCredentials.write(previous, profile: dto)
                throw error
            }
        }.runOnQueue(queue)

        AsyncFunction("disconnectSync") { () throws in
            let sync = try self.syncEngine()
            guard try !sync.status().isRunning else { throw self.syncBusy() }
            if let profile = try sync.profile() {
                let previous = try? FolioSyncCredentials.read(profile)
                try FolioSyncCredentials.write(nil, profile: profile)
                do { try self.syncOperation { try sync.disconnect() } }
                catch { try FolioSyncCredentials.write(previous, profile: profile); throw error }
            }
        }.runOnQueue(queue)

        AsyncFunction("startSync") { () throws -> Bool in
            self.lifecycleLock.lock()
            defer { self.lifecycleLock.unlock() }
            guard self.foreground else { throw self.syncBusy() }
            let sync = try self.syncEngine()
            guard let profile = try sync.profile() else { throw self.syncBusy() }
            if try sync.status().isRunning { return false }
            let password = try self.password(nil, profile: profile)
            try self.syncOperation { try sync.prepareManagedSources() }
            return try self.syncOperation { try sync.startSync(password: password) }
        }.runOnQueue(queue)

        AsyncFunction("cancelSync") { () throws in
            try self.syncEngine().cancel()
        }.runOnQueue(queue)

        AsyncFunction("cloudFontAction") { (fingerprint: String, action: String) throws in
            let sync = try self.syncEngine()
            try self.syncOperation {
                switch action {
                case "cloudOnly": try sync.setCloudOnly(fingerprint: fingerprint)
                case "download": try sync.restoreCloudFont(fingerprint: fingerprint)
                case "delete": try sync.deleteEverywhere(fingerprint: fingerprint)
                case "restore": try sync.restoreDeletedFont(fingerprint: fingerprint)
                default: throw self.syncBusy()
                }
            }
        }.runOnQueue(queue)

        AsyncFunction("resolveSyncConflict") { (id: String, resolution: String) throws in
            let value: SyncResolutionDto
            switch resolution {
            case "keepBoth": value = .keepBoth
            case "useLocal": value = .useLocal
            case "useRemote": value = .useRemote
            default: throw self.syncBusy()
            }
            try self.syncOperation { try self.syncEngine().resolveConflict(id: id, resolution: value) }
        }.runOnQueue(queue)

        OnAppBecomesActive {
            self.lifecycleLock.lock(); self.foreground = true; self.lifecycleLock.unlock()
        }
        OnAppEntersBackground {
            self.lifecycleLock.lock(); self.foreground = false; self.lifecycleLock.unlock()
            self.queue.async { self.sync?.cancel() }
        }

        AsyncFunction("storageUsage") { () throws -> [String: Any] in
            let usage = try self.syncEngine().storageUsage()
            return ["databaseBytes": usage.databaseBytes, "managedFontBytes": usage.managedFontBytes,
                    "volumeTotalBytes": usage.volumeTotalBytes, "volumeFreeBytes": usage.volumeFreeBytes,
                    "catalogCacheEntries": usage.catalogCacheEntries,
                    "catalogCacheEstimatedBytes": usage.catalogCacheEstimatedBytes]
        }.runOnQueue(queue)

        AsyncFunction("clearCatalogCache") { () throws -> UInt64 in
            try self.syncEngine().clearCatalogCache()
        }.runOnQueue(queue)

        AsyncFunction("rebuildSyncIndexes") { () throws in
            try self.syncEngine().rebuildSyncIndexes()
        }.runOnQueue(queue)

        AsyncFunction("previewCacheBytes") { () throws -> UInt64 in
            try FolioOnline.open(cacheDirectory: self.previewCacheDirectory().path).previewCacheBytes()
        }.runOnQueue(queue)

        AsyncFunction("clearPreviewCache") { () throws -> UInt64 in
            try self.syncEngine().clearPreviewCache(cacheDirectory: self.previewCacheDirectory().path)
        }.runOnQueue(queue)

        AsyncFunction("copyText") { (text: String) in
            UIPasteboard.general.string = text
        }.runOnQueue(.main)

        OnDestroy {
            self.queue.async { self.sync?.cancel(); self.sync = nil; self.engine = nil }
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

    // 存储维护与同步共用同一实例及运行状态。
    private func syncEngine() throws -> FolioSync {
        if let sync { return sync }
        let root = try FolioPaths.root()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let opened = try FolioSync.open(databasePath: root.appendingPathComponent("folio.sqlite").path,
                                  managedDirectory: root.appendingPathComponent("fonts", isDirectory: true).path)
        self.sync = opened
        return opened
    }

    private func syncOperation<T>(_ action: () throws -> T) throws -> T {
        do { return try action() }
        catch FolioFfiError.Operation(let message) {
            throw Exception(name: "FolioSync", description: message, code: "ERR_FOLIO_SYNC")
        }
    }

    private func syncBusy() -> NSError {
        NSError(domain: "FolioSync", code: 1, userInfo: [NSLocalizedDescriptionKey: "ERR_FOLIO_BUSY"])
    }

    private func password(_ supplied: String?, profile: SyncProfileDto) throws -> String {
        if let supplied, !supplied.isEmpty { return supplied }
        guard let stored = try FolioSyncCredentials.read(profile), !stored.isEmpty else {
            throw NSError(domain: "FolioCredentials", code: 2, userInfo: [NSLocalizedDescriptionKey: "ERR_FOLIO_CREDENTIALS"])
        }
        return stored
    }

    private func syncState() throws -> [String: Any] {
        let sync = try syncEngine()
        let status = try sync.status()
        let profile = try sync.profile()
        var credentialError = false
        var credentialAvailable = false
        if let profile {
            do { credentialAvailable = try FolioSyncCredentials.read(profile) != nil }
            catch { credentialError = true }
        }
        return ["profile": profile.map { ["serverUrl": $0.serverUrl, "remoteDirectory": $0.remoteDirectory,
            "username": $0.username, "automatic": $0.automatic] as [String: Any] } as Any? ?? NSNull(),
            "credentialAvailable": credentialAvailable, "credentialError": credentialError,
            "status": ["phase": status.phase, "stage": status.stage, "percent": status.percent,
                "stageCompleted": status.stageCompleted, "stageTotal": status.stageTotal,
                "isRunning": status.isRunning, "uploadedFiles": status.uploadedFiles, "downloadedFiles": status.downloadedFiles,
                "uploadedBytes": status.uploadedBytes, "downloadedBytes": status.downloadedBytes,
                "completionGeneration": status.completionGeneration, "lastSyncedAtMs": status.lastSyncedAtMs as Any? ?? NSNull(),
                "errorMessage": status.errorMessage as Any? ?? NSNull(),
                "items": status.items.map { ["fingerprint": $0.fingerprint, "action": $0.action, "status": $0.status] }],
            "conflicts": try sync.conflicts().map { ["id": $0.id, "kind": $0.kind, "title": $0.title, "detail": $0.detail, "localFingerprint": $0.localFingerprint as Any? ?? NSNull(), "remoteFingerprint": $0.remoteFingerprint as Any? ?? NSNull()] as [String: Any] },
            "fonts": try sync.cloudFonts().map { ["fingerprint": $0.fingerprint, "displayName": $0.displayName,
                "filename": $0.filename, "fileSize": $0.fileSize, "cloudOnly": $0.cloudOnly, "deleted": $0.deleted,
                "localPath": $0.localPath as Any? ?? NSNull(), "identityIds": $0.identityIds,
                "localAvailable": !$0.cloudOnly && !$0.deleted && ($0.localPath.map { FileManager.default.isReadableFile(atPath: $0) } ?? false)] as [String: Any] }]
    }

    private func previewCacheDirectory() -> URL {
        (try? FolioPaths.root().appendingPathComponent("previews", isDirectory: true))
            ?? URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("folio-previews", isDirectory: true)
    }

    private func snapshot(_ value: LibrarySnapshotDto) -> [String: Any] {
        FolioLibraryMapper.snapshot(value)
    }
}
