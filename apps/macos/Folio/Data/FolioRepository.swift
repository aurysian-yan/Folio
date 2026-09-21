import Foundation

actor FolioRepository {
    private let engine: FolioEngine

    init() throws {
        let manager = FileManager.default
        let support = try manager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appendingPathComponent("Folio", isDirectory: true)
        try manager.createDirectory(at: support, withIntermediateDirectories: true)
        engine = try FolioEngine.open(databasePath: support.appendingPathComponent("folio.sqlite").path)
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

    func addDefaultLibraryRoots() throws -> Bool {
        let manager = FileManager.default
        let home = manager.homeDirectoryForCurrentUser
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

    func query(
        text: String,
        destination: SidebarDestination,
        facets: Set<FacetOption>,
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

    func createCollection(name: String) throws {
        _ = try engine.createCollection(name: name)
    }

    func renameCollection(_ id: CollectionID, name: String) throws {
        try engine.renameCollection(id: CollectionIdDto(value: id.rawValue), name: name)
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
                    memberCount: $0.memberCount
                )
            },
            roots: dto.roots.map {
                RootSummary(
                    id: RootID(rawValue: $0.id.value),
                    displayPath: $0.displayPath,
                    recursive: $0.recursive,
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
