import SwiftUI

struct SettingsView: View {
    @AppStorage(AppPreferences.selectCardsOnHover) private var selectCardsOnHover = true
    @AppStorage(AppPreferences.hoverSelectionHaptics) private var hoverSelectionHaptics = true
    @AppStorage(AppPreferences.sliderHaptics) private var sliderHaptics = true

    var body: some View {
        Form {
            Section {
                Toggle("悬停时选中字体卡片", isOn: $selectCardsOnHover)
                Toggle("切换字体卡片时提供触觉反馈", isOn: $hoverSelectionHaptics)
                    .disabled(!selectCardsOnHover)
                Toggle("拖动滑块时提供触觉反馈", isOn: $sliderHaptics)
            } header: {
                Text("字体卡片")
            } footer: {
                Text("触觉反馈仅适用于支持该功能的内建或外接妙控板。")
            }
        }
        .formStyle(.grouped)
        .frame(width: 480, height: 210)
    }
}

#if DEBUG
#Preview {
    SettingsView()
}
#endif
