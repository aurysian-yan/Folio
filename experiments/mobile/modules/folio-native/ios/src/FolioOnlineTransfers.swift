// 系统后台会话独立于网页与 React，文件落盘后进入共享校验。
import ExpoModulesCore
import FolioFileServices
import Security
import UIKit

final class FolioOnlineTransfers: NSObject, URLSessionDownloadDelegate {
  static let shared = FolioOnlineTransfers()
  static var identifier: String {
    (Bundle.main.bundleIdentifier ?? "com.folio.mobile") + ".online-transfers"
  }
  private let lock = NSRecursiveLock()
  private var intents: [String: (URLRequest, String, [String: Any])] = [:]
  private var lastProgress: [Int: Date] = [:]
  private var completion: (() -> Void)?
  private lazy var session: URLSession = {
    let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
    config.sessionSendsLaunchEvents = true
    config.isDiscretionary = false
    config.httpMaximumConnectionsPerHost = 2
    config.httpCookieStorage = .shared
    config.timeoutIntervalForResource = 24 * 60 * 60
    return URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }()
  private var browser: FolioBrowser { get throws { try FolioFileRuntime.shared().browser } }

  func restore(completion: (() -> Void)? = nil) {
    lock.lock()
    self.completion = completion ?? self.completion
    lock.unlock()
    session.getAllTasks { tasks in
      for task in tasks {
        guard let (id, generation) = self.identity(task), let job = try? FolioOnlineFiles.job(id),
          (job["generation"] as? NSNumber)?.uint64Value == generation,
          ["queued", "transferring"].contains(job["state"] as? String ?? "")
        else {
          task.cancel()
          continue
        }
        if task.state == .suspended { task.resume() }
      }
    }
  }
  func intent(request: URLRequest, name: String, origin: [String: Any]) -> String {
    lock.lock()
    defer { lock.unlock() }
    if intents.count >= 20 { intents.removeAll() }
    let id = UUID().uuidString
    intents[id] = (request, name, origin)
    return id
  }
  func start(_ intentID: String) throws -> String {
    lock.lock()
    defer { lock.unlock() }
    guard let (request, name, origin) = intents.removeValue(forKey: intentID), let url = request.url
    else { throw failure("online.browser.expiredLink") }
    let payload = String(
      decoding: try JSONSerialization.data(withJSONObject: origin), as: UTF8.self)
    let value = try browser.createDownload(url: url.absoluteString, name: name, origin: payload)
    guard let job = try JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any],
      let id = job["id"] as? String
    else { throw FolioPaths.failure() }
    do {
      try saveRequest(id, url: url.absoluteString, resumeData: nil)
      let task = session.downloadTask(with: request)
      task.taskDescription = "\(id)|0"
      task.resume()
    } catch {
      try? browser.setDownloadState(
        id: id, state: "failed", errorKey: "online.browser.scheduleError", generation: 0)
      throw error
    }
    return id
  }
  func retry(_ id: String) throws {
    lock.lock()
    defer { lock.unlock() }
    guard let saved = try readRequest(id), let value = saved["url"] as? String,
      let url = URL(string: value)
    else { throw failure("online.browser.expiredLink") }
    _ = try browser.validateAddress(url: value)
    try browser.setDownloadState(id: id, state: "queued", errorKey: nil, generation: nil)
    let job = try FolioOnlineFiles.job(id)
    let generation = (job["generation"] as? NSNumber)?.uint64Value ?? 0
    let task: URLSessionDownloadTask
    if let encoded = saved["resumeData"] as? String, let data = Data(base64Encoded: encoded) {
      task = session.downloadTask(withResumeData: data)
    } else {
      task = session.downloadTask(with: url)
    }
    task.taskDescription = "\(id)|\(generation)"
    task.resume()
  }
  func pause(_ id: String) throws {
    lock.lock()
    defer { lock.unlock() }
    let job = try FolioOnlineFiles.job(id)
    let generation = (job["generation"] as? NSNumber)?.uint64Value ?? 0
    try browser.setDownloadState(id: id, state: "paused", errorKey: nil, generation: generation)
    session.getAllTasks { tasks in
      for task in tasks {
        guard let identity = self.identity(task), identity.0 == id, identity.1 == generation,
          let download = task as? URLSessionDownloadTask
        else { continue }
        download.cancel { data in
          self.lock.lock()
          defer { self.lock.unlock() }
          guard let job = try? FolioOnlineFiles.job(id), job["state"] as? String == "paused",
            (job["generation"] as? NSNumber)?.uint64Value == generation,
            let saved = try? self.readRequest(id), let url = saved["url"] as? String
          else { return }
          try? self.saveRequest(id, url: url, resumeData: data)
        }
      }
    }
  }
  func cancel(_ id: String) throws {
    lock.lock()
    defer { lock.unlock() }
    try browser.cancelDownload(id: id)
    session.getAllTasks { tasks in
      tasks.filter { self.identity($0)?.0 == id }.forEach { $0.cancel() }
    }
    try secret(id, value: nil)
  }
  private func identity(_ task: URLSessionTask) -> (String, UInt64)? {
    guard let value = task.taskDescription else { return nil }
    let parts = value.split(separator: "|", omittingEmptySubsequences: false)
    guard parts.count == 2, let generation = UInt64(parts[1]) else { return nil }
    return (String(parts[0]), generation)
  }
  private func query(_ id: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.identifier,
      kSecAttrAccount as String: id,
    ]
  }
  private func saveRequest(_ id: String, url: String, resumeData: Data?) throws {
    var value = ["url": url]
    if let resumeData, resumeData.count <= 1024 * 1024 {
      value["resumeData"] = resumeData.base64EncodedString()
    }
    try secret(
      id, value: String(decoding: JSONSerialization.data(withJSONObject: value), as: UTF8.self))
  }
  private func secret(_ id: String, value: String?) throws {
    let query = query(id)
    guard let value else {
      SecItemDelete(query as CFDictionary)
      return
    }
    let values: [String: Any] = [
      kSecValueData as String: Data(value.utf8),
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    var status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
    if status == errSecItemNotFound {
      status = SecItemAdd(query.merging(values) { _, value in value } as CFDictionary, nil)
    }
    guard status == errSecSuccess else { throw failure("online.browser.storageError") }
  }
  private func readRequest(_ id: String) throws -> [String: Any]? {
    var query = query(id)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var value: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &value)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = value as? Data else {
      throw failure("online.browser.storageError")
    }
    return try JSONSerialization.jsonObject(with: data) as? [String: Any]
  }
  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
  ) {
    lock.lock()
    defer { lock.unlock() }
    guard let (id, generation) = identity(downloadTask) else {
      downloadTask.cancel()
      return
    }
    if totalBytesWritten > 2 * 1024 * 1024 * 1024
      || totalBytesExpectedToWrite > 2 * 1024 * 1024 * 1024
    {
      try? browser.setDownloadState(
        id: id, state: "failed", errorKey: "online.browser.invalidDownload", generation: generation)
      downloadTask.cancel()
      return
    }
    if let last = lastProgress[downloadTask.taskIdentifier], Date().timeIntervalSince(last) < 0.5 {
      return
    }
    lastProgress[downloadTask.taskIdentifier] = Date()
    do {
      try browser.progress(
        id: id, done: UInt64(max(0, totalBytesWritten)),
        total: totalBytesExpectedToWrite > 0 ? UInt64(totalBytesExpectedToWrite) : nil,
        generation: generation)
    } catch { downloadTask.cancel() }
  }
  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    lock.lock()
    defer { lock.unlock() }
    guard let (id, generation) = identity(downloadTask), let job = try? FolioOnlineFiles.job(id),
      (job["generation"] as? NSNumber)?.uint64Value == generation,
      ["queued", "transferring"].contains(job["state"] as? String ?? "")
    else { return }
    do {
      guard let response = downloadTask.response as? HTTPURLResponse,
        (200...299).contains(response.statusCode), let url = response.url
      else { throw failure("online.browser.expiredLink") }
      _ = try browser.validateAddress(url: url.absoluteString)
      let target = URL(fileURLWithPath: try browser.downloadPath(id: id))
      if FileManager.default.fileExists(atPath: target.path) {
        try FileManager.default.removeItem(at: target)
      }
      try FileManager.default.moveItem(at: location, to: target)
      try browser.finishDownload(id: id, generation: generation)
      try secret(id, value: nil)
    } catch {
      let key =
        (error as NSError).localizedDescription.contains("expiredLink")
        ? "online.browser.expiredLink" : "online.browser.invalidDownload"
      try? browser.setDownloadState(
        id: id, state: key.hasSuffix("expiredLink") ? "needsUser" : "failed", errorKey: key,
        generation: generation)
    }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    lock.lock()
    defer { lock.unlock() }
    lastProgress.removeValue(forKey: task.taskIdentifier)
    guard let error, let (id, generation) = identity(task),
      (error as NSError).code != NSURLErrorCancelled
    else { return }
    do {
      try browser.setDownloadState(
        id: id, state: "failed", errorKey: "online.browser.networkError", generation: generation)
      if let saved = try readRequest(id), let url = saved["url"] as? String {
        try saveRequest(
          id, url: url,
          resumeData: (error as NSError).userInfo[NSURLSessionDownloadTaskResumeData] as? Data)
      }
    } catch {}
  }
  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    lock.lock()
    let completion = self.completion
    self.completion = nil
    lock.unlock()
    DispatchQueue.main.async { completion?() }
  }
  private func failure(_ key: String) -> NSError {
    NSError(domain: "FolioOnline", code: 1, userInfo: [NSLocalizedDescriptionKey: key])
  }
}

public final class FolioOnlineAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    FolioOnlineTransfers.shared.restore()
    return true
  }
  public func application(
    _ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    guard identifier == FolioOnlineTransfers.identifier else {
      completionHandler()
      return
    }
    FolioOnlineTransfers.shared.restore(completion: completionHandler)
  }
}
