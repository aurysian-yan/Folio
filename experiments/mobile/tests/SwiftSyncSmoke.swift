import Foundation

// 主机回归验证生产安全存储与移动来源恢复；不代替 iOS 实机验收。
func runSwiftSyncSmoke(_ samples: URL) throws {
    func check(_ condition: Bool) { precondition(condition) }
    let manager = FileManager.default
    let root = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("FolioMobilePoC")
    let fonts = root.appendingPathComponent("fonts")
    try manager.createDirectory(at: fonts, withIntermediateDirectories: true)
    defer { try? manager.removeItem(at: root.deletingLastPathComponent()) }
    let database = root.appendingPathComponent("folio.sqlite").path
    let legacy = fonts.appendingPathComponent("legacy.font")
    try manager.copyItem(at: samples.appendingPathComponent("Lato-Regular.ttf"), to: legacy)
    try manager.copyItem(at: samples.appendingPathComponent("SourceSerif4-Regular.otf"), to: fonts.appendingPathComponent("legacy-otf.font"))
    try manager.copyItem(at: samples.appendingPathComponent("Lato-Collection.ttc"), to: fonts.appendingPathComponent("legacy-ttc.font"))
    let engine = try FolioEngine.open(databasePath: database)
    _ = try engine.addFontFile(path: legacy.path)
    _ = try engine.addFontFile(path: fonts.appendingPathComponent("legacy-otf.font").path)
    _ = try engine.addFontFile(path: fonts.appendingPathComponent("legacy-ttc.font").path)
    _ = try engine.refreshLibrary()
    let sync = try FolioSync.open(databasePath: database, managedDirectory: fonts.path)
    try sync.prepareManagedSources()
    let page = try FolioLibraryMapper.read(engine: engine, text: "", scope: "all", collectionId: nil,
        smartFolderId: nil, facets: [], offset: 0, limit: 100)
    // 恢复后重新载入缓存，使查询使用已规范化来源。
    _ = try engine.loadCachedLibrary()
    let restored = try FolioLibraryMapper.read(engine: engine, text: "", scope: "all", collectionId: nil,
        smartFolderId: nil, facets: [], offset: 0, limit: 100)
    check(page.totalMatches == restored.totalMatches && restored.totalMatches == 2)
    let paths = try manager.contentsOfDirectory(at: fonts, includingPropertiesForKeys: nil)
    check(Set(paths.map(\.pathExtension)) == Set(["ttf", "otf", "ttc"]))
    check(restored.families.flatMap(\.faces).contains { $0.faceIndex == 1 && $0.sourcePath?.hasSuffix(".ttc") == true })
    check(try engine.loadCachedLibrary().roots.count == 1)
    let profile = SyncProfileDto(serverUrl: "https://independent.example.test/", remoteDirectory: UUID().uuidString,
        username: "test", automatic: true)
    let secret = UUID().uuidString
    defer { try? FolioSyncCredentials.write(nil, profile: profile) }
    try FolioSyncCredentials.write(secret, profile: profile)
    check(try FolioSyncCredentials.read(profile) == secret)
    try sync.saveProfile(profile: profile)
    let reopened = try FolioSync.open(databasePath: database, managedDirectory: fonts.path)
    check(try reopened.profile() == profile)
    check(try FolioSyncCredentials.read(profile) == secret)
    let data = try Data(contentsOf: URL(fileURLWithPath: database))
    check(data.range(of: Data(secret.utf8)) == nil)
    try FolioSyncCredentials.write(nil, profile: profile)
    check(try FolioSyncCredentials.read(profile) == nil)
    try reopened.disconnect()
    check(try reopened.profile() == nil)
    print("PASS：Swift Keychain 写入、读取、删除，连接重开与托管来源恢复；仅主机验证")
}
