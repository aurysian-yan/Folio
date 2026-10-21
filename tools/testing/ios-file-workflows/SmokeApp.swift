// 在隔离模拟器中验证共享容器、引用失效和系统文件提供器。
import CryptoKit
import FileProvider
import FolioFileServices
import UIKit

func require(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
  if try !condition() {
    throw NSError(
      domain: "FolioFileValidation", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}

func coordinatedRead(_ url: URL) throws -> Data {
  var failure: NSError?
  var result: Result<Data, Error> = .failure(FolioPaths.failure())
  NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &failure) { readable in
    result = Result { try Data(contentsOf: readable) }
  }
  if let failure { throw failure }
  return try result.get()
}

final class FileSmokeObserver: NSObject, NSFileProviderEnumerationObserver {
  let completed = DispatchSemaphore(value: 0)
  var items: [NSFileProviderItem] = []
  var failure: Error?
  func didEnumerate(_ updatedItems: [NSFileProviderItem]) { items += updatedItems }
  func finishEnumerating(upTo nextPage: NSFileProviderPage?) { completed.signal() }
  func finishEnumeratingWithError(_ error: Error) {
    failure = error
    completed.signal()
  }
}

final class FileSmokeDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  private var phase = "start"
  private var checks: [String: Any] = [:]
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    DispatchQueue.global(qos: .userInitiated).async {
      do { try self.run() } catch {
        self.save([
          "success": false, "phase": self.phase, "error": String(describing: error),
          "errorChain": self.errorChain(error),
        ])
      }
    }
    return true
  }
  private func errorChain(_ error: Error) -> [[String: Any]] {
    var result: [[String: Any]] = []
    var current: NSError? = error as NSError
    while let error = current, result.count < 8 {
      result.append([
        "domain": error.domain, "code": error.code,
        "description": error.localizedDescription,
      ])
      current = error.userInfo[NSUnderlyingErrorKey] as? NSError
    }
    return result
  }
  private func save(_ value: [String: Any]) {
    let destination = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("validation.json")
    try? JSONSerialization.data(
      withJSONObject: checks.merging(value) { _, current in current },
      options: [.prettyPrinted, .sortedKeys]
    )
    .write(to: destination, options: .atomic)
  }
  private func run() throws {
    let manager = FileManager.default
    let old = try manager.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
    ).appendingPathComponent("FolioMobilePoC")
    try manager.createDirectory(
      at: old.appendingPathComponent("fonts"), withIntermediateDirectories: true)
    let font = old.appendingPathComponent("fonts/Source.ttf")
    let bytes = try Data(
      contentsOf: Bundle.main.url(forResource: "Lato-Regular", withExtension: "ttf")!)
    if !manager.fileExists(atPath: font.path) { try bytes.write(to: font) }
    let before = try FolioEngine.open(databasePath: old.appendingPathComponent("folio.sqlite").path)
    _ = try before.addFontFile(path: font.path)
    _ = try before.refreshLibrary()
    phase = "app-group"
    let stale = try FolioPaths.container().appendingPathComponent("LibraryMigration")
    try manager.createDirectory(at: stale, withIntermediateDirectories: true)
    try Data("interrupted".utf8).write(to: stale.appendingPathComponent("partial"))
    phase = "migration"
    let runtime = try FolioFileRuntime.shared()
    try require(manager.fileExists(atPath: font.path), "migration removed legacy data")
    try require(
      try Data(contentsOf: runtime.root.appendingPathComponent("fonts/Source.ttf")) == bytes,
      "migration bytes differ")
    let roots = try runtime.engine.loadCachedLibrary().roots
    try require(
      roots.contains(where: { $0.displayPath.hasPrefix(runtime.root.path) }),
      "root paths were not relocated")
    checks["migration"] = true
    let analysis =
      try JSONSerialization.jsonObject(
        with: Data(
          runtime.engine.analyzeFontFile(
            path: runtime.root.appendingPathComponent("fonts/Source.ttf").path
          ).utf8)) as! [String: Any]
    let fingerprint = analysis["fingerprint"] as! String
    let read = try runtime.files.read(id: "local/" + fingerprint)
    try require(
      try Data(contentsOf: URL(fileURLWithPath: read.open(password: ""))) == bytes,
      "native read differs")
    read.release()
    let cancelled = try runtime.files.read(id: "local/" + fingerprint)
    cancelled.cancel()
    do {
      _ = try cancelled.open(password: "")
      throw NSError(domain: "cancel accepted", code: 1)
    } catch {
      try require(!String(describing: error).contains("cancel accepted"), "cancel ignored")
    }
    checks["cancel"] = true
    phase = "reference"
    let external = manager.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("External.ttf")
    try (bytes + Data(UUID().uuidString.utf8)).write(to: external)
    try runtime.reference(external, name: external.lastPathComponent)
    try require(try runtime.sources().count == 1, "reference not registered")
    try manager.removeItem(at: external)
    try runtime.refreshReferences()
    try require(
      try runtime.sources()[0]["available"] as? Bool == false, "missing origin remained available")
    try runtime.files.removeSource(id: try runtime.sources()[0]["id"] as! String)
    checks["referenceUnavailable"] = true
    phase = "provider-native"
    let longName = FolioProviderItem([
      "id": "long-name", "parentId": "root", "name": String(repeating: "a", count: 200),
      "directory": true,
    ])
    try require(longName.itemVersion.metadataVersion.count == 32, "metadata version is not SHA-256")
    try require(
      longName.itemVersion.metadataVersion
        == FolioProviderItem(longName.value).itemVersion.metadataVersion,
      "metadata version is not stable")
    var renamed = longName.value
    renamed["name"] = String(repeating: "b", count: 200)
    try require(
      longName.itemVersion.metadataVersion
        != FolioProviderItem(renamed).itemVersion.metadataVersion,
      "renaming did not change metadata version")
    checks["nativeMetadataVersion"] = true
    let observer = FileSmokeObserver()
    let enumerator = FolioProviderEnumerator("root", workingSet: false)
    enumerator.enumerateItems(
      for: observer,
      startingAt: NSFileProviderPage(NSFileProviderPage.initialPageSortedByName as Data))
    try require(
      observer.completed.wait(timeout: .now() + 30) == .success, "native enumeration timed out")
    if let error = observer.failure { throw error }
    try require(observer.items.count == 4, "native root folder count differs")
    try require(Set(observer.items.map(\.filename)).count == 4, "native folder names collide")
    try require(
      observer.items.contains { $0.filename == FolioFileText.text("workflow.favorites") },
      "native favorites name differs")
    try require(
      observer.items.allSatisfy { ($0.documentSize ?? nil) == nil }, "native folder has a file size"
    )
    let domain = NSFileProviderDomain(
      identifier: NSFileProviderDomainIdentifier(
        FolioPaths.identity
          + (CommandLine.arguments.contains("--fresh-domain") ? ".validation" : ".library")),
      displayName: "Folio")
    let extensionService = FolioFileProvider(domain: domain)
    let fetched = DispatchSemaphore(value: 0)
    var fetchedURL: URL?
    var fetchError: Error?
    _ = extensionService.fetchContents(
      for: NSFileProviderItemIdentifier("local/" + fingerprint), version: nil,
      request: NSFileProviderRequest()
    ) { url, _, error in
      fetchedURL = url
      fetchError = error
      fetched.signal()
    }
    try require(fetched.wait(timeout: .now() + 30) == .success, "native fetch timed out")
    if let fetchError { throw fetchError }
    let nativeURL = try fetchedURL.unwrap()
    try require(try Data(contentsOf: nativeURL) == bytes, "native extension bytes differ")
    try manager.removeItem(at: nativeURL.deletingLastPathComponent())
    var writeError: Error?
    _ = extensionService.deleteItem(
      identifier: NSFileProviderItemIdentifier("local/" + fingerprint),
      baseVersion: NSFileProviderItemVersion(contentVersion: Data(), metadataVersion: Data()),
      options: [], request: NSFileProviderRequest()
    ) { writeError = $0 }
    try require(
      (writeError as NSError?)?.code == NSFileWriteNoPermissionError,
      "native write was not rejected")
    extensionService.invalidate()
    checks["nativeExtensionEnumeration"] = true
    checks["nativeExtensionRead"] = true
    checks["nativeExtensionRejectsWrite"] = true
    let cancelledError = FolioFileProvider.mapped(CocoaError(.userCancelled)) as NSError
    try require(
      cancelledError.domain == NSCocoaErrorDomain && cancelledError.code == NSUserCancelledError,
      "provider cancellation changed its error category")
    checks["nativeCancellationMapping"] = true
    if CommandLine.arguments.contains("--native-only") {
      save(["success": true, "scope": "native-only", "phase": phase])
      return
    }
    phase = "provider-domain"
    let added = DispatchSemaphore(value: 0)
    var domainError: Error?
    NSFileProviderManager.add(domain) {
      domainError = $0
      added.signal()
    }
    try require(added.wait(timeout: .now() + 30) == .success, "provider registration timed out")
    if let domainError { throw domainError }
    guard let provider = NSFileProviderManager(for: domain) else { throw FolioPaths.failure() }
    func visible(_ id: NSFileProviderItemIdentifier) throws -> URL {
      let completed = DispatchSemaphore(value: 0)
      var output: URL?
      var failure: Error?
      provider.getUserVisibleURL(for: id) {
        output = $0
        failure = $1
        completed.signal()
      }
      try require(completed.wait(timeout: .now() + 30) == .success, "provider URL timed out")
      if let failure { throw failure }
      return try output.unwrap()
    }
    phase = "provider-enumeration"
    let root = try visible(.rootContainer)
    var coordinationError: NSError?
    var enumerationError: Error?
    var children: [URL] = []
    checks["providerRootPath"] = root.path
    NSFileCoordinator().coordinate(readingItemAt: root, options: [], error: &coordinationError) {
      url in
      do {
        children = try manager.contentsOfDirectory(at: url, includingPropertiesForKeys: nil)
      } catch {
        enumerationError = error
      }
    }
    if let error = coordinationError ?? enumerationError as NSError? { throw error }
    let expectedNames = Set(observer.items.map(\.filename))
    let visibleNames = Set(children.map(\.lastPathComponent))
    checks["providerRootChildren"] = children.map(\.lastPathComponent).sorted()
    checks["providerRootEnumeration"] = expectedNames.isSubset(of: visibleNames)
    save(["success": false, "phase": phase])
    for folder in observer.items { _ = try visible(folder.itemIdentifier) }
    children = try manager.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
    checks["providerRootChildren"] = children.map(\.lastPathComponent).sorted()
    checks["providerRootEnumeration"] = expectedNames.isSubset(
      of: Set(children.map(\.lastPathComponent)))
    try require(
      checks["providerRootEnumeration"] as? Bool == true, "system root enumeration is incomplete")
    phase = "provider-read"
    let url = try visible(NSFileProviderItemIdentifier("local/" + fingerprint))
    try require(try coordinatedRead(url) == bytes, "provider bytes differ")
    checks["providerRead"] = true
    save([
      "success": true, "migration": true, "referenceUnavailable": true, "cancel": true,
      "providerRead": true, "providerPath": url.path,
      "digest": SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(),
    ])
  }
}

final class FileSmokeScene: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  func scene(
    _ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions
  ) {
    guard let scene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: scene)
    let controller = UIViewController()
    controller.view.backgroundColor = .systemBackground
    window.rootViewController = controller
    window.makeKeyAndVisible()
    self.window = window
  }
}

extension Optional {
  func unwrap() throws -> Wrapped {
    guard let self else { throw FolioPaths.failure() }
    return self
  }
}

if CommandLine.arguments.contains("--remove-test-domain") {
  let domain = NSFileProviderDomain(
    identifier: NSFileProviderDomainIdentifier(FolioPaths.identity + ".validation"),
    displayName: "Folio")
  DispatchQueue.global().async {
    NSFileProviderManager.remove(domain) { error in
      if let error { fputs(String(describing: error) + "\n", stderr) }
      exit(error == nil ? 0 : 1)
    }
  }
  dispatchMain()
} else if CommandLine.arguments.count > 2 && CommandLine.arguments[1] == "--read-path" {
  do {
    let bytes = try coordinatedRead(URL(fileURLWithPath: CommandLine.arguments[2]))
    print(SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined())
  } catch {
    fputs(String(describing: error) + "\n", stderr)
    exit(1)
  }
} else {
  UIApplicationMain(
    CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(FileSmokeDelegate.self))
}
