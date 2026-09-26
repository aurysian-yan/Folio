import CoreText
import CryptoKit
import Darwin
import Foundation

struct FontSourceStatus: Sendable {
    let state: FontOperationState
    let isManagedCopy: Bool
    let canDeactivate: Bool
    let canUninstall: Bool
}

struct OnlineFontOrigin: Codable, Sendable {
    let provider: String
    let commit: String
    let family: String
    let style: String
    let gitOid: String
    let license: String
    let licenseText: String
    let sourceURL: String
    let downloadedVia: String
}

actor FontOperations {
    private struct ImportedFile: Codable {
        let path: String
        let mode: String
        let rootID: String?
    }

    private struct Installation: Codable {
        let sourcePath: String
        let installedPath: String
    }

    private struct Ledger: Codable {
        var imported: [ImportedFile] = []
        var installed: [Installation] = []
        var activated: [String] = []
    }

    private let repository: FolioRepository
    private let manager = FileManager.default
    private let managedDirectory: URL
    private let installedDirectory: URL
    private let ledgerURL: URL
    private let onlineOriginsURL: URL
    private let userFontsDirectory: URL
    private var ledger: Ledger

    init(repository: FolioRepository, supportDirectory: URL? = nil) throws {
        self.repository = repository
        let location: URL
        if let supportDirectory {
            location = supportDirectory
        } else {
            location = try FileManager.default.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            ).appendingPathComponent("Folio", isDirectory: true)
        }
        managedDirectory = location.appendingPathComponent("ManagedFonts", isDirectory: true)
        installedDirectory = location.appendingPathComponent("InstalledFonts", isDirectory: true)
        ledgerURL = location.appendingPathComponent("font-operations.json")
        onlineOriginsURL = managedDirectory.appendingPathComponent(".online-fonts.json")
        let accountHome = getpwuid(getuid()).map { String(cString: $0.pointee.pw_dir) }
            .map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? FileManager.default.homeDirectoryForCurrentUser
        userFontsDirectory = accountHome.appendingPathComponent("Library/Fonts", isDirectory: true)
        try FileManager.default.createDirectory(at: managedDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: installedDirectory, withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: ledgerURL.path) {
            ledger = try JSONDecoder().decode(Ledger.self, from: Data(contentsOf: ledgerURL))
        } else {
            ledger = Ledger()
        }
    }

    func importFiles(_ urls: [URL], mode: FontImportMode) async -> [FontOperationOutcome] {
        var outcomes: [FontOperationOutcome] = []
        for url in urls {
            do {
                let imported = try await importFile(url, mode: mode)
                outcomes.append(.init(name: url.lastPathComponent, error: nil, path: imported.path))
            } catch {
                outcomes.append(.init(name: url.lastPathComponent, error: error.localizedDescription, path: nil))
            }
        }
        return outcomes
    }

    func recordOnlineOrigin(path: String, origin: OnlineFontOrigin) throws {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard url.deletingLastPathComponent() == managedDirectory.standardizedFileURL,
              manager.fileExists(atPath: path) else {
            throw operationError("字体未收集到 Folio 字体库")
        }
        var origins: [String: OnlineFontOrigin] = [:]
        if manager.fileExists(atPath: onlineOriginsURL.path) {
            origins = try JSONDecoder().decode([String: OnlineFontOrigin].self,
                                               from: Data(contentsOf: onlineOriginsURL))
        }
        origins[url.lastPathComponent] = origin
        try JSONEncoder().encode(origins).write(to: onlineOriginsURL, options: .atomic)
    }

    func performBatch(_ action: FontAction, paths: [String]) async -> [FontOperationOutcome] {
        var outcomes: [FontOperationOutcome] = []
        var seen: Set<String> = []
        for path in paths where seen.insert(path).inserted {
            let name = URL(fileURLWithPath: path).lastPathComponent
            do {
                try await perform(action, path: path)
                outcomes.append(.init(name: name, error: nil, path: path))
            } catch {
                outcomes.append(.init(name: name, error: error.localizedDescription, path: path))
            }
        }
        return outcomes
    }

    func status(for path: String) -> FontSourceStatus {
        let url = URL(fileURLWithPath: path)
        let managed = ledger.imported.contains { $0.path == path && $0.mode == FontImportMode.copy.rawValue }
            && url.standardizedFileURL.deletingLastPathComponent() == managedDirectory.standardizedFileURL
        guard manager.fileExists(atPath: path) else {
            return .init(state: .unavailable, isManagedCopy: managed, canDeactivate: false, canUninstall: false)
        }
        if isSystemFont(path) {
            return .init(state: .system, isManagedCopy: false, canDeactivate: false, canUninstall: false)
        }
        let folioInstallation = ledger.installed.first { $0.sourcePath == path }.map {
            manager.fileExists(atPath: $0.installedPath)
                && CTFontManagerGetScopeForURL(URL(fileURLWithPath: $0.installedPath) as CFURL) == .persistent
        } ?? false
        let scope = CTFontManagerGetScopeForURL(url as CFURL)
        if folioInstallation || isUserInstalledFont(path) || scope == .persistent {
            return .init(state: .installed, isManagedCopy: managed, canDeactivate: false, canUninstall: folioInstallation)
        }
        if scope == .session {
            return .init(state: .active, isManagedCopy: managed,
                         canDeactivate: ledger.activated.contains(path), canUninstall: false)
        }
        return .init(state: managed ? .available : .external, isManagedCopy: managed,
                     canDeactivate: false, canUninstall: false)
    }

    func statuses(for paths: [String]) -> [String: FontSourceStatus] {
        Dictionary(uniqueKeysWithValues: Set(paths).map { ($0, status(for: $0)) })
    }

    func perform(_ action: FontAction, path: String) async throws {
        guard !isSystemFont(path) else { throw operationError("系统字体由 macOS 管理") }
        switch action {
        case .activate:
            try await activate(path)
        case .deactivate:
            try await deactivate(path)
        case .install:
            try await install(path)
        case .uninstall:
            try await uninstall(path)
        case .remove:
            try await removeManaged(path)
        }
    }

    private func importFile(_ selectedURL: URL, mode: FontImportMode) async throws -> URL {
        guard selectedURL.isFileURL else { throw operationError("只能导入本地字体文件") }
        let access = selectedURL.startAccessingSecurityScopedResource()
        defer { if access { selectedURL.stopAccessingSecurityScopedResource() } }
        let source = selectedURL.resolvingSymlinksInPath().standardizedFileURL
        guard ["ttf", "otf", "ttc", "otc"].contains(source.pathExtension.lowercased()) else {
            throw operationError("不支持此字体格式")
        }
        try await repository.validateFontFile(source)

        switch mode {
        case .copy:
            let destination = try copyFont(source, to: managedDirectory)
            if ledger.imported.contains(where: { $0.path == destination.path && $0.mode == mode.rawValue }) {
                return destination
            }
            try await repository.addLibraryRoot(managedDirectory)
            ledger.imported.append(.init(path: destination.path, mode: mode.rawValue, rootID: nil))
            try save()
            return destination
        case .reference:
            if ledger.imported.contains(where: { $0.path == source.path && $0.mode == mode.rawValue }) {
                return source
            }
            try BookmarkStore.shared.persistAccess(to: selectedURL)
            let rootID = try await repository.addFontFile(source)
            ledger.imported.append(.init(path: source.path, mode: mode.rawValue, rootID: rootID.rawValue))
            try save()
            return source
        }
    }

    private func activate(_ path: String) async throws {
        guard manager.fileExists(atPath: path) else { throw operationError("字体文件暂时不可用") }
        guard ledger.installed.allSatisfy({ $0.sourcePath != path }) else { return }
        let url = URL(fileURLWithPath: path)
        if ledger.activated.contains(path), CTFontManagerGetScopeForURL(url as CFURL) == .session {
            return
        }
        try await register(url, scope: .session)
        if !ledger.activated.contains(path) { ledger.activated.append(path) }
        try save()
    }

    private func deactivate(_ path: String) async throws {
        guard ledger.activated.contains(path) else { throw operationError("只能停用通过 Folio 挂载的字体") }
        let url = URL(fileURLWithPath: path)
        if CTFontManagerGetScopeForURL(url as CFURL) == .session {
            try await unregister(url, scope: .session)
        }
        ledger.activated.removeAll { $0 == path }
        try save()
    }

    private func install(_ path: String) async throws {
        guard manager.fileExists(atPath: path) else { throw operationError("字体文件暂时不可用") }
        if status(for: path).state == .installed { return }
        let source = URL(fileURLWithPath: path)
        let managed = ledger.imported.contains { $0.path == path && $0.mode == FontImportMode.copy.rawValue }
        let installation = managed ? source : try copyFont(source, to: installedDirectory)
        if ledger.installed.contains(where: { $0.installedPath == installation.path }),
           CTFontManagerGetScopeForURL(installation as CFURL) == .persistent {
            if ledger.activated.contains(path) { try await deactivate(path) }
            ledger.installed.append(.init(sourcePath: path, installedPath: installation.path))
            try save()
            return
        }
        let wasActive = ledger.activated.contains(path)
        if wasActive { try await deactivate(path) }
        do {
            try await register(installation, scope: .persistent)
        } catch {
            if wasActive { try? await activate(path) }
            if !managed, !ledger.installed.contains(where: { $0.installedPath == installation.path }) {
                try? manager.removeItem(at: installation)
            }
            throw error
        }
        ledger.installed.removeAll { $0.sourcePath == path }
        ledger.installed.append(.init(sourcePath: path, installedPath: installation.path))
        try save()
    }

    private func uninstall(_ path: String) async throws {
        guard let installation = ledger.installed.first(where: { $0.sourcePath == path }) else {
            throw operationError("只能卸载通过 Folio 安装的字体")
        }
        let url = URL(fileURLWithPath: installation.installedPath)
        let remaining = ledger.installed.filter { $0.sourcePath != path }
        let isShared = remaining.contains { $0.installedPath == installation.installedPath }
        if !isShared,
           manager.fileExists(atPath: url.path),
           CTFontManagerGetScopeForURL(url as CFURL) == .persistent {
            try await unregister(url, scope: .persistent)
        }
        if installation.installedPath != path,
           !isShared,
           manager.fileExists(atPath: installation.installedPath) {
            try manager.removeItem(at: url)
        }
        ledger.installed = remaining
        try save()
    }

    private func removeManaged(_ path: String) async throws {
        guard ledger.imported.contains(where: { $0.path == path && $0.mode == FontImportMode.copy.rawValue }),
              URL(fileURLWithPath: path).standardizedFileURL.deletingLastPathComponent() == managedDirectory.standardizedFileURL else {
            throw operationError("只能移除 Folio 管理的字体副本")
        }
        if ledger.installed.contains(where: { $0.sourcePath == path }) { try await uninstall(path) }
        if ledger.activated.contains(path) { try await deactivate(path) }
        try manager.trashItem(at: URL(fileURLWithPath: path), resultingItemURL: nil)
        ledger.imported.removeAll { $0.path == path && $0.mode == FontImportMode.copy.rawValue }
        try save()
        if manager.fileExists(atPath: onlineOriginsURL.path) {
            var origins = try JSONDecoder().decode([String: OnlineFontOrigin].self,
                                                   from: Data(contentsOf: onlineOriginsURL))
            origins.removeValue(forKey: URL(fileURLWithPath: path).lastPathComponent)
            try JSONEncoder().encode(origins).write(to: onlineOriginsURL, options: .atomic)
        }
    }

    func prepareSyncedRemoval(_ path: String) async throws {
        guard URL(fileURLWithPath: path).standardizedFileURL.deletingLastPathComponent()
                == managedDirectory.standardizedFileURL else {
            throw operationError("只能移除 Folio 管理的字体副本")
        }
        if ledger.installed.contains(where: { $0.sourcePath == path }) {
            try await uninstall(path)
        }
        if ledger.activated.contains(path) {
            try await deactivate(path)
        }
    }

    private func copyFont(_ source: URL, to directory: URL) throws -> URL {
        let digest = try fingerprint(source)
        let destination = directory.appendingPathComponent("\(digest).\(source.pathExtension.lowercased())")
        if !manager.fileExists(atPath: destination.path) {
            try manager.copyItem(at: source, to: destination)
        }
        return destination
    }

    private func fingerprint(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hash = SHA256()
        while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
            hash.update(data: chunk)
        }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func save() throws {
        try JSONEncoder().encode(ledger).write(to: ledgerURL, options: .atomic)
    }

    private func isSystemFont(_ path: String) -> Bool {
        let normalized = URL(fileURLWithPath: path).standardizedFileURL.path
        return normalized.hasPrefix("/System/Library/")
    }

    private func isUserInstalledFont(_ path: String) -> Bool {
        let normalized = URL(fileURLWithPath: path).standardizedFileURL.path
        return normalized.hasPrefix("/Library/Fonts/")
            || normalized.hasPrefix(userFontsDirectory.standardizedFileURL.path + "/")
    }

    private func register(_ url: URL, scope: CTFontManagerScope) async throws {
        try await registration(url, scope: scope, adding: true)
    }

    private func unregister(_ url: URL, scope: CTFontManagerScope) async throws {
        try await registration(url, scope: scope, adding: false)
    }

    private func registration(_ url: URL, scope: CTFontManagerScope, adding: Bool) async throws {
        let errors = RegistrationErrors()
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let handler: (CFArray, Bool) -> Bool = { failures, done in
                errors.append(failures)
                if done {
                    let messages = errors.messages()
                    if messages.isEmpty {
                        continuation.resume()
                    } else {
                        continuation.resume(throwing: operationError(messages.joined(separator: "；")))
                    }
                }
                return true
            }
            let urls = [url] as CFArray
            if adding {
                CTFontManagerRegisterFontURLs(urls, scope, true, handler)
            } else {
                CTFontManagerUnregisterFontURLs(urls, scope, handler)
            }
        }
    }
}

private final class RegistrationErrors: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String] = []

    func append(_ failures: CFArray) {
        let messages = (failures as NSArray).compactMap { ($0 as? NSError)?.localizedDescription }
        lock.lock()
        values.append(contentsOf: messages)
        lock.unlock()
    }

    func messages() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return values
    }
}

private func operationError(_ message: String) -> NSError {
    NSError(domain: "Folio.FontOperations", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}
