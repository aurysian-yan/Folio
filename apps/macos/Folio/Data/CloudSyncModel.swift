import Foundation
import Network
import Observation
import Security

@MainActor
@Observable
final class CloudSyncModel {
    static let shared = CloudSyncModel()

    private(set) var profile: SyncProfileDto?
    private(set) var status: SyncStatusDto?
    private(set) var fonts: [CloudFontDto] = []
    private(set) var conflicts: [SyncConflictDto] = []
    private(set) var connectionAlias: String?
    private(set) var libraryGeneration = 0
    var message: String?
    var errorMessage: String?

    private var engine: FolioSync?
    private var networkMonitor: NWPathMonitor?
    private var pollTask: Task<Void, Never>?
    private var automaticTask: Task<Void, Never>?
    private var pendingAutomaticSync = false
    private var pendingManualSync = false
    private var wasOffline = false
    private var cachedCredentialKey: String?
    private var cachedCredential: String?

    var isConnected: Bool { profile != nil }
    var isRunning: Bool { status?.isRunning == true }
    func syncItem(for fingerprint: String) -> SyncItemDto? {
        status?.items.first { $0.fingerprint == fingerprint }
    }
    var connectionName: String {
        if let connectionAlias, !connectionAlias.isEmpty { return connectionAlias }
        guard let profile, let host = URL(string: profile.serverUrl)?.host else { return "WebDAV" }
        return host.localizedCaseInsensitiveContains("123pan") ? "123PAN" : host
    }

    func renameConnection(_ name: String) {
        guard let profile else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        var names = UserDefaults.standard.dictionary(forKey: Self.connectionNamesKey) as? [String: String] ?? [:]
        let key = Self.connectionKey(for: profile)
        if trimmed.isEmpty {
            names.removeValue(forKey: key)
            connectionAlias = nil
        } else {
            names[key] = trimmed
            connectionAlias = trimmed
        }
        UserDefaults.standard.set(names, forKey: Self.connectionNamesKey)
    }

    func start() {
        guard engine == nil else { return }
        do {
            let support = try FileManager.default.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            ).appendingPathComponent("Folio", isDirectory: true)
            try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
            engine = try FolioSync.open(
                databasePath: support.appendingPathComponent("folio.sqlite").path,
                managedDirectory: support.appendingPathComponent("ManagedFonts", isDirectory: true).path
            )
            profile = try engine?.profile()
            loadConnectionAlias()
            reloadState()
            monitorNetwork()
            requestAutomaticSync()
        } catch {
            record(error)
        }
    }

    func testConnection(serverURL: String, directory: String, username: String, password: String) async -> Bool {
        let candidate = SyncProfileDto(
            serverUrl: serverURL.trimmingCharacters(in: .whitespacesAndNewlines),
            remoteDirectory: directory.trimmingCharacters(in: .whitespacesAndNewlines),
            username: username.trimmingCharacters(in: .whitespacesAndNewlines),
            automatic: true
        )
        let databasePath = enginePath
        let managedPath = managedDirectoryPath
        let candidatePassword = password.isEmpty ? credential(for: candidate) ?? "" : password
        do {
            try await Task.detached(priority: .userInitiated) {
                let tester = try FolioSync.open(databasePath: databasePath, managedDirectory: managedPath)
                try tester.testConnection(profile: candidate, password: candidatePassword)
            }.value
            cacheCredential(candidatePassword, for: candidate)
            errorMessage = nil
            message = "连接成功"
            return true
        } catch {
            record(error)
            return false
        }
    }

    func saveConnection(serverURL: String, directory: String, username: String, password: String, automatic: Bool) {
        guard let engine else { return }
        let next = SyncProfileDto(
            serverUrl: serverURL.trimmingCharacters(in: .whitespacesAndNewlines),
            remoteDirectory: directory.trimmingCharacters(in: .whitespacesAndNewlines),
            username: username.trimmingCharacters(in: .whitespacesAndNewlines),
            automatic: automatic
        )
        do {
            let savedPassword = password.isEmpty ? credential(for: next) : password
            guard let savedPassword, !savedPassword.isEmpty else {
                errorMessage = "请输入 WebDAV 密码"
                message = errorMessage
                return
            }
            try CloudCredentialStore.save(savedPassword, for: next)
            try engine.saveProfile(profile: next)
            cacheCredential(savedPassword, for: next)
            profile = next
            loadConnectionAlias()
            reloadState()
            errorMessage = nil
            message = "连接已保存"
            requestAutomaticSync()
        } catch {
            record(error)
        }
    }

    func setAutomatic(_ enabled: Bool) {
        guard let profile else { return }
        saveConnection(
            serverURL: profile.serverUrl,
            directory: profile.remoteDirectory,
            username: profile.username,
            password: "",
            automatic: enabled
        )
    }

    func disconnect() {
        guard let engine else { return }
        do {
            try engine.disconnect()
            profile = nil
            connectionAlias = nil
            cachedCredentialKey = nil
            cachedCredential = nil
            status = try engine.status()
            errorMessage = nil
            message = "已断开连接"
        } catch {
            record(error)
        }
    }

    func requestAutomaticSync() {
        guard profile?.automatic == true else { return }
        if isRunning { pendingAutomaticSync = true; return }
        automaticTask?.cancel()
        automaticTask = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            syncNow()
        }
    }

    func syncNow() {
        guard let engine, let profile else { return }
        if isRunning {
            pendingManualSync = true
            return
        }
        guard let password = credential(for: profile), !password.isEmpty else {
            errorMessage = "WebDAV 密码不可用，请在设置中重新保存"
            message = errorMessage
            return
        }
        do {
            if try engine.startSync(password: password) {
                errorMessage = nil
                status = try engine.status()
                pollTask?.cancel()
                pollTask = Task { await observeRun() }
            }
        } catch {
            record(error)
        }
    }

    func cancel() {
        engine?.cancel()
    }

    func restore(_ font: CloudFontDto) {
        guard let engine else { return }
        do {
            try engine.restoreCloudFont(fingerprint: font.fingerprint)
            syncNow()
        } catch {
            record(error)
        }
    }

    func restoreDeleted(_ font: CloudFontDto) {
        guard let engine else { return }
        do {
            try engine.restoreDeletedFont(fingerprint: font.fingerprint)
            reloadState()
            syncNow()
        } catch {
            record(error)
        }
    }

    func removeLocalCopy(_ font: CloudFontDto) {
        guard let engine else { return }
        do {
            try engine.setCloudOnly(fingerprint: font.fingerprint)
            reloadState()
            libraryGeneration += 1
        } catch {
            record(error)
        }
    }

    func markLocalRemoval(at path: String) {
        guard let engine else { return }
        do {
            if try engine.markCloudOnlyForPath(path: path) {
                reloadState()
            }
        } catch {
            record(error)
        }
    }

    func deleteEverywhere(_ font: CloudFontDto) {
        guard let engine else { return }
        do {
            try engine.deleteEverywhere(fingerprint: font.fingerprint)
            reloadState()
            syncNow()
        } catch {
            record(error)
        }
    }

    func resolve(_ conflict: SyncConflictDto, using resolution: SyncResolutionDto) {
        guard let engine else { return }
        do {
            try engine.resolveConflict(id: conflict.id, resolution: resolution)
            reloadState()
            syncNow()
        } catch {
            record(error)
        }
    }

    private func observeRun() async {
        while !Task.isCancelled {
            do { status = try engine?.status() }
            catch { record(error) }
            guard status?.isRunning == true else {
                reloadState()
                libraryGeneration += 1
                if pendingManualSync {
                    pendingManualSync = false
                    pendingAutomaticSync = false
                    syncNow()
                } else if pendingAutomaticSync {
                    pendingAutomaticSync = false
                    requestAutomaticSync()
                }
                return
            }
            try? await Task.sleep(for: .milliseconds(500))
        }
    }

    private func reloadState() {
        guard let engine else { return }
        do {
            status = try engine.status()
            fonts = try engine.cloudFonts()
            conflicts = try engine.conflicts()
        } catch {
            record(error)
        }
    }

    private static let connectionNamesKey = "Folio.CloudConnectionNames"

    private static func connectionKey(for profile: SyncProfileDto) -> String {
        "\(profile.serverUrl)|\(profile.remoteDirectory)|\(profile.username)"
    }

    private func loadConnectionAlias() {
        guard let profile else {
            connectionAlias = nil
            return
        }
        let names = UserDefaults.standard.dictionary(forKey: Self.connectionNamesKey) as? [String: String]
        connectionAlias = names?[Self.connectionKey(for: profile)]
    }

    private func monitorNetwork() {
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor [weak self] in
                guard let self else { return }
                if online && self.wasOffline { self.requestAutomaticSync() }
                self.wasOffline = !online
            }
        }
        monitor.start(queue: DispatchQueue(label: "Folio.WebDAV.Network"))
        networkMonitor = monitor
    }

    private var enginePath: String { libraryDirectory.appendingPathComponent("folio.sqlite").path }

    private func credential(for profile: SyncProfileDto) -> String? {
        let key = CloudCredentialStore.account(for: profile)
        if cachedCredentialKey == key { return cachedCredential }
        guard let password = CloudCredentialStore.load(for: profile), !password.isEmpty else { return nil }
        cacheCredential(password, for: profile)
        return password
    }

    private func cacheCredential(_ password: String, for profile: SyncProfileDto) {
        cachedCredentialKey = CloudCredentialStore.account(for: profile)
        cachedCredential = password
    }

    private func record(_ error: Error) {
        errorMessage = error.localizedDescription
        message = errorMessage
    }
    private var managedDirectoryPath: String { libraryDirectory.appendingPathComponent("ManagedFonts").path }
    private var libraryDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Folio", isDirectory: true)
    }
}

private enum CloudCredentialStore {
    private static let service = "Folio.WebDAV"

    static func load(for profile: SyncProfileDto) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account(for: profile),
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ password: String, for profile: SyncProfileDto) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account(for: profile),
        ]
        let value = Data(password.utf8)
        let updated = SecItemUpdate(
            query as CFDictionary,
            [kSecValueData as String: value] as CFDictionary
        )
        if updated == errSecSuccess { return }
        guard updated == errSecItemNotFound else { throw CloudCredentialError.keychain(updated) }
        var attributes = query
        attributes[kSecValueData as String] = value
        let code = SecItemAdd(attributes as CFDictionary, nil)
        guard code == errSecSuccess else { throw CloudCredentialError.keychain(code) }
    }

    static func account(for profile: SyncProfileDto) -> String {
        "\(profile.serverUrl)|\(profile.remoteDirectory)|\(profile.username)"
    }
}

private enum CloudCredentialError: LocalizedError {
    case keychain(OSStatus)

    var errorDescription: String? {
        "无法保存 WebDAV 密码到钥匙串"
    }
}
