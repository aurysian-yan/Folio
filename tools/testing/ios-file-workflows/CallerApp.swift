// 独立沙盒调用系统选取器，不链接 Folio 服务或共享容器。
import CryptoKit
import UIKit
import UniformTypeIdentifiers

final class FileCaller: UIViewController, UIDocumentPickerDelegate {
  private var opened = false
  private let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !opened else { return }
    opened = true
    view.backgroundColor = .systemBackground
    save(["success": false, "phase": "picker", "cancelled": false])
    if CommandLine.arguments.contains("--read-bookmark") {
      do {
        var stale = false
        let bookmark = try Data(contentsOf: documents.appendingPathComponent("selected.bookmark"))
        let url = try URL(
          resolvingBookmarkData: bookmark, options: .withoutUI,
          relativeTo: nil, bookmarkDataIsStale: &stale)
        read(url, stale: stale)
      } catch { failed(error) }
      return
    }
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.data], asCopy: false)
    picker.delegate = self
    present(picker, animated: false)
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL])
  {
    guard let url = urls.first else { return }
    read(url, stale: false)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    save(["success": true, "phase": "cancel", "cancelled": true])
  }

  private func read(_ url: URL, stale: Bool) {
    DispatchQueue.global(qos: .userInitiated).async {
      let access = url.startAccessingSecurityScopedResource()
      defer { if access { url.stopAccessingSecurityScopedResource() } }
      do {
        var failure: NSError?
        var bytes: Data?
        var readError: Error?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &failure) {
          readable in
          do { bytes = try Data(contentsOf: readable) } catch { readError = error }
        }
        if let error = failure ?? readError as NSError? { throw error }
        guard let bytes else { throw CocoaError(.fileReadUnknown) }
        let digest = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        let expected = try Data(
          contentsOf: Bundle.main.url(forResource: "Lato-Regular", withExtension: "ttf")!)
        let bookmark = try url.bookmarkData(
          options: .minimalBookmark,
          includingResourceValuesForKeys: nil, relativeTo: nil)
        try bookmark.write(
          to: self.documents.appendingPathComponent("selected.bookmark"), options: .atomic)
        self.save([
          "success": bytes == expected, "phase": "read", "cancelled": false,
          "path": url.path, "digest": digest, "byteCount": bytes.count,
          "securityScopedAccess": access, "staleBookmark": stale,
          "mode": CommandLine.arguments.contains("--read-bookmark") ? "bookmark" : "picker",
        ])
      } catch { self.failed(error) }
    }
  }

  private func failed(_ error: Error) {
    let error = error as NSError
    save([
      "success": false, "phase": "read", "errorDomain": error.domain,
      "errorCode": error.code, "error": error.localizedDescription,
    ])
  }

  private func save(_ value: [String: Any]) {
    try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
      .write(to: documents.appendingPathComponent("validation.json"), options: .atomic)
  }
}

final class FileCallerDelegate: UIResponder, UIApplicationDelegate {}

final class FileCallerScene: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  func scene(
    _ scene: UIScene, willConnectTo session: UISceneSession,
    options: UIScene.ConnectionOptions
  ) {
    guard let scene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: scene)
    window.rootViewController = FileCaller()
    window.makeKeyAndVisible()
    self.window = window
  }
}

UIApplicationMain(
  CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(FileCallerDelegate.self))
