import SwiftUI

/// 设置窗口的「关于」标签页。
///
/// 文字 logo 使用 `Assets.xcassets/BrandLogo`（`BrandLogo.imageset`），
/// 矢量路径为 Folio 字标，原始画布 1024×364。
struct AboutView: View {
    /// logo 显示宽度（pt），高度按原始比例自动计算。
    private static let logoWidth: CGFloat = 180
    /// logo 原始宽高比（1024 / 364）。
    private static let logoAspectRatio: CGFloat = 1024.0 / 364.0
    /// logo 颜色。单色字标用它着色。
    private static let logoColor: Color = .primary

    private var versionText: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        switch (version, build) {
        case let (version?, build?): return "版本 \(version)（\(build)）"
        case let (version?, nil): return "版本 \(version)"
        default: return "版本未知"
        }
    }

    var body: some View {
        VStack(spacing: 16) {
            logo
            Text(versionText)
                .font(.callout)
                .foregroundStyle(.secondary)
                .monospacedDigit()
            Text("跨设备字体资产管理工具")
                .font(.callout)
                .foregroundStyle(.secondary)
            Text("© 2026 Folio")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
    }

    private var logo: some View {
        Image("BrandLogo")
            .resizable()
            .renderingMode(.template)
            .scaledToFit()
            .frame(width: Self.logoWidth, height: Self.logoWidth / Self.logoAspectRatio)
            .foregroundStyle(Self.logoColor)
        // 如果换成彩色 logo：删除 `.renderingMode(.template)` 与 `.foregroundStyle(...)`，
        // 并把 imageset 的 `template-rendering-intent` 由 `template` 改为 `original`。
    }
}

#if DEBUG
#Preview {
    AboutView()
}
#endif
