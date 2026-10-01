import Foundation

/// 本地化访问入口；键名与仓库根目录 `locales/` 中的共享字段一致。
/// 普通文案用 `text`，含 `{{占位符}}` 的文案用 `format`，复数字段用 `plural`。
enum L {
    /// 读取单条文案。
    static func text(_ key: String) -> String {
        NSLocalizedString(key, comment: "")
    }

    /// 读取带占位符的文案；参数以字符串传入，避免数字格式差异。
    static func format(_ key: String, _ arguments: CVarArg...) -> String {
        String(format: NSLocalizedString(key, comment: ""), arguments: arguments)
    }

    /// 读取复数字段，配合 `Localizable.stringsdict` 使用。
    static func plural(_ key: String, _ count: Int) -> String {
        String.localizedStringWithFormat(NSLocalizedString(key, comment: ""), count)
    }
}
