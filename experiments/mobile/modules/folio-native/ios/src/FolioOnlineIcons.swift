// 图标读取使用隔离的 DOM 查询，文件解码与缓存交给共享服务。
import FolioFileServices
import Foundation

enum FolioOnlineIcons {
  static let discoveryScript =
    #"(() => Array.from(document.querySelectorAll('link[rel]')).filter(el => /(^|\s)(icon|apple-touch-icon)(\s|$)/i.test(el.rel)).filter(el => !el.media || matchMedia(el.media).matches).map(el => el.href).filter(value => value.startsWith('https://')).slice(0, 4))()"#
  private static let queue: OperationQueue = {
    let value = OperationQueue()
    value.name = "com.folio.online.icons"
    value.maxConcurrentOperationCount = 2
    value.qualityOfService = .utility
    return value
  }()

  static func capture(providerID: String, pageURL: String, candidates: [String]) {
    queue.addOperation {
      _ = try? FolioFileRuntime.shared().browser.refreshIcon(
        providerId: providerID, pageUrl: pageURL, candidates: Array(candidates.prefix(4)))
    }
  }

  static func importFile(_ uri: String) throws -> String {
    guard let source = URL(string: uri), source.isFileURL else { throw invalidIcon() }
    let access = source.startAccessingSecurityScopedResource()
    defer { if access { source.stopAccessingSecurityScopedResource() } }
    let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: temporary) }
    let input = try FileHandle(forReadingFrom: source)
    defer { try? input.close() }
    FileManager.default.createFile(atPath: temporary.path, contents: nil)
    let output = try FileHandle(forWritingTo: temporary)
    defer { try? output.close() }
    var total = 0
    while let bytes = try input.read(upToCount: 65536), !bytes.isEmpty {
      total += bytes.count
      guard total <= 8 * 1024 * 1024 else { throw invalidIcon() }
      try output.write(contentsOf: bytes)
    }
    try output.synchronize()
    return try FolioFileRuntime.shared().browser.importIcon(path: temporary.path)
  }

  private static func invalidIcon() -> NSError {
    NSError(
      domain: "FolioOnline", code: 1,
      userInfo: [NSLocalizedDescriptionKey: "online.browser.invalidIcon"])
  }
}
