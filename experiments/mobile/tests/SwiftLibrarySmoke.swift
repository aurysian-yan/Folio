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
        try smartAndRecent(samples: samples, root: root)
        print("PASS：Swift 移动查询映射、实时筛选、完整身份收藏、手动收藏夹持久化、成员幂等与删除边界")
    }

    // 动态匹配、互转和访问顺序使用独立数据库，避免污染成员回归。
    private static func smartAndRecent(samples: URL, root: URL) throws {
        let path = root.appendingPathComponent("smart.sqlite").path
        let engine = try FolioEngine.open(databasePath: path)
        let rule = try FolioLibraryMapper.conditions(text: "Lato", facets: [("weight", "400")])
        let folder = try engine.createSmartFolderWithStyle(name: "常规字款", query: rule, icon: "books", color: "blue")
        try require(try engine.getSmartFolder(id: folder).matchCount == 0)
        for name in ["Lato-Regular.ttf", "Lato-Bold.ttf", "Inter-Variable.ttf"] {
            _ = try engine.addFontFile(path: samples.appendingPathComponent(name).path)
        }
        _ = try engine.refreshLibrary()
        try require(try engine.getSmartFolder(id: folder).matchCount == 1)
        func read(_ text: String = "", _ facets: [(String, String)] = []) throws -> LibraryPageDto {
            try FolioLibraryMapper.read(engine: engine, text: text, scope: "smart", collectionId: nil,
                smartFolderId: folder.value, facets: facets, offset: 0, limit: 100)
        }
        let regular = try read()
        let either = try read("", [("weight", "700")])
        precondition(either.families[0].matchedFaceIds.count > regular.families[0].matchedFaceIds.count)
        try require(try read("missing").totalMatches == 0)
        try require(try read("", [("feature", "variable")]).totalMatches == 0)
        let all = try engine.queryLibrary(query: query())
        let lato = all.families.first { $0.displayName == "Lato" }!
        let inter = all.families.first { $0.displayName == "Inter" }!
        let manual = try engine.createCollection(name: "独立成员")
        try engine.setCollectionMembers(collectionId: manual.id, identityIds: lato.identityIds, member: true)
        let favoriteRule = try FolioLibraryMapper.conditions(text: "", facets: [("state", "favorite")])
        try engine.updateSmartFolderWithStyle(id: folder, name: "星标字体", query: favoriteRule, icon: "heart", color: "purple")
        try require(try read().totalMatches == 0)
        try engine.setFavorite(identityIds: lato.identityIds, favorite: true)
        try require(try read().totalMatches == 1)
        try engine.setFavorite(identityIds: lato.identityIds, favorite: false)
        try require(try read().totalMatches == 0)
        try require(try engine.loadCachedLibrary().collections.first { $0.id == manual.id }!.memberCount == UInt64(lato.identityIds.count))
        try engine.updateSmartFolderWithStyle(id: folder, name: "常规字款", query: rule, icon: "books", color: "blue")
        let frozen = try engine.convertSmartFolderToCollection(id: folder, name: "固定成员", icon: "books", color: "blue")
        precondition(frozen.memberCount == UInt64(regular.families[0].matchedFaceIds.count))
        let converted = try engine.convertCollectionToSmartFolder(id: frozen.id, name: "重新匹配", query: rule, icon: "heart", color: "purple")
        try require(try engine.queryLibrary(query: query(scope: "collection", id: manual.id.value)).totalMatches == 1)
        try require(try engine.loadCachedLibrary().recentCount == 0)
        let latoId = lato.faces.first { $0.styleName == "Regular" }!.identityId
        try engine.recordRecent(identityId: latoId)
        try engine.recordRecent(identityId: inter.faces[0].identityId)
        try require(try engine.queryLibrary(query: query(scope: "recent")).families.map(\.id) == [inter.id, lato.id])
        try engine.recordRecent(identityId: latoId)
        try require(try engine.queryLibrary(query: query(scope: "recent")).families.map(\.id) == [lato.id, inter.id])
        try require(try engine.loadCachedLibrary().recentCount == 2)
        try require(try engine.queryLibrary(query: query(text: "Lato", scope: "recent", facets: [("weight", "400")])).totalMatches == 1)
        let reopened = try FolioEngine.open(databasePath: path)
        _ = try reopened.loadCachedLibrary()
        try require(try reopened.queryLibrary(query: query(scope: "recent")).families.map(\.id) == [lato.id, inter.id])
        let saved = try reopened.getSmartFolder(id: converted)
        precondition(saved.query.text == "Lato" && saved.query.facets.count == 1)
        _ = try JSONSerialization.data(withJSONObject: FolioLibraryMapper.smartFolder(saved))
        try require((FolioLibraryMapper.snapshot(try reopened.loadCachedLibrary())["smartFolders"] as! [[String: Any]]).count == 1)
        try reopened.deleteSmartFolder(id: converted)
        try require(try reopened.loadCachedLibrary().smartFolders.isEmpty)
        try require(try reopened.queryLibrary(query: query()).totalMatches == all.totalMatches)
        var invalid = false
        do { _ = try FolioLibraryMapper.read(engine: engine, text: "", scope: "smart", collectionId: nil,
            smartFolderId: nil, facets: [], offset: 0, limit: 10) } catch { invalid = true }
        precondition(invalid)
        print("PASS：Swift 智慧动态导入、条件合并、星标刷新、互转与独立成员、持久化及最近访问去重顺序")
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
