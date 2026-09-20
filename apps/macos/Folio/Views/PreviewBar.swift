import SwiftUI

struct PreviewBar: View {
    @Bindable var model: LibraryViewModel

    var body: some View {
        ViewThatFits(in: .horizontal) {
            fullControls
            compactControls
        }
        .controlSize(.small)
        .padding(.horizontal, 14)
        .frame(height: 52)
        .background(.bar)
    }

    private var fullControls: some View {
        HStack(spacing: 12) {
            previewModeMenu
            previewTextField(minWidth: 90)

            Image(systemName: "textformat.size")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            sizeSlider(width: 100)
            sizeValue

            Divider()
                .frame(height: 20)

            ColorPicker("卡片", selection: cardBackgroundColor, supportsOpacity: true)
                .fixedSize()
                .help("卡片背景色")
            ColorPicker("文字", selection: $model.previewColor, supportsOpacity: true)
                .fixedSize()
                .help("文字颜色")
        }
        .frame(minWidth: 620)
    }

    private var compactControls: some View {
        HStack(spacing: 8) {
            previewModeMenu
            previewTextField(minWidth: 64)
            sizeSlider(width: 72)
            sizeValue
            compactColorPicker(
                "卡片背景色",
                systemImage: "rectangle.fill",
                selection: cardBackgroundColor
            )
            compactColorPicker(
                "文字颜色",
                systemImage: "textformat",
                selection: $model.previewColor
            )
        }
        .frame(minWidth: 320)
    }

    private var previewModeMenu: some View {
        Menu {
            ForEach(PreviewTextMode.allCases) { mode in
                Button {
                    if let text = mode.text {
                        model.customPreviewText = text
                    }
                    model.previewMode = mode
                } label: {
                    if model.previewMode == mode {
                        Label(mode.title, systemImage: "checkmark")
                    } else {
                        Text(mode.title)
                    }
                }
            }
        } label: {
            Image(systemName: "character.text.justify")
                .font(.system(size: 15, weight: .medium))
                .frame(width: 32, height: 28)
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .accessibilityLabel("预览文字类型")
        .help("选择预览文字类型")
    }

    private func previewTextField(minWidth: CGFloat) -> some View {
        TextField("Preview Text", text: previewText)
            .textFieldStyle(.roundedBorder)
            .frame(minWidth: minWidth, maxWidth: .infinity)
    }

    private func sizeSlider(width: CGFloat) -> some View {
        Slider(value: $model.previewSize, in: 18...144, step: 1)
            .frame(width: width)
            .accessibilityLabel("预览字号")
            .sliderHaptics(value: model.previewSize, in: 18...144)
    }

    private var sizeValue: some View {
        HStack(spacing: 0) {
            if model.previewSize.rounded() < 100 {
                Text("0")
                    .foregroundStyle(.tertiary)
            }
            Text("\(Int(model.previewSize.rounded()))px")
        }
        .font(.system(size: 13, weight: .medium, design: .monospaced))
        .monospacedDigit()
        .contentTransition(.numericText(value: model.previewSize))
        .animation(.snappy(duration: 0.18), value: model.previewSize.rounded())
        .frame(width: 50, alignment: .trailing)
    }

    private func compactColorPicker(
        _ accessibilityLabel: String,
        systemImage: String,
        selection: Binding<Color>
    ) -> some View {
        ColorPicker(selection: selection, supportsOpacity: true) {
            Image(systemName: systemImage)
        }
        .fixedSize()
        .accessibilityLabel(accessibilityLabel)
        .help(accessibilityLabel)
    }

    private var cardBackgroundColor: Binding<Color> {
        Binding(
            get: { model.cardBackgroundColor ?? .clear },
            set: { model.cardBackgroundColor = $0 }
        )
    }

    private var previewText: Binding<String> {
        Binding(
            get: { model.customPreviewText },
            set: { value in
                model.customPreviewText = value
                model.previewMode = .custom
            }
        )
    }
}
