import SwiftUI

struct SettingsView: View {
    @AppStorage(AppPreferences.selectCardsOnHover) private var selectCardsOnHover = true
    @AppStorage(AppPreferences.hoverSelectionHaptics) private var hoverSelectionHaptics = true
    @AppStorage(AppPreferences.sliderHaptics) private var sliderHaptics = true
    @AppStorage(AppPreferences.libraryViewMode) private var libraryViewMode =
        LibraryViewMode.compactGrid.rawValue
    @AppStorage(AppPreferences.previewSize) private var previewSize = 48.0
    @AppStorage(AppPreferences.expandedCardWidth) private var expandedCardWidth = 410.0

    var body: some View {
        Form {
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

                PreferenceSliderRow(
                    title: "大卡片尺寸",
                    value: $expandedCardWidth,
                    range: 320...560,
                    step: 10
                )
            }

            Section {
                Toggle("悬停时选中字体卡片", isOn: $selectCardsOnHover)
                Toggle("切换字体卡片时提供触觉反馈", isOn: $hoverSelectionHaptics)
                Toggle("拖动滑块时提供触觉反馈", isOn: $sliderHaptics)
            } header: {
                Text("字体卡片")
            } footer: {
                Text("触觉反馈仅适用于支持该功能的内建或外接妙控板。")
            }
        }
        .formStyle(.grouped)
        .frame(width: 480, height: 360)
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
