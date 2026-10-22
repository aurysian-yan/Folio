import Foundation

// 通过生成的 Swift 接口验证下载交接与真实字体收录。
enum SwiftOnlineSmoke {
  static func run(samples: URL) throws {
    let manager = FileManager.default
    let root = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try manager.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? manager.removeItem(at: root) }
    let database = root.appendingPathComponent("folio.sqlite").path
    let transfers = root.appendingPathComponent("transfers").path
    let browser = try FolioBrowser.open(databasePath: database, transferDirectory: transfers)
    let state = try object(browser.state())
    precondition(state["accepted"] as? Bool == false)
    var refused = false
    let origin = #"{"providerId":"test","providerName":"字体来源","sourcePageUrl":"https://example.com/font?token=secret","downloadHost":"example.com"}"#
    do { _ = try browser.createDownload(url: "https://example.com/font", name: "download", origin: origin) }
    catch { refused = true }
    precondition(refused)
    try browser.acceptDisclaimer()
    let importedIcon = try object(browser.importIcon(path: samples.deletingLastPathComponent().appendingPathComponent("assets/design/icon.png").path))
    let iconID = importedIcon["assetId"] as! String
    let iconURI = importedIcon["uri"] as! String
    precondition(manager.fileExists(atPath: URL(string: iconURI)!.path))
    var providers = (try object(browser.state())["providers"]) as! [[String: Any]]
    providers[0]["icon"] = ["kind": "custom", "assetId": iconID]
    try browser.saveProviders(value: String(decoding: JSONSerialization.data(withJSONObject: providers), as: UTF8.self))
    let reopenedBrowser = try FolioBrowser.open(databasePath: database, transferDirectory: transfers)
    let persisted = (try object(reopenedBrowser.state())["providers"]) as! [[String: Any]]
    precondition(persisted[0]["iconUri"] as? String == iconURI)
    let refreshedIcon = try reopenedBrowser.refreshIcon(providerId: providers[0]["id"] as! String, pageUrl: providers[0]["homepage"] as! String, candidates: [])
    precondition(!refreshedIcon)
    let search = try browser.search(providerId: "maoken", query: "字体 &?#")
    precondition(search.contains("%E5%AD%97%E4%BD%93%20%26%3F%23"))
    let job = try object(browser.createDownload(url: "https://example.com/font?token=secret", name: "download", origin: origin))
    let id = job["id"] as! String
    let path = try browser.downloadPath(id: id)
    try manager.copyItem(at: samples.appendingPathComponent("Lato-Regular.ttf"), to: URL(fileURLWithPath: path))
    try browser.progress(id: id, done: 4, total: nil, generation: 0)
    try browser.setDownloadState(id: id, state: "paused", errorKey: nil, generation: 0)
    try browser.setDownloadState(id: id, state: "queued", errorKey: nil, generation: 0)
    var staleRefused = false
    do { try browser.finishDownload(id: id, generation: 0) } catch { staleRefused = true }
    precondition(staleRefused)
    try browser.finishDownload(id: id, generation: 1)
    let completed = try object(browser.state())
    let ready = (completed["jobs"] as! [[String: Any]]).first { $0["id"] as? String == id }!
    precondition(ready["name"] as? String == "download.ttf")
    precondition(ready["state"] as? String == "ready")
    precondition(!String(describing: ready).contains("secret"))
    let engine = try FolioEngine.open(databasePath: database)
    let file = SelectedImportFile(uri: URL(fileURLWithPath: path).absoluteString, name: ready["name"] as! String)
    let importer = FolioFontImporter(engine: engine, root: root)
    let result = try importer.importFiles([file])
    precondition(result.items.map(\.status) == ["imported"])
    precondition(result.snapshot.faceCount == 1)
    let duplicate = try FolioFontImporter(engine: engine, root: root).importFiles([file])
    precondition(duplicate.items.map(\.status) == ["duplicate"])
    let analysis = try object(engine.analyzeFontFile(path: path))
    try browser.recordOrigin(id: id, fingerprint: analysis["fingerprint"] as! String)
    try browser.setDownloadState(id: id, state: "completed", errorKey: nil, generation: 1)
    try browser.cancelDownload(id: id)
    precondition(!manager.fileExists(atPath: path))
    let reopened = try FolioEngine.open(databasePath: database)
    let snapshot = try reopened.loadCachedLibrary()
    precondition(snapshot.faceCount == 1)
    print("PASS：Swift 在线字体交接、旧回调拒绝、内容识别、真实收录、重复检测与取消保留字体库")
  }

  private static func object(_ value: String) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: Data(value.utf8)) as! [String: Any]
  }
}
