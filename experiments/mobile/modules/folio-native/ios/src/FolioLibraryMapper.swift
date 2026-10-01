import Foundation

// 移动查询与返回值统一映射到既有 Rust 契约。
enum FolioLibraryMapper {
    static func query(text: String, scope: String, collectionId: String?, facets: [(String, String)],
                      offset: Int, limit: Int) throws -> LibraryQueryDto {
        guard offset >= 0, (1...100).contains(limit),
              (scope == "collection" ? collectionId?.isEmpty == false : collectionId == nil) else {
            throw invalidQuery()
        }
        let queryScope: QueryScopeDto
        switch scope {
        case "all": queryScope = .all
        case "favorites": queryScope = .favorites
        case "recent": queryScope = .recent
        case "collection": queryScope = .collection
        default: throw invalidQuery()
        }
        let selections = try facets.map { kind, value in
            guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw invalidQuery() }
            return FacetSelectionDto(kind: try facetKind(kind), value: value)
        }
        return LibraryQueryDto(text: text.isEmpty ? nil : text, scope: queryScope,
            collectionId: collectionId.map { CollectionIdDto(value: $0) }, facets: selections,
            allowedFaceIds: nil, allowedSourcePaths: nil, offset: UInt64(offset), limit: UInt64(limit))
    }

    static func page(_ page: LibraryPageDto) -> [String: Any] {
        ["totalMatches": page.totalMatches, "unresolvedScopeItems": page.unresolvedScopeItems,
         "facets": page.facets.map { facet in
            ["kind": facetKey(facet.kind), "value": facet.value, "label": facet.label,
             "familyCount": facet.familyCount] as [String: Any]
         }, "families": page.families.map { family in
            ["id": family.id.value, "displayName": family.displayName, "isFavorite": family.isFavorite,
             "identityIds": family.identityIds.map(\.value), "matchedFaceIds": family.matchedFaceIds.map(\.value),
             "faces": family.faces.map { face in
                ["id": face.id.value, "identityId": face.identityId.value, "revisionId": face.revisionId,
                 "styleName": face.styleName, "sourcePath": face.sourcePath as Any? ?? NSNull(),
                 "faceIndex": face.faceIndex, "axes": face.axes.map { axis in
                    ["tag": axis.tag, "name": axis.name, "minimum": axis.minValue,
                     "defaultValue": axis.defaultValue, "maximum": axis.maxValue] as [String: Any]
                 }] as [String: Any]
             }] as [String: Any]
         }]
    }

    static func snapshot(_ value: LibrarySnapshotDto) -> [String: Any] {
        ["familyCount": value.familyCount, "faceCount": value.faceCount,
         "variableFamilyCount": value.variableFamilyCount, "recentCount": value.recentCount,
         "damagedCount": value.health.damagedFiles, "collections": value.collections.map { collection in
            ["id": collection.id.value, "name": collection.name, "icon": collection.icon,
             "color": collection.color, "memberCount": collection.memberCount] as [String: Any]
         }]
    }

    private static func invalidQuery() -> NSError {
        NSError(domain: "FolioQuery", code: 1, userInfo: [NSLocalizedDescriptionKey: "查询范围无效。"])
    }

    private static func facetKind(_ key: String) throws -> FacetKindDto {
        switch key {
        case "category": return .category
        case "script": return .script
        case "foundry": return .foundry
        case "license": return .license
        case "weight": return .weight
        case "width": return .width
        case "feature": return .feature
        case "state": return .state
        case "multipleVariants": return .multipleVariants
        default: throw invalidQuery()
        }
    }

    private static func facetKey(_ kind: FacetKindDto) -> String {
        switch kind {
        case .category: return "category"
        case .script: return "script"
        case .foundry: return "foundry"
        case .license: return "license"
        case .weight: return "weight"
        case .width: return "width"
        case .feature: return "feature"
        case .state: return "state"
        case .multipleVariants: return "multipleVariants"
        }
    }
}
