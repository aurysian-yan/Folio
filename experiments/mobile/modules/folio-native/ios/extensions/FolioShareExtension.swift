import FolioFileServices
// 分享扩展只保存待确认附件，不启动主应用或登记字体。
import UIKit
import UniformTypeIdentifiers

final class FolioShareExtension: UIViewController {
  private let queue = DispatchQueue(label: "com.folio.share", qos: .userInitiated)
  private var pending: URL?
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard pending == nil else { return }
    let items = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap {
      $0.attachments ?? []
    }
    guard !items.isEmpty, items.count <= 1_000 else {
      extensionContext?.cancelRequest(withError: FolioPaths.failure())
      return
    }
    do {
      let directory = try FolioPaths.inbox().appendingPathComponent(
        UUID().uuidString, isDirectory: true)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      pending = directory
      let group = DispatchGroup()
      let lock = NSLock()
      var names: [String] = []
      var failed = false
      for provider in items {
        group.enter()
        let identifier =
          provider.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .data) == true }
          ?? UTType.data.identifier
        provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, error in
          defer { group.leave() }
          do {
            guard let url, error == nil else { throw FolioPaths.failure() }
            let name = url.lastPathComponent
            guard ["ttf", "otf", "ttc", "otc", "zip"].contains(url.pathExtension.lowercased()),
              (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 256 * 1024 * 1024
            else { throw FolioPaths.failure() }
            let stored = UUID().uuidString + "-" + name
            try FileManager.default.copyItem(at: url, to: directory.appendingPathComponent(stored))
            lock.lock()
            names.append(stored)
            lock.unlock()
          } catch {
            lock.lock()
            failed = true
            lock.unlock()
          }
        }
      }
      group.notify(queue: .main) {
        guard !failed, !names.isEmpty else {
          try? FileManager.default.removeItem(at: directory)
          self.extensionContext?.cancelRequest(withError: FolioPaths.failure())
          return
        }
        let alert = UIAlertController(
          title: FolioFileText.text("workflow.pendingShare"),
          message: names.map { String($0.dropFirst(37)) }.joined(separator: "\n"),
          preferredStyle: .alert)
        alert.addAction(
          UIAlertAction(title: FolioFileText.text("common.cancel"), style: .cancel) { _ in
            try? FileManager.default.removeItem(at: directory)
            self.extensionContext?.cancelRequest(withError: CocoaError(.userCancelled))
          })
        alert.addAction(
          UIAlertAction(title: FolioFileText.text("common.save"), style: .default) { _ in
            do {
              try JSONSerialization.data(withJSONObject: ["names": names]).write(
                to: directory.appendingPathComponent("manifest.json"), options: .atomic)
              self.extensionContext?.completeRequest(returningItems: nil)
            } catch { self.extensionContext?.cancelRequest(withError: error) }
          })
        self.present(alert, animated: true)
      }
    } catch { extensionContext?.cancelRequest(withError: error) }
  }
}
