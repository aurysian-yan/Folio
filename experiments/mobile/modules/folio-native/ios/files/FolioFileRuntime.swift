import CryptoKit
// 扩展与主应用分别持有原生服务，文件与资料通过共享容器协调。
import Foundation

public final class FolioFileRuntime {
  private static let lock = NSRecursiveLock()
  private static var instance: FolioFileRuntime?
  public static func shared() throws -> FolioFileRuntime {
    lock.lock()
    defer { lock.unlock() }
    if let instance { return instance }
    let value = try FolioFileRuntime()
    instance = value
    return value
  }
  public let root: URL
  public let engine: FolioEngine
  public let files: FolioFileService
  public let sync: FolioSync
  public let queue = DispatchQueue(label: "com.folio.files", qos: .userInitiated)
  private let sourceLock = NSRecursiveLock()
  private init() throws {
    root = try FolioPaths.root()
    let database = root.appendingPathComponent("folio.sqlite").path
    files = try FolioFileService.open(
      databasePath: database, managedDirectory: root.appendingPathComponent("fonts").path)
    engine = try FolioEngine.open(databasePath: database)
    sync = try FolioSync.open(
      databasePath: database, managedDirectory: root.appendingPathComponent("fonts").path)
  }
  public func password() throws -> String {
    guard let profile = try sync.profile() else { return "" }
    return try FolioSyncCredentials.read(profile) ?? ""
  }
  public func sources() throws -> [[String: Any]] {
    (try JSONSerialization.jsonObject(with: Data(files.sources().utf8))) as? [[String: Any]] ?? []
  }
  public func documents(_ parent: String) throws -> [[String: Any]] {
    return (try JSONSerialization.jsonObject(with: Data(files.documents(parent: parent).utf8)))
      as? [[String: Any]] ?? []
  }
  public func reference(_ url: URL, name: String, replacing id: String? = nil) throws {
    let access = url.startAccessingSecurityScopedResource()
    defer { if access { url.stopAccessingSecurityScopedResource() } }
    let bookmark = try url.bookmarkData(
      options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
    let existing = try sources().first {
      ($0["locator"] as? String) == bookmark.base64EncodedString()
    }
    let sourceID = id ?? existing?["id"] as? String ?? UUID().uuidString
    let source: [String: Any] = [
      "id": sourceID, "platform": "ios", "locator": bookmark.base64EncodedString(),
      "displayName": name,
      "snapshotPath": root.appendingPathComponent("ReferenceCache/" + sourceID).path,
      "available": true,
    ]
    try snapshot(source, resolved: url)
    try files.saveSource(
      value: String(decoding: JSONSerialization.data(withJSONObject: source), as: UTF8.self))
  }
  public func refreshReferences() throws {
    sourceLock.lock()
    defer { sourceLock.unlock() }
    for var source in try sources() {
      do {
        try snapshot(source)
        source["available"] = true
      } catch {
        source["available"] = false
        let code = (error as NSError).code
        source["unavailableReason"] =
          [NSFileReadNoPermissionError, NSFileWriteNoPermissionError].contains(code)
          ? "permission" : "offline"
      }
      try files.saveSource(
        value: String(decoding: JSONSerialization.data(withJSONObject: source), as: UTF8.self))
    }
  }
  private func snapshot(_ source: [String: Any], resolved: URL? = nil) throws {
    var stale = false
    guard let locator = source["locator"] as? String, let bookmark = Data(base64Encoded: locator),
      let path = source["snapshotPath"] as? String
    else { throw FolioPaths.failure() }
    let url =
      try resolved
      ?? URL(
        resolvingBookmarkData: bookmark, options: .withoutUI, relativeTo: nil,
        bookmarkDataIsStale: &stale)
    let access = url.startAccessingSecurityScopedResource()
    defer { if access { url.stopAccessingSecurityScopedResource() } }
    let directory = URL(fileURLWithPath: path, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var coordinationError: NSError?
    var result: Result<Void, Error> = .failure(FolioPaths.failure())
    NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) {
      readable in
      result = Result {
        let folder = try readable.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true
        var enumerationError: Error?
        let entries = FileManager.default.enumerator(
          at: readable, includingPropertiesForKeys: [.isRegularFileKey],
          options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) { _, error in
          enumerationError = error
          return false
        }
        let urls = folder ? (entries?.allObjects as? [URL] ?? []) : [readable]
        if let enumerationError { throw enumerationError }
        if folder && entries == nil { throw FolioPaths.failure() }
        guard urls.count <= 10_000 else { throw FolioPaths.failure() }
        var retained = Set<String>()
        var origins: [String: String] = [:]
        for file in urls
        where !folder
          || ["ttf", "otf", "ttc", "otc", "woff", "woff2"].contains(file.pathExtension.lowercased())
        {
          guard try file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else {
            continue
          }
          let relative = String(
            file.path.dropFirst(readable.deletingLastPathComponent().path.count))
          let name = SHA256.hash(data: Data(relative.utf8)).map { String(format: "%02x", $0) }
            .joined()
          let target = directory.appendingPathComponent(name, isDirectory: true)
          try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
          let destination = target.appendingPathComponent(file.lastPathComponent)
          let staging = directory.appendingPathComponent("." + UUID().uuidString + ".part")
          defer { try? FileManager.default.removeItem(at: staging) }
          guard
            (try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 256 * 1024 * 1024
          else { throw FolioPaths.failure() }
          try FileManager.default.copyItem(at: file, to: staging)
          do { _ = try engine.analyzeFontFile(path: staging.path) } catch {
            if !folder { throw error }
          }
          if FileManager.default.fileExists(atPath: destination.path) {
            _ = try FileManager.default.replaceItemAt(destination, withItemAt: staging)
          } else {
            try FileManager.default.moveItem(at: staging, to: destination)
          }
          retained.insert(destination.path)
          origins[String(destination.path.dropFirst(directory.path.count + 1))] = String(
            file.path.dropFirst(readable.path.count)
          ).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        }
        let previous =
          FileManager.default.enumerator(
            at: directory, includingPropertiesForKeys: [.isRegularFileKey])?.allObjects as? [URL]
          ?? []
        for file in previous where !retained.contains(file.path) {
          if try file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true {
            try FileManager.default.removeItem(at: file)
          }
        }
        try JSONSerialization.data(withJSONObject: origins).write(
          to: directory.appendingPathComponent(".origins.json"), options: .atomic)
      }
    }
    if let coordinationError { throw coordinationError }
    try result.get()
  }
  public func validateReference(_ file: URL) throws {
    guard
      var source = try sources().first(where: { item in
        guard let path = item["snapshotPath"] as? String else { return false }
        return file.path.hasPrefix(path + "/")
      })
    else { throw FolioPaths.failure() }
    do {
      guard source["available"] as? Bool == true,
        let locator = source["locator"] as? String, let bookmark = Data(base64Encoded: locator),
        let path = source["snapshotPath"] as? String
      else { throw FolioPaths.failure() }
      var stale = false
      let original = try URL(
        resolvingBookmarkData: bookmark, options: .withoutUI, relativeTo: nil,
        bookmarkDataIsStale: &stale)
      let access = original.startAccessingSecurityScopedResource()
      defer { if access { original.stopAccessingSecurityScopedResource() } }
      let origins =
        try JSONSerialization.jsonObject(
          with: Data(contentsOf: URL(fileURLWithPath: path).appendingPathComponent(".origins.json"))
        ) as? [String: String]
      guard let relative = origins?[String(file.path.dropFirst(path.count + 1))] else {
        throw FolioPaths.failure()
      }
      let target = relative.isEmpty ? original : original.appendingPathComponent(relative)
      var failure: NSError?
      var read: Result<Void, Error> = .failure(FolioPaths.failure())
      NSFileCoordinator().coordinate(readingItemAt: target, options: [], error: &failure) { url in
        read = Result {
          let handle = try FileHandle(forReadingFrom: url)
          try handle.close()
        }
      }
      if let failure { throw failure }
      try read.get()
    } catch {
      source["available"] = false
      try? files.saveSource(
        value: String(decoding: JSONSerialization.data(withJSONObject: source), as: UTF8.self))
      throw error
    }
  }
  public func state() throws -> String {
    let inbox = try FileManager.default.contentsOfDirectory(
      at: FolioPaths.inbox(), includingPropertiesForKeys: nil
    ).compactMap { url -> [String: Any]? in
      guard let data = try? Data(contentsOf: url.appendingPathComponent("manifest.json")),
        var item = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      else { return nil }
      item["id"] = url.lastPathComponent
      return item
    }
    let value: [String: Any] = [
      "sources": try sources(),
      "batches": try JSONSerialization.jsonObject(with: Data(files.batches().utf8)),
      "health": try JSONSerialization.jsonObject(with: Data(files.health().utf8)), "inbox": inbox,
    ]
    return String(decoding: try JSONSerialization.data(withJSONObject: value), as: UTF8.self)
  }
}
