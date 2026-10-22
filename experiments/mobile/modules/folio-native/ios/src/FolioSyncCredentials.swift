import CryptoKit
import Foundation
import Security

// 密码仅保存在当前应用身份的设备钥匙串中。
public enum FolioSyncCredentials {
  private static func query(_ profile: SyncProfileDto) throws -> [String: Any] {
    let scope = try JSONSerialization.data(withJSONObject: [
      profile.serverUrl, profile.remoteDirectory, profile.username,
    ])
    let account = SHA256.hash(data: scope).map { String(format: "%02x", $0) }.joined()
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String:
        (Bundle.main.object(forInfoDictionaryKey: "FolioApplicationIdentifier") as? String ?? Bundle
        .main.bundleIdentifier ?? "com.folio.mobile.poc") + ".webdav",
      kSecAttrAccount as String: account,
    ]
    if let group = Bundle.main.object(forInfoDictionaryKey: "FolioKeychainGroup") as? String,
      !group.isEmpty
    {
      query[kSecAttrAccessGroup as String] = group
    }
    return query
  }

  public static func read(_ profile: SyncProfileDto) throws -> String? {
    var request = try query(profile)
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var value: CFTypeRef?
    var status = SecItemCopyMatching(request as CFDictionary, &value)
    if status == errSecItemNotFound, request[kSecAttrAccessGroup as String] != nil,
      Bundle.main.bundleIdentifier == Bundle.main.object(
        forInfoDictionaryKey: "FolioApplicationIdentifier") as? String
    {
      var legacy = request
      if let group = Bundle.main.object(forInfoDictionaryKey: "FolioLegacyKeychainGroup") as? String
      {
        legacy[kSecAttrAccessGroup as String] = group
      } else {
        legacy.removeValue(forKey: kSecAttrAccessGroup as String)
      }
      status = SecItemCopyMatching(legacy as CFDictionary, &value)
      if status == errSecSuccess, let data = value as? Data,
        let password = String(data: data, encoding: .utf8)
      {
        try write(password, profile: profile)
        var verified: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &verified) == errSecSuccess,
          (verified as? Data) == data
        else { throw failure() }
        if legacy[kSecAttrAccessGroup as String] != nil {
          legacy.removeValue(forKey: kSecReturnData as String)
          legacy.removeValue(forKey: kSecMatchLimit as String)
          let removed = SecItemDelete(legacy as CFDictionary)
          guard removed == errSecSuccess || removed == errSecItemNotFound else { throw failure() }
        }
      }
    }
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = value as? Data,
      let password = String(data: data, encoding: .utf8)
    else {
      throw failure()
    }
    return password
  }

  public static func write(_ password: String?, profile: SyncProfileDto) throws {
    let request = try query(profile)
    guard let password else {
      let status = SecItemDelete(request as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else { throw failure() }
      return
    }
    let attributes: [String: Any] = [
      kSecValueData as String: Data(password.utf8),
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let status = SecItemUpdate(request as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      var item = request
      attributes.forEach { item[$0.key] = $0.value }
      guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw failure() }
    } else if status != errSecSuccess {
      throw failure()
    }
  }

  private static func failure() -> NSError {
    NSError(
      domain: "FolioCredentials", code: 1,
      userInfo: [NSLocalizedDescriptionKey: "ERR_FOLIO_CREDENTIALS"])
  }
}
