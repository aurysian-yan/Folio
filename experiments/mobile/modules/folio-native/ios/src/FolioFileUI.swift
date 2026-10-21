import FileProvider
import FolioFileServices
// 主应用的 Files 入口、导出及系统分享。
import UIKit
import UniformTypeIdentifiers

final class FolioFileUI: NSObject, UIDocumentPickerDelegate {
  private let presenter: UIViewController
  private let request: [String: Any]
  private var frozenSelection: [[String: Any]]?
  private let completion: (Result<String, Error>) -> Void
  private var runtime: FolioFileRuntime { get throws { try FolioFileRuntime.shared() } }
  private let cancellationLock = NSLock()
  private var cancellationRequested = false
  private var activeRead: FolioFileRead?
  private var cancelWait: (() -> Void)?
  private var cancelled: Bool {
    cancellationLock.lock()
    defer { cancellationLock.unlock() }
    return cancellationRequested
  }
  private var reading: FolioFileRead? {
    get {
      cancellationLock.lock()
      defer { cancellationLock.unlock() }
      return activeRead
    }
    set {
      cancellationLock.lock()
      activeRead = newValue
      let stopped = cancellationRequested
      cancellationLock.unlock()
      if stopped { newValue?.cancel() }
    }
  }
  func cancel() {
    cancellationLock.lock()
    cancellationRequested = true
    let read = activeRead
    cancellationLock.unlock()
    read?.cancel()
    cancelWait?()
    cancelWait = nil
    if presenter.presentedViewController is UIAlertController { presenter.dismiss(animated: true) }
  }
  init(
    presenter: UIViewController, request: [String: Any],
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    self.presenter = presenter
    self.request = request
    self.completion = completion
  }
  func launch() throws {
    let action = request["action"] as? String ?? ""
    if action == "refresh" {
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let runtime = try self.runtime
          try runtime.refreshReferences()
          _ = try runtime.engine.refreshLibrary()
          self.finish(.success("{}"))
        } catch { self.finish(.failure(error)) }
      }
      return
    }
    if action == "shareFiles" {
      prepareShare()
      return
    }
    if action == "collectInbox" {
      collectInbox()
      return
    }
    if action == "analyzeInbox" {
      collectInbox(analyzeOnly: true)
      return
    }
    let types: [UTType] =
      ["referenceFolder", "importFolder", "exportFiles"].contains(action) ? [.folder] : [.data]
    if action == "exportFiles" && frozenSelection == nil {
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          self.frozenSelection = try self.selected()
          DispatchQueue.main.async {
            do { try self.launch() } catch { self.finish(.failure(error)) }
          }
        } catch { self.finish(.failure(error)) }
      }
      return
    }
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
    picker.allowsMultipleSelection = action == "referenceFiles" || action == "importFiles"
    picker.delegate = self
    presenter.present(picker, animated: true)
  }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    completion(.success("{}"))
  }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL])
  {
    controller.dismiss(animated: true) {
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let runtime = try self.runtime
          switch self.request["action"] as? String {
          case "referenceFiles", "referenceFolder":
            for url in urls {
              try runtime.reference(
                url, name: url.lastPathComponent, replacing: self.request["sourceId"] as? String)
            }
            self.finish(.success("{\"changed\":true}"))
          case "importFiles", "importFolder":
            guard try !runtime.sync.status().isRunning else { throw FolioPaths.failure() }
            let importer = FolioFontImporter(engine: runtime.engine, root: runtime.root)
            var selected = urls
            let folder = (self.request["action"] as? String) == "importFolder" ? urls.first : nil
            let access = folder?.startAccessingSecurityScopedResource() ?? false
            defer { if access { folder?.stopAccessingSecurityScopedResource() } }
            if let folder {
              var failure: Error?
              guard
                let entries = FileManager.default.enumerator(
                  at: folder, includingPropertiesForKeys: [.isRegularFileKey],
                  options: [.skipsHiddenFiles, .skipsPackageDescendants],
                  errorHandler: { _, error in
                    failure = error
                    return false
                  })
              else { throw FolioPaths.failure() }
              let files = entries.allObjects as? [URL] ?? []
              if let failure { throw failure }
              guard files.count <= 10_000 else { throw FolioPaths.failure() }
              selected = try files.filter {
                try $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true
                  && ["ttf", "otf", "ttc", "otc", "zip"].contains($0.pathExtension.lowercased())
              }
            }
            _ = try importer.importFiles(
              selected.map {
                SelectedImportFile(uri: $0.absoluteString, name: $0.lastPathComponent)
              })
            self.finish(.success("{\"changed\":true}"))
          case "exportFiles":
            guard let directory = urls.first else { throw FolioPaths.failure() }
            try self.export(directory)
          default: throw FolioPaths.failure()
          }
        } catch { self.finish(.failure(error)) }
      }
    }
  }
  private func selected() throws -> [[String: Any]] {
    if let frozenSelection { return frozenSelection }
    let runtime = try runtime
    if let ids = request["ids"] as? [String] {
      return try ids.map { id in
        try JSONSerialization.jsonObject(with: Data(runtime.files.document(id: id).utf8))
          as! [String: Any]
      }
    }
    return try runtime.documents(request["parent"] as? String ?? "local").filter {
      $0["directory"] as? Bool != true
    }
  }
  private func prepareShare() {
    DispatchQueue.global(qos: .userInitiated).async {
      var directory: URL?
      do {
        let runtime = try self.runtime
        let temp = FileManager.default.temporaryDirectory.appendingPathComponent(
          UUID().uuidString, isDirectory: true)
        directory = temp
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
        var urls: [URL] = []
        for item in try self.selected() {
          let read = try runtime.files.read(id: item["id"] as! String)
          self.reading = read
          defer {
            self.reading = nil
            read.release()
          }
          let source = URL(fileURLWithPath: try read.open(password: runtime.password()))
          let name = (item["name"] as? String ?? source.lastPathComponent) as NSString
          var destination = temp.appendingPathComponent(name.lastPathComponent)
          if FileManager.default.fileExists(atPath: destination.path) {
            destination = temp.appendingPathComponent(UUID().uuidString).appendingPathComponent(
              name.lastPathComponent)
            try FileManager.default.createDirectory(
              at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
          }
          try FileManager.default.copyItem(at: source, to: destination)
          urls.append(destination)
        }
        guard !urls.isEmpty else { throw FolioPaths.failure() }
        DispatchQueue.main.async {
          let sheet = UIActivityViewController(activityItems: urls, applicationActivities: nil)
          sheet.popoverPresentationController?.sourceView = self.presenter.view
          sheet.popoverPresentationController?.sourceRect = self.presenter.view.bounds
          sheet.completionWithItemsHandler = { _, _, _, error in
            try? FileManager.default.removeItem(at: temp)
            self.finish(error.map(Result.failure) ?? .success("{}"))
          }
          self.presenter.present(sheet, animated: true)
        }
      } catch {
        if let directory { try? FileManager.default.removeItem(at: directory) }
        self.finish(.failure(error))
      }
    }
  }
  private func collectInbox(analyzeOnly: Bool = false) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        guard let id = self.request["inboxId"] as? String, UUID(uuidString: id) != nil else {
          throw FolioPaths.failure()
        }
        let directory = try FolioPaths.inbox().appendingPathComponent(id, isDirectory: true)
        let manifest =
          try JSONSerialization.jsonObject(
            with: Data(contentsOf: directory.appendingPathComponent("manifest.json")))
          as! [String: Any]
        let names = manifest["names"] as? [String] ?? []
        guard names.allSatisfy({ ($0 as NSString).lastPathComponent == $0 }) else {
          throw FolioPaths.failure()
        }
        let runtime = try self.runtime
        guard try !runtime.sync.status().isRunning else { throw FolioPaths.failure() }
        let importer = FolioFontImporter(engine: runtime.engine, root: runtime.root)
        let report = try importer.importFiles(
          names.map {
            SelectedImportFile(
              uri: directory.appendingPathComponent($0).absoluteString,
              name: String($0.dropFirst(37)))
          }, analyzeOnly: analyzeOnly)
        if analyzeOnly {
          self.finish(
            .success(
              String(
                decoding: try JSONSerialization.data(withJSONObject: [
                  "items": report.items.map { $0.dictionary }
                ]), as: UTF8.self)))
          return
        }
        let failed = names.filter { stored in
          let name = String(stored.dropFirst(37))
          return report.items.contains {
            ($0.archiveName == name || $0.name == name)
              && !["imported", "duplicate"].contains($0.status)
          }
        }
        if failed.isEmpty {
          try FileManager.default.removeItem(at: directory)
        } else {
          try JSONSerialization.data(withJSONObject: ["names": failed]).write(
            to: directory.appendingPathComponent("manifest.json"), options: .atomic)
        }
        self.finish(.success("{\"changed\":true}"))
      } catch { self.finish(.failure(error)) }
    }
  }
  private func export(_ directory: URL) throws {
    let runtime = try runtime
    let access = directory.startAccessingSecurityScopedResource()
    defer { if access { directory.stopAccessingSecurityScopedResource() } }
    let values = try selected()
    var batch: [String: Any] = ["id": UUID().uuidString, "cancelRequested": false]
    var items = values.map { item -> [String: Any] in
      [
        "id": UUID().uuidString, "source": item["id"]!, "name": item["name"]!, "action": "export",
        "stage": "export", "status": "pending", "fingerprint": item["fingerprint"]!,
        "destination": directory.absoluteString, "errorKey": NSNull(),
      ]
    }
    func save() throws {
      batch["items"] = items
      try runtime.files.saveBatch(
        value: String(decoding: JSONSerialization.data(withJSONObject: batch), as: UTF8.self))
    }
    let id = batch["id"] as! String
    try runtime.files.beginBatch(id: id)
    defer { runtime.files.endBatch(id: id) }
    try save()
    for index in items.indices {
      if cancelled {
        items[index]["status"] = "cancelled"
        continue
      }
      do {
        var name = items[index]["name"] as! String
        while FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path) {
          items[index]["status"] = "awaitingDecision"
          try save()
          guard let changed = conflict(name) else {
            items[index]["status"] = cancelled ? "cancelled" : "skipped"
            break
          }
          name = changed
        }
        if ["skipped", "cancelled"].contains(items[index]["status"] as? String ?? "") { continue }
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty, name != ".", name != "..",
          !name.contains("/"), !name.contains(":"),
          !name.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { throw FolioPaths.failure() }
        items[index]["status"] = "running"
        try save()
        let read = try runtime.files.read(id: items[index]["source"] as! String)
        reading = read
        defer {
          reading = nil
          read.release()
        }
        let source = URL(fileURLWithPath: try read.open(password: runtime.password()))
        let destination = directory.appendingPathComponent(name)
        var coordinationError: NSError?
        var copyError: Error?
        NSFileCoordinator().coordinate(
          writingItemAt: destination, options: [], error: &coordinationError
        ) { output in
          do { try FileManager.default.copyItem(at: source, to: output) } catch {
            copyError = error
          }
        }
        if let error = coordinationError ?? copyError as NSError? { throw error }
        items[index]["status"] = "succeeded"
        items[index]["destination"] = destination.absoluteString
      } catch {
        items[index]["status"] = cancelled ? "cancelled" : "failed"
        items[index]["errorKey"] = "workflow.error.operationFailed"
      }
      try save()
    }
    try save()
    finish(
      .success(String(decoding: try JSONSerialization.data(withJSONObject: batch), as: UTF8.self)))
  }
  private func conflict(_ name: String) -> String? {
    let signal = DispatchSemaphore(value: 0)
    var result: String?
    DispatchQueue.main.async {
      let alert = UIAlertController(
        title: FolioFileText.text("workflow.nameConflictTitle"), message: name,
        preferredStyle: .alert)
      alert.addTextField { $0.text = name }
      alert.addAction(
        UIAlertAction(title: FolioFileText.text("workflow.rename"), style: .default) { _ in
          result = alert.textFields?.first?.text
          signal.signal()
        })
      alert.addAction(
        UIAlertAction(title: FolioFileText.text("workflow.skip"), style: .default) { _ in
          signal.signal()
        })
      alert.addAction(
        UIAlertAction(title: FolioFileText.text("workflow.cancelRemaining"), style: .cancel) { _ in
          self.cancel()
          signal.signal()
        })
      self.cancelWait = { signal.signal() }
      if self.cancelled { signal.signal() } else { self.presenter.present(alert, animated: true) }
    }
    signal.wait()
    DispatchQueue.main.async { self.cancelWait = nil }
    return result
  }
  private func finish(_ result: Result<String, Error>) {
    DispatchQueue.main.async {
      Self.signalChanges()
      self.completion(result)
    }
  }
  static func signalChanges() {
    let domain = NSFileProviderDomain(
      identifier: NSFileProviderDomainIdentifier(FolioPaths.identity + ".library"),
      displayName: "Folio")
    NSFileProviderManager.add(domain) { error in
      guard error == nil || NSFileProviderManager(for:domain) != nil else {return}
      guard let manager=NSFileProviderManager(for:domain) else {return}
      DispatchQueue.global(qos:.utility).async {
        var identifiers=[NSFileProviderItemIdentifier.rootContainer,.workingSet]
        identifiers += ["local","favorites","collections","cloud"].map {NSFileProviderItemIdentifier($0)}
        if let collections=try? FolioFileRuntime.shared().documents("collections") {identifiers += collections.compactMap {$0["id"] as? String}.map {NSFileProviderItemIdentifier($0)}}
        for identifier in identifiers {manager.signalEnumerator(for:identifier,completionHandler:{_ in})}
      }
    }
  }
}
