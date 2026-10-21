import CryptoKit
// 主应用和扩展共享本机资料，开发与正式身份分别隔离。
import Foundation

public enum FolioPaths {
  private static let lock = NSRecursiveLock()
  public static var identity: String {
    Bundle.main.object(forInfoDictionaryKey: "FolioApplicationIdentifier") as? String ?? Bundle.main
      .bundleIdentifier ?? "com.folio.mobile.poc"
  }
  public static func container() throws -> URL {
    guard
      let url = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: "group." + identity)
    else { throw failure() }
    return url
  }
  public static func inbox() throws -> URL {
    let url = try container().appendingPathComponent("Inbox", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }
  public static func root() throws -> URL {
    lock.lock()
    defer { lock.unlock() }
    let container = try container()
    let root = container.appendingPathComponent("FolioMobilePoC", isDirectory: true)
    let marker = container.appendingPathComponent("library-ready")
    if !FileManager.default.fileExists(atPath: marker.path) {
      guard Bundle.main.bundleIdentifier == identity else { throw failure() }
      let old = try FileManager.default.url(
        for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
      ).appendingPathComponent("FolioMobilePoC", isDirectory: true)
      let staging = container.appendingPathComponent("LibraryMigration", isDirectory: true)
      if FileManager.default.fileExists(atPath: staging.path) {
        try FileManager.default.removeItem(at: staging)
      }
      if FileManager.default.fileExists(atPath: old.path) {
        try FileManager.default.copyItem(at: old, to: staging)
        let originalFiles =
          FileManager.default.enumerator(at: old, includingPropertiesForKeys: [.isRegularFileKey])?
          .allObjects as? [URL] ?? []
        for file in originalFiles {
          if try file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile != true {
            continue
          }
          let relative = String(file.path.dropFirst(old.path.count + 1))
          guard try digest(file) == digest(staging.appendingPathComponent(relative)) else {
            throw failure()
          }
        }
        let db = try FolioEngine.open(
          databasePath: staging.appendingPathComponent("folio.sqlite").path)
        _ = try db.loadCachedLibrary()
      } else {
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
      }
      if FileManager.default.fileExists(atPath: root.path) {
        try FileManager.default.removeItem(at: root)
      }
      try FileManager.default.moveItem(at: staging, to: root)
      let service = try FolioFileService.open(
        databasePath: root.appendingPathComponent("folio.sqlite").path,
        managedDirectory: root.appendingPathComponent("fonts").path)
      try service.relocate(oldDirectory: old.path)
      try Data("12".utf8).write(to: marker, options: .atomic)
    }
    return root
  }
  private static func digest(_ url: URL) throws -> SHA256.Digest {
    let file = try FileHandle(forReadingFrom: url)
    defer { try? file.close() }
    var hash = SHA256()
    while let data = try file.read(upToCount: 65_536), !data.isEmpty { hash.update(data: data) }
    return hash.finalize()
  }
  public static func managedFont(_ path: String) throws -> URL {
    let root = try root().resolvingSymlinksInPath()
    let source = URL(fileURLWithPath: path).resolvingSymlinksInPath()
    let managed = root.appendingPathComponent("fonts", isDirectory: true)
    let references = root.appendingPathComponent("ReferenceCache", isDirectory: true)
    guard source.path.hasPrefix(managed.path + "/") || source.path.hasPrefix(references.path + "/"),
      FileManager.default.isReadableFile(atPath: source.path)
    else { throw failure() }
    if source.path.hasPrefix(references.path + "/") {
      try FolioFileRuntime.shared().validateReference(source)
    }
    return source
  }
  public static func relocatedFont(_ path: String) throws -> URL? {
    guard let range = path.range(of: "/FolioMobilePoC/fonts/", options: .backwards) else {
      return nil
    }
    let name = String(path[range.upperBound...])
    guard !name.isEmpty, !name.contains("/"), name != ".", name != ".." else { return nil }
    let candidate = try root().appendingPathComponent("fonts", isDirectory: true)
      .appendingPathComponent(name)
    guard candidate.path != path, FileManager.default.isReadableFile(atPath: candidate.path) else {
      return nil
    }
    return try managedFont(candidate.path)
  }
  public static func failure() -> NSError {
    NSError(
      domain: "FolioFiles", code: 1,
      userInfo: [NSLocalizedDescriptionKey: "workflow.error.sourceUnavailable"])
  }
}

public enum FolioFileText {
  public static func text(_ key: String) -> String {
    let language =
      Locale.preferredLanguages.first?.lowercased().hasPrefix("zh") == true ? "zh-CN" : "en"
    let bundles = [Bundle.main, Bundle(for: BundleAnchor.self)]
    let resources =
      bundles.compactMap { $0.url(forResource: "FolioFileStrings", withExtension: "bundle") }
      .compactMap(Bundle.init(url:)) + bundles
    for bundle in resources {
      if let url = bundle.url(forResource: language, withExtension: "json"),
        let data = try? Data(contentsOf: url),
        var value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      {
        let parts = key.split(separator: ".").map(String.init)
        for part in parts.dropLast() { value = value[part] as? [String: Any] ?? [:] }
        if let text = value[parts.last ?? ""] as? String { return text }
      }
    }
    return "Folio"
  }
  private final class BundleAnchor: NSObject {}
}
