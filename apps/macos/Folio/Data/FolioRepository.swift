import Darwin
import Foundation

actor FolioRepository {
    private let engine: FolioEngine

    init(databaseURL: URL? = nil) throws {
        let manager = FileManager.default
        let path: URL
        if let databaseURL {
            path = databaseURL
        } else {
            let support = try manager.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            ).appendingPathComponent("Folio", isDirectory: true)
            path = support.appendingPathComponent("folio.sqlite")
        }
        try manager.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true)
        engine = try FolioEngine.open(databasePath: path.path)
    }

    func loadCachedLibrary() throws -> LibrarySnapshot {
        map(try engine.loadCachedLibrary())
    }

    func refreshLibrary() throws -> LibrarySnapshot {
        map(try engine.refreshLibrary().snapshot)
    }

    func addLibraryRoot(_ url: URL) throws {
        _ = try engine.addLibraryRoot(path: url.path)
    }

    func addFontFile(_ url: URL) throws -> RootID {
        let root = try engine.addFontFile(path: url.path)
        return RootID(rawValue: root.id.value)
    }

    func validateFontFile(_ url: URL) throws {
        try engine.validateFontFile(path: url.path)
    }

    func removeRoot(_ id: RootID) throws {
        try engine.removeLibraryRoot(id: RootIdDto(value: id.rawValue))
    }

    func libraryFaceSources() throws -> [LibraryFaceSources] {
        try engine.libraryFaceSources().map {
            LibraryFaceSources(
                familyID: FamilyID(rawValue: $0.familyId.value),
                faceID: FaceID(rawValue: $0.faceId.value),
                paths: $0.paths
            )
        }
    }

    func addDefaultLibraryRoots() throws -> Bool {
        let manager = FileManager.default
        let home = getpwuid(getuid()).map { String(cString: $0.pointee.pw_dir) }
            .map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? manager.homeDirectoryForCurrentUser
        let candidates = [
            URL(fileURLWithPath: "/System/Library/Fonts", isDirectory: true),
            URL(fileURLWithPath: "/Library/Fonts", isDirectory: true),
            home.appendingPathComponent("Library/Fonts", isDirectory: true),
        ]
        var added = false
        for url in candidates where manager.fileExists(atPath: url.path) {
            _ = try engine.addLibraryRoot(path: url.path)
            added = true
        }
        return added
    }

    func migrateLegacyUserFontRoot(_ roots: [RootSummary]) throws {
        let manager = FileManager.default
        let sandboxFonts = manager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Fonts", isDirectory: true).standardizedFileURL
        guard roots.contains(where: { $0.kind == "directory" && $0.displayPath == sandboxFonts.path }),
              let accountHome = getpwuid(getuid()).map({ String(cString: $0.pointee.pw_dir) }),
              !accountHome.isEmpty else { return }
        let userFonts = URL(fileURLWithPath: accountHome, isDirectory: true)
            .appendingPathComponent("Library/Fonts", isDirectory: true).standardizedFileURL
        guard userFonts != sandboxFonts, manager.fileExists(atPath: userFonts.path) else { return }
        _ = try engine.addLibraryRoot(path: userFonts.path)
    }

    func query(
        text: String,
        destination: SidebarDestination,
        facets: Set<FacetOption>,
        allowedFaceIDs: Set<FaceID>? = nil,
        allowedSourcePaths: Set<String>? = nil,
        offset: Int,
        limit: Int
    ) throws -> LibraryPage {
        let scope: QueryScopeDto
        let collectionID: CollectionIdDto?
        switch destination {
        case .favorites:
            scope = .favorites
            collectionID = nil
        case .recent:
            scope = .recent
            collectionID = nil
        case let .collection(id):
            scope = .collection
            collectionID = CollectionIdDto(value: id.rawValue)
        case .fontState:
            scope = .all
            collectionID = nil
        default:
            scope = .all
            collectionID = nil
        }
        let selections = facets.map {
            FacetSelectionDto(kind: $0.kind.dto, value: $0.value)
        }
        let page = try engine.queryLibrary(query: LibraryQueryDto(
            text: text.isEmpty ? nil : text,
            scope: scope,
            collectionId: collectionID,
            facets: selections,
            allowedFaceIds: allowedFaceIDs.map { ids in
                ids.map { FaceIdDto(value: $0.rawValue) }
            },
            allowedSourcePaths: allowedSourcePaths.map(Array.init),
            offset: UInt64(max(0, offset)),
            limit: UInt64(max(1, limit))
        ))
        return LibraryPage(
            totalMatches: page.totalMatches,
            families: page.families.map(map),
            facets: page.facets.compactMap(map)
        )
    }

    func familyDetails(_ id: FamilyID) throws -> FamilyCard {
        let details = try engine.familyDetails(familyId: FamilyIdDto(value: id.rawValue))
        return FamilyCard(
            id: FamilyID(rawValue: details.id.value),
            displayName: details.displayName,
            faces: details.faces.map(map),
            identityIDs: details.identityIds.map { IdentityID(rawValue: $0.value) },
            matchedFaceIDs: details.faces.map { FaceID(rawValue: $0.id.value) },
            isFavorite: details.isFavorite,
            isVariable: details.faces.contains(where: \.isVariable),
            manufacturer: details.faces.compactMap(\.manufacturer).first
        )
    }

    func setFavorite(_ family: FamilyCard, favorite: Bool) throws {
        try engine.setFavorite(
            identityIds: family.identityIDs.map { IdentityIdDto(value: $0.rawValue) },
            favorite: favorite
        )
    }

    func recordRecent(_ identityID: IdentityID) throws {
        try engine.recordRecent(identityId: IdentityIdDto(value: identityID.rawValue))
    }

    func createCollection(name: String, icon: CollectionIcon, color: CollectionColor) throws {
        _ = try engine.createCollectionWithIcon(
            name: name,
            icon: icon.rawValue,
            color: color.rawValue
        )
    }

    func updateCollection(
        _ id: CollectionID,
        name: String,
        icon: CollectionIcon,
        color: CollectionColor
    ) throws {
        try engine.updateCollection(
            id: CollectionIdDto(value: id.rawValue),
            name: name,
            icon: icon.rawValue,
            color: color.rawValue
        )
    }

    func deleteCollection(_ id: CollectionID) throws {
        try engine.deleteCollection(id: CollectionIdDto(value: id.rawValue))
    }

    func setCollection(_ id: CollectionID, family: FamilyCard, member: Bool) throws {
        try engine.setCollectionMembers(
            collectionId: CollectionIdDto(value: id.rawValue),
            identityIds: family.identityIDs.map { IdentityIdDto(value: $0.rawValue) },
            member: member
        )
    }

    private func map(_ dto: LibrarySnapshotDto) -> LibrarySnapshot {
        LibrarySnapshot(
            familyCount: dto.familyCount,
            faceCount: dto.faceCount,
            variableFamilyCount: dto.variableFamilyCount,
            recentCount: dto.recentCount,
            collections: dto.collections.map {
                CollectionSummary(
                    id: CollectionID(rawValue: $0.id.value),
                    name: $0.name,
                    icon: CollectionIcon(rawValue: $0.icon) ?? .folder,
                    color: CollectionColor(rawValue: $0.color) ?? .gray,
                    memberCount: $0.memberCount
                )
            },
            roots: dto.roots.map {
                RootSummary(
                    id: RootID(rawValue: $0.id.value),
                    displayPath: $0.displayPath,
                    recursive: $0.recursive,
                    kind: $0.kind,
                    pathIsLossless: $0.pathIsLossless
                )
            },
            health: HealthSummary(
                damagedFiles: dto.health.damagedFiles,
                duplicateSources: dto.health.duplicateSources,
                multipleRevisions: dto.health.multipleRevisions,
                metadataConflicts: dto.health.metadataConflicts
            )
        )
    }

    private func map(_ dto: FamilyCardDto) -> FamilyCard {
        FamilyCard(
            id: FamilyID(rawValue: dto.id.value),
            displayName: dto.displayName,
            faces: dto.faces.map(map),
            identityIDs: dto.identityIds.map { IdentityID(rawValue: $0.value) },
            matchedFaceIDs: dto.matchedFaceIds.map { FaceID(rawValue: $0.value) },
            isFavorite: dto.isFavorite,
            isVariable: dto.isVariable,
            manufacturer: dto.manufacturer
        )
    }

    private func map(_ dto: FaceSummaryDto) -> FaceSummary {
        FaceSummary(
            id: FaceID(rawValue: dto.id.value),
            identityID: IdentityID(rawValue: dto.identityId.value),
            revisionID: dto.revisionId,
            styleName: dto.styleName,
            postScriptName: dto.postscriptName,
            fullName: dto.fullName,
            format: dto.format,
            isVariable: dto.isVariable,
            weight: dto.weight,
            width: dto.width,
            sourcePath: dto.sourcePath,
            sources: dto.sources.map {
                FontSource(
                    path: $0.path,
                    faceIndex: $0.faceIndex,
                    rootIDs: $0.rootIds.map { RootID(rawValue: $0.value) }
                )
            },
            faceIndex: dto.faceIndex,
            fileSize: dto.fileSize,
            version: dto.version,
            manufacturer: dto.manufacturer,
            designer: dto.designer,
            copyright: dto.copyright,
            category: dto.category,
            license: dto.license,
            scripts: dto.scripts,
            axes: dto.axes.map {
                VariableAxisModel(
                    tag: $0.tag,
                    name: $0.name,
                    minimum: $0.minValue,
                    defaultValue: $0.defaultValue,
                    maximum: $0.maxValue,
                    hidden: $0.hidden
                )
            }
        )
    }

    private func map(_ dto: FacetCountDto) -> FacetOption? {
        guard let kind = dto.kind.model else { return nil }
        return FacetOption(
            kind: kind,
            value: dto.value,
            label: dto.label,
            familyCount: dto.familyCount
        )
    }
}

private extension FacetKind {
    var dto: FacetKindDto {
        switch self {
        case .category: .category
        case .script: .script
        case .foundry: .foundry
        case .license: .license
        }
    }
}

private extension FacetKindDto {
    var model: FacetKind? {
        switch self {
        case .category: .category
        case .script: .script
        case .foundry: .foundry
        case .license: .license
        }
    }
}
