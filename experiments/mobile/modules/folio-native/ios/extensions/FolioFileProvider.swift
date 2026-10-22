import CryptoKit
// Files 中的只读字体目录与按需读取。
import FileProvider
import FolioFileServices
import UniformTypeIdentifiers

final class FolioProviderItem: NSObject, NSFileProviderItem {
  let value: [String: Any]
  init(_ value: [String: Any]) { self.value = value }
  var itemIdentifier: NSFileProviderItemIdentifier {
    (value["id"] as? String) == "root"
      ? .rootContainer : NSFileProviderItemIdentifier(value["id"] as? String ?? "")
  }
  var parentItemIdentifier: NSFileProviderItemIdentifier {
    (value["parentId"] as? String) == "root"
      ? .rootContainer : NSFileProviderItemIdentifier(value["parentId"] as? String ?? "root")
  }
  var filename: String {
    if let key = value["titleKey"] as? String { return FolioFileText.text(key) }
    return value["name"] as? String ?? "Folio"
  }
  var capabilities: NSFileProviderItemCapabilities {
    value["directory"] as? Bool == true
      ? [.allowsReading, .allowsContentEnumerating] : [.allowsReading]
  }
  var contentType: UTType {
    value["directory"] as? Bool == true
      ? .folder : UTType(filenameExtension: (filename as NSString).pathExtension) ?? .data
  }
  var documentSize: NSNumber? {
    value["directory"] as? Bool == true ? nil : value["size"] as? NSNumber
  }
  var itemVersion: NSFileProviderItemVersion {
    let metadata =
      (try? JSONSerialization.data(
        withJSONObject: ["document": value, "filename": filename], options: [.sortedKeys]))
      ?? Data(filename.utf8)
    return NSFileProviderItemVersion(
      contentVersion: Data((value["fingerprint"] as? String ?? "folder").utf8),
      metadataVersion: Data(SHA256.hash(data: metadata)))
  }
}

final class FolioFileProvider: NSObject, NSFileProviderReplicatedExtension {
  private let domain: NSFileProviderDomain
  private let lock = NSLock()
  private var reads: [UUID: FolioFileRead] = [:]
  required init(domain: NSFileProviderDomain) {
    self.domain = domain
    super.init()
  }
  func invalidate() {
    lock.lock()
    let pending = reads
    reads.removeAll()
    lock.unlock()
    pending.values.forEach {
      $0.cancel()
      $0.release()
    }
  }
  private func identifier(_ id: NSFileProviderItemIdentifier) -> String {
    id == .rootContainer ? "root" : id.rawValue
  }
  func item(
    for identifier: NSFileProviderItemIdentifier, request: NSFileProviderRequest,
    completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void
  ) -> Progress {
    let progress = Progress(totalUnitCount: 1)
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let runtime = try FolioFileRuntime.shared()
        let json = try runtime.files.document(id: self.identifier(identifier))
        let value = try JSONSerialization.jsonObject(with: Data(json.utf8)) as! [String: Any]
        completionHandler(FolioProviderItem(value), nil)
        progress.completedUnitCount = 1
      } catch { completionHandler(nil, Self.mapped(error)) }
    }
    return progress
  }
  func fetchContents(
    for itemIdentifier: NSFileProviderItemIdentifier,
    version requestedVersion: NSFileProviderItemVersion?, request: NSFileProviderRequest,
    completionHandler: @escaping (URL?, NSFileProviderItem?, Error?) -> Void
  ) -> Progress {
    let progress = Progress(totalUnitCount: 1)
    let token = UUID()
    DispatchQueue.global(qos: .userInitiated).async {
      var output: URL?
      do {
        let runtime = try FolioFileRuntime.shared()
        try runtime.refreshReferences()
        let json = try runtime.files.document(id: self.identifier(itemIdentifier))
        let item = FolioProviderItem(
          try JSONSerialization.jsonObject(with: Data(json.utf8)) as! [String: Any])
        if let requestedVersion, requestedVersion.contentVersion != item.itemVersion.contentVersion
        {
          throw NSFileProviderError(.noSuchItem)
        }
        let read = try runtime.files.read(id: self.identifier(itemIdentifier))
        self.lock.lock()
        self.reads[token] = read
        self.lock.unlock()
        defer {
          self.lock.lock()
          self.reads.removeValue(forKey: token)
          self.lock.unlock()
          read.release()
        }
        progress.cancellationHandler = { read.cancel() }
        if progress.isCancelled { throw CocoaError(.userCancelled) }
        let source = URL(fileURLWithPath: try read.open(password: runtime.password()))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
          UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent((item.filename as NSString).lastPathComponent)
        try FileManager.default.copyItem(at: source, to: file)
        output = file
        if progress.isCancelled { throw CocoaError(.userCancelled) }
        completionHandler(file, item, nil)
        progress.completedUnitCount = 1
      } catch {
        if let output {
          try? FileManager.default.removeItem(at: output.deletingLastPathComponent())
        }
        completionHandler(nil, nil, Self.mapped(error))
      }
    }
    return progress
  }
  func createItem(
    basedOn itemTemplate: NSFileProviderItem, fields: NSFileProviderItemFields, contents url: URL?,
    options: NSFileProviderCreateItemOptions, request: NSFileProviderRequest,
    completionHandler:
      @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void
  ) -> Progress {
    completionHandler(nil, [], false, CocoaError(.fileWriteNoPermission))
    return Progress(totalUnitCount: 0)
  }
  func modifyItem(
    _ item: NSFileProviderItem, baseVersion version: NSFileProviderItemVersion,
    changedFields: NSFileProviderItemFields, contents newContents: URL?,
    options: NSFileProviderModifyItemOptions, request: NSFileProviderRequest,
    completionHandler:
      @escaping (NSFileProviderItem?, NSFileProviderItemFields, Bool, Error?) -> Void
  ) -> Progress {
    completionHandler(nil, [], false, CocoaError(.fileWriteNoPermission))
    return Progress(totalUnitCount: 0)
  }
  func deleteItem(
    identifier: NSFileProviderItemIdentifier, baseVersion version: NSFileProviderItemVersion,
    options: NSFileProviderDeleteItemOptions, request: NSFileProviderRequest,
    completionHandler: @escaping (Error?) -> Void
  ) -> Progress {
    completionHandler(CocoaError(.fileWriteNoPermission))
    return Progress(totalUnitCount: 0)
  }
  func enumerator(
    for containerItemIdentifier: NSFileProviderItemIdentifier, request: NSFileProviderRequest
  ) throws -> NSFileProviderEnumerator {
    FolioProviderEnumerator(
      identifier(containerItemIdentifier), workingSet: containerItemIdentifier == .workingSet)
  }
  static func mapped(_ error: Error) -> Error {
    let nsError = error as NSError
    if nsError.domain == NSFileProviderErrorDomain { return error }
    let message = String(describing: error)
    if message.contains("workflow.error.permission") || message.contains("认证")
      || message.contains("CREDENTIAL")
    {
      return NSFileProviderError(.notAuthenticated)
    }
    if message.contains("Cancelled") || message.contains("cancelled") {
      return CocoaError(.userCancelled)
    }
    if message.contains("workflow.error.invalidRequest") { return NSFileProviderError(.noSuchItem) }
    return NSFileProviderError(.serverUnreachable)
  }
}

final class FolioProviderEnumerator: NSObject, NSFileProviderEnumerator {
  private let parent: String
  private let workingSet: Bool
  private var invalidated = false
  init(_ parent: String, workingSet: Bool) {
    self.parent = parent
    self.workingSet = workingSet
  }
  func invalidate() { invalidated = true }
  private func contents() throws -> [[String: Any]] {
    let runtime = try FolioFileRuntime.shared()
    if !workingSet { return try runtime.documents(parent) }
    var pending = ["root"]
    var result: [[String: Any]] = []
    var seen = Set<String>()
    while let parent = pending.popLast() {
      guard seen.insert(parent).inserted else { continue }
      let children = try runtime.documents(parent)
      result += children
      pending += children.filter { $0["directory"] as? Bool == true }.compactMap {
        $0["id"] as? String
      }
    }
    return result
  }
  private func anchor(_ items: [[String: Any]]) throws -> NSFileProviderSyncAnchor {
    let data = try JSONSerialization.data(withJSONObject: items, options: [.sortedKeys])
    let key = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    let directory = try FolioPaths.container().appendingPathComponent(
      "ProviderAnchors", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try data.write(to: directory.appendingPathComponent(key), options: .atomic)
    return NSFileProviderSyncAnchor(Data(key.utf8))
  }
  private func previous(_ anchor: NSFileProviderSyncAnchor) throws -> [[String: Any]] {
    guard let key = String(data: anchor.rawValue, encoding: .utf8), key.count == 64,
      key.allSatisfy({ $0.isHexDigit })
    else { throw NSFileProviderError(.syncAnchorExpired) }
    let url = try FolioPaths.container().appendingPathComponent("ProviderAnchors")
      .appendingPathComponent(key)
    guard
      let value = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]]
    else { throw NSFileProviderError(.syncAnchorExpired) }
    return value
  }
  func enumerateItems(
    for observer: NSFileProviderEnumerationObserver, startingAt page: NSFileProviderPage
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let items = try self.contents()
        guard !self.invalidated else { return }
        observer.didEnumerate(items.map(FolioProviderItem.init))
        observer.finishEnumerating(upTo: nil)
      } catch { observer.finishEnumeratingWithError(FolioFileProvider.mapped(error)) }
    }
  }
  func currentSyncAnchor(completionHandler: @escaping (NSFileProviderSyncAnchor?) -> Void) {
    completionHandler(try? anchor(contents()))
  }
  func enumerateChanges(
    for observer: NSFileProviderChangeObserver, from syncAnchor: NSFileProviderSyncAnchor
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let old = try self.previous(syncAnchor)
        let items = try self.contents()
        let ids = Set(items.compactMap { $0["id"] as? String })
        let removed = old.compactMap { $0["id"] as? String }.filter { !ids.contains($0) }.map {
          NSFileProviderItemIdentifier($0)
        }
        observer.didDeleteItems(withIdentifiers: removed)
        observer.didUpdate(items.map(FolioProviderItem.init))
        observer.finishEnumeratingChanges(upTo: try self.anchor(items), moreComing: false)
      } catch { observer.finishEnumeratingWithError(NSFileProviderError(.syncAnchorExpired)) }
    }
  }
}
