// 在线下载只通过现有字体导入服务写入字体库。
import FolioFileServices
import UIKit

enum FolioOnlineFiles {
  static func job(_ id: String) throws -> [String: Any] {
    let state = try FolioFileRuntime.shared().browser.state()
    guard let value = try JSONSerialization.jsonObject(with: Data(state.utf8)) as? [String: Any],
      let jobs = value["jobs"] as? [[String: Any]],
      let job = jobs.first(where: { $0["id"] as? String == id })
    else { throw FolioPaths.failure() }
    return job
  }
  private static func entries(_ id: String) throws -> [[String: Any]] {
    let runtime = try FolioFileRuntime.shared()
    let job = try job(id)
    guard job["state"] as? String == "ready" else { throw FolioPaths.failure() }
    if job["kind"] as? String == "font" {
      return [
        [
          "id": "font", "name": job["name"] ?? "", "path": try runtime.browser.downloadPath(id: id),
          "size": job["bytesDone"] ?? 0,
        ]
      ]
    }
    return
      (try JSONSerialization.jsonObject(with: Data(runtime.browser.archiveEntries(id: id).utf8)))
      as? [[String: Any]] ?? []
  }
  static func inspect(_ id: String) throws -> String {
    let engine = try FolioFileRuntime.shared().engine
    let values = try entries(id).map { entry -> [String: Any] in
      var result = [
        "id": entry["id"] ?? "", "name": entry["name"] ?? "", "size": entry["size"] ?? 0,
      ]
      do {
        guard let path = entry["path"] as? String,
          let analysis = try JSONSerialization.jsonObject(
            with: Data(engine.analyzeFontFile(path: path).utf8)) as? [String: Any]
        else { throw FolioPaths.failure() }
        let faces = analysis["faces"] as? [[String: Any]] ?? []
        result["previewPath"] = path
        result["analysis"] = analysis
        result["eligible"] = !faces.isEmpty
        result["duplicate"] =
          !faces.isEmpty && faces.allSatisfy { $0["duplicate"] as? Bool == true }
      } catch {
        result["eligible"] = false
        result["duplicate"] = false
      }
      return result
    }
    return String(decoding: try JSONSerialization.data(withJSONObject: values), as: UTF8.self)
  }
  static func collect(_ id: String, selection: [String]) throws -> [String: Any] {
    let runtime = try FolioFileRuntime.shared()
    guard try !runtime.sync.status().isRunning else { throw FolioPaths.failure() }
    let selected = try entries(id).filter { selection.contains($0["id"] as? String ?? "") }
    guard !selected.isEmpty, selected.count == Set(selection).count else {
      throw FolioPaths.failure()
    }
    let fingerprints = try selected.map { entry -> String in
      guard let path = entry["path"] as? String,
        let analysis = try JSONSerialization.jsonObject(
          with: Data(runtime.engine.analyzeFontFile(path: path).utf8)) as? [String: Any],
        let hash = analysis["fingerprint"] as? String
      else { throw FolioPaths.failure() }
      return hash
    }
    let files = try selected.map { entry -> SelectedImportFile in
      guard let path = entry["path"] as? String, let name = entry["name"] as? String else {
        throw FolioPaths.failure()
      }
      return SelectedImportFile(uri: URL(fileURLWithPath: path).absoluteString, name: name)
    }
    let report = try FolioFontImporter(engine: runtime.engine, root: runtime.root).importFiles(
      files)
    for (index, item) in report.items.enumerated()
    where ["imported", "duplicate"].contains(item.status) {
      try runtime.browser.recordOrigin(id: id, fingerprint: fingerprints[index])
    }
    if report.items.allSatisfy({ ["imported", "duplicate"].contains($0.status) }) {
      try runtime.browser.setDownloadState(
        id: id, state: "completed", errorKey: nil, generation: nil)
    }
    FolioFileUI.signalChanges()
    return [
      "snapshot": FolioLibraryMapper.snapshot(report.snapshot),
      "items": report.items.map(\.dictionary),
    ]
  }
  static func exportURL(_ id: String) throws -> URL {
    let runtime = try FolioFileRuntime.shared()
    let job = try job(id)
    guard job["state"] as? String == "ready", let name = job["name"] as? String else {
      throw FolioPaths.failure()
    }
    let source = URL(fileURLWithPath: try runtime.browser.downloadPath(id: id))
    let directory = source.deletingLastPathComponent().appendingPathComponent(
      "export", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let target = directory.appendingPathComponent(name)
    if FileManager.default.fileExists(atPath: target.path) {
      try FileManager.default.removeItem(at: target)
    }
    try FileManager.default.copyItem(at: source, to: target)
    return target
  }
}
