import Foundation

// 双端桥接契约通过真实字体与临时数据库回归。
enum SwiftLibrarySmoke {
    static func run(samples: URL) throws {
        let manager = FileManager.default
        let root = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try manager.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: root) }
        let path = root.appendingPathComponent("folio.sqlite").path
        let engine = try FolioEngine.open(databasePath: path)
        for name in ["Lato-Regular.ttf", "Lato-Bold.ttf", "Inter-Variable.ttf", "SourceSerif4-Regular.otf", "Lato-Collection.ttc"] {
            _ = try engine.addFontFile(path: samples.appendingPathComponent(name).path)
        }
        _ = try engine.refreshLibrary()
        let all = try engine.queryLibrary(query: query())
        let family = all.families.first { $0.displayName == "Lato" }!
        let regular = all.facets.first { $0.kind == .weight && $0.value == "400" }!
        let filtered = try engine.queryLibrary(query: query(text: "Lato", facets: [("weight", regular.value)]))
        precondition(filtered.totalMatches == 1)
        precondition(filtered.families[0].identityIds.count == family.identityIds.count)
        precondition(filtered.families[0].matchedFaceIds.count < family.faces.count)
        let either = try engine.queryLibrary(query: query(text: "Lato", facets: [("weight", "400"), ("weight", "700")]))
        precondition(either.families[0].matchedFaceIds.count > filtered.families[0].matchedFaceIds.count)
        let variable = all.facets.first { $0.kind == .feature && $0.value == "variable" }!
        try require(try engine.queryLibrary(query: query(text: "Lato", facets: [("feature", variable.value)])).totalMatches == 0)

        let collection = try engine.createCollectionWithIcon(name: "移动测试", icon: "books", color: "blue")
        try engine.setCollectionMembers(collectionId: collection.id, identityIds: family.identityIds, member: true)
        try engine.setCollectionMembers(collectionId: collection.id, identityIds: family.identityIds, member: true)
        try engine.setFavorite(identityIds: filtered.families[0].identityIds, favorite: true)
        let scoped = try engine.queryLibrary(query: query(text: "Lato", scope: "collection", id: collection.id.value,
                                                        facets: [("weight", regular.value)]))
        precondition(scoped.totalMatches == 1 && scoped.families[0].isFavorite)
        try require(try engine.loadCachedLibrary().collections[0].memberCount == UInt64(family.identityIds.count))
        try engine.updateCollection(id: collection.id, name: "改名后的收藏夹", icon: "heart", color: "purple")
        let reopened = try FolioEngine.open(databasePath: path)
        let snapshot = try reopened.loadCachedLibrary()
        precondition(snapshot.collections[0].name == "改名后的收藏夹" && snapshot.collections[0].icon == "heart")
        precondition(snapshot.collections[0].color == "purple")
        let dictionary = FolioLibraryMapper.snapshot(snapshot)
        precondition((dictionary["collections"] as? [[String: Any]])?[0]["name"] as? String == "改名后的收藏夹")
        let page = FolioLibraryMapper.page(scoped)
        precondition((page["families"] as? [[String: Any]])?[0]["identityIds"] as? [String] == scoped.families[0].identityIds.map(\.value))
        precondition(!(page["facets"] as! [[String: Any]]).isEmpty)
        _ = try JSONSerialization.data(withJSONObject: page)

        try reopened.setCollectionMembers(collectionId: collection.id, identityIds: family.identityIds, member: false)
        try require(try reopened.queryLibrary(query: query(scope: "collection", id: collection.id.value)).totalMatches == 0)
        try reopened.deleteCollection(id: collection.id)
        try require(try reopened.loadCachedLibrary().collections.isEmpty)
        try require(try reopened.queryLibrary(query: query(scope: "favorites")).families.contains { $0.id == family.id })
        try require(try reopened.queryLibrary(query: query()).totalMatches == all.totalMatches)
        for key in ["category", "script", "foundry", "license", "weight", "width", "feature", "state", "multipleVariants"] {
            _ = try query(facets: [(key, "value")])
        }
        for invalid in [
            { try query(scope: "collection") }, { try query(scope: "all", id: collection.id.value) },
            { try query(facets: [("unknown", "x")]) }, { try query(facets: [("weight", "")]) },
            { try query(offset: -1) }, { try query(limit: 101) },
        ] {
            var rejected = false
            do { _ = try invalid() } catch { rejected = true }
            precondition(rejected)
        }
        print("PASS：Swift 移动查询映射、实时筛选、完整身份收藏、手动收藏夹持久化、成员幂等与删除边界")
    }

    private static func require(_ condition: @autoclosure () throws -> Bool) throws {
        let valid = try condition()
        precondition(valid)
    }

    private static func query(text: String = "", scope: String = "all", id: String? = nil,
                              facets: [(String, String)] = [], offset: Int = 0, limit: Int = 100) throws -> LibraryQueryDto {
        try FolioLibraryMapper.query(text: text, scope: scope, collectionId: id, facets: facets, offset: offset, limit: limit)
    }
}
