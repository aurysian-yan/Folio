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

            Image.englishSystemName("textformat.size")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            sizeSlider(width: 100)
            sizeValue

            Divider()
                .frame(height: 20)

            ColorPicker(L.text("libraryView.card"), selection: cardBackgroundColor, supportsOpacity: true)
                .fixedSize()
                .help(L.text("theme.cardBackground"))
            ColorPicker(L.text("common.text"), selection: $model.previewColor, supportsOpacity: true)
                .fixedSize()
                .help(L.text("theme.textColor"))
        }
        .frame(minWidth: 520)
    }

    private var compactControls: some View {
        HStack(spacing: 8) {
            previewModeMenu
            previewTextField(minWidth: 64)
            sizeSlider(width: 72)
            sizeValue
            compactColorPicker(
                L.text("theme.cardBackground"),
                systemImage: "rectangle.fill",
                selection: cardBackgroundColor
            )
            compactColorPicker(
                L.text("theme.textColor"),
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
                        Label {
                            Text(mode.title)
                        } icon: {
                            Image.englishSystemName("checkmark")
                        }
                    } else {
                        Text(mode.title)
                    }
                }
            }
        } label: {
            Image.englishSystemName("character.text.justify")
                .font(.system(size: 15, weight: .medium))
                .frame(width: 32, height: 28)
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .accessibilityLabel(L.text("preview.textType"))
        .help(L.text("desktop.selectPreviewTextType"))
    }

    private func previewTextField(minWidth: CGFloat) -> some View {
        TextField(L.text("preview.inputText"), text: previewText)
            .textFieldStyle(.roundedBorder)
            .frame(minWidth: minWidth, maxWidth: .infinity)
    }

    private func sizeSlider(width: CGFloat) -> some View {
        Slider(value: Binding(
            get: { model.previewSize },
            set: { model.updatePreviewSize($0) }
        ), in: 18...106) { editing in
            if editing {
                model.beginPreviewSizeEditing()
            } else {
                model.endPreviewSizeEditing()
            }
        }
            .frame(width: width)
            .accessibilityLabel(L.text("preview.size"))
            .sliderHaptics(value: model.previewSize, in: 18...106, feedbackStep: 1)
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
            Image.englishSystemName(systemImage)
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
