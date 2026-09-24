import SwiftUI

struct SettingsView: View {
    @AppStorage(AppPreferences.selectCardsOnHover) private var selectCardsOnHover = true
    @AppStorage(AppPreferences.hoverSelectionHaptics) private var hoverSelectionHaptics = true
    @AppStorage(AppPreferences.sliderHaptics) private var sliderHaptics = true
    @AppStorage(AppPreferences.libraryViewMode) private var libraryViewMode =
        LibraryViewMode.compactGrid.rawValue
    @AppStorage(AppPreferences.previewSize) private var previewSize = 48.0
    @AppStorage(AppPreferences.expandedCardWheelSpeed) private var expandedCardWheelSpeed = 1.25
    @AppStorage(AppPreferences.askImportMode) private var askImportMode = false
    @AppStorage(AppPreferences.defaultImportMode) private var defaultImportMode = FontImportMode.copy.rawValue
    @AppStorage(AppPreferences.useCollectionThemeColor) private var useCollectionThemeColor = true
    @AppStorage(AppPreferences.defaultThemeColor) private var defaultThemeColor = DefaultThemeColor.folio.rawValue

    var body: some View {
        Form {
            Section("字体导入") {
                Toggle("每次询问导入方式", isOn: $askImportMode)
                Picker("默认导入方式", selection: $defaultImportMode) {
                    ForEach(FontImportMode.allCases) { mode in
                        Text(mode.title).tag(mode.rawValue)
                    }
                }
                .disabled(askImportMode)
            }

            Section("显示") {
                Picker("当前视图", selection: $libraryViewMode) {
                    ForEach(LibraryViewMode.allCases) { mode in
                        Text(mode.accessibilityTitle)
                            .tag(mode.rawValue)
                    }
                }

                PreferenceSliderRow(
                    title: "预览字号",
                    value: $previewSize,
                    range: 18...106,
                    step: 1
                )
            }

            Section("主题色") {
                Picker("默认主题色", selection: $defaultThemeColor) {
                    ForEach(DefaultThemeColor.allCases) { option in
                        Text(option.title).tag(option.rawValue)
                    }
                }
                Toggle("进入收藏夹时使用收藏夹颜色", isOn: $useCollectionThemeColor)
            }

            Section {
                Toggle("悬停时选中字体卡片", isOn: $selectCardsOnHover)
                Toggle("切换字体卡片时提供触觉反馈", isOn: $hoverSelectionHaptics)
                Toggle("拖动滑块时提供触觉反馈", isOn: $sliderHaptics)
                HStack {
                    Text("滚轮滚动速度")
                    Slider(
                        value: $expandedCardWheelSpeed,
                        in: 0.5...2.0,
                        step: 0.05
                    )
                    .accessibilityLabel("滚轮滚动速度")
                    Text("\(expandedCardWheelSpeed, specifier: "%.2f")×")
                        .font(.system(.body, design: .monospaced))
                        .monospacedDigit()
                        .frame(width: 54, alignment: .trailing)
                }
            } header: {
                Text("字体卡片")
            } footer: {
                Text("触觉反馈仅适用于支持该功能的内建或外接妙控板。")
            }
        }
        .formStyle(.grouped)
        .tint((DefaultThemeColor(rawValue: defaultThemeColor) ?? .folio).color)
        .accentColor((DefaultThemeColor(rawValue: defaultThemeColor) ?? .folio).color)
        .frame(width: 480, height: 480)
    }
}

private struct PreferenceSliderRow: View {
    let title: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double

    @State private var draftValue: Double
    @State private var isEditing = false

    init(
        title: String,
        value: Binding<Double>,
        range: ClosedRange<Double>,
        step: Double
    ) {
        self.title = title
        _value = value
        self.range = range
        self.step = step
        _draftValue = State(initialValue: value.wrappedValue)
    }

    var body: some View {
        HStack {
            Text(title)
            Slider(
                value: $draftValue,
                in: range,
                step: step,
                onEditingChanged: { editing in
                    isEditing = editing
                    if !editing {
                        value = draftValue
                    }
                }
            )
            .sliderHaptics(
                value: draftValue,
                in: range,
                feedbackStep: step
            )
            Text("\(Int(draftValue.rounded()))px")
                .font(.system(.body, design: .monospaced))
                .monospacedDigit()
                .frame(width: 54, alignment: .trailing)
        }
        .onChange(of: value) { _, newValue in
            guard !isEditing else { return }
            draftValue = newValue
        }
    }
}

#if DEBUG
#Preview {
    SettingsView()
}
#endif
