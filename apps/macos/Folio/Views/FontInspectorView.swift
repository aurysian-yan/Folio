import SwiftUI

struct FontInspectorView: View {
    @Bindable var model: LibraryViewModel

    @State private var previewExpanded = true
    @State private var axesExpanded = true
    @State private var copyExpanded = true
    @State private var informationExpanded = true
    @State private var deleteConfirmationPresented = false

    var body: some View {
        Group {
            if let family = model.selectedFamily, let face = model.selectedFace {
                inspector(family, face: face)
            } else {
                ContentUnavailableView {
                    Label {
                        Text("选择字体")
                    } icon: {
                        Image.englishSystemName("character.cursor.ibeam")
                    }
                } description: {
                    Text("选择一个字族以查看详细信息")
                }
            }
        }
        .alert("将字体移到废纸篓？", isPresented: $deleteConfirmationPresented) {
            Button("取消", role: .cancel) {}
            Button("移到废纸篓", role: .destructive, action: model.trashSelectedFace)
        } message: {
            Text("字体文件会从字体库中移除，可在废纸篓中恢复。")
        }
    }

    private func inspector(_ family: FamilyCard, face: FaceSummary) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                header(family, face: face)

                VStack(alignment: .leading, spacing: 0) {
                    disclosureHeader("预览", isExpanded: $previewExpanded)
                    if previewExpanded {
                        preview(face)
                    }
                }

                inspectorDivider

                if !visibleAxes(face).isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        disclosureHeader("可变轴", isExpanded: $axesExpanded)
                        if axesExpanded {
                            axes(face)
                        }
                    }
                    inspectorDivider
                }

                VStack(alignment: .leading, spacing: 0) {
                    disclosureHeader("复制为", isExpanded: $copyExpanded)
                    if copyExpanded {
                        copySection(family, face: face)
                    }
                }

                inspectorDivider

                VStack(alignment: .leading, spacing: 10) {
                    disclosureHeader("字体信息", isExpanded: $informationExpanded)
                    if informationExpanded {
                        information(face)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 10)
        }
        .scrollIndicators(.visible)
    }

    private func header(_ family: FamilyCard, face: FaceSummary) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                Text(family.displayName)
                    .font(.system(size: 22, weight: .semibold))
                    .fontWidth(.condensed)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)

                HStack(spacing: 8) {
                    HStack(spacing: 5) {
                        Text(formattedVersion(face.version))
                        Text("|")
                            .foregroundStyle(.tertiary)
                        Text(formattedFileSize(face.fileSize))
                    }
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .padding(.horizontal, 4)

                    Spacer(minLength: 0)

                    faceNavigator(family, face: face)
                }
                .frame(height: 16)
            }

            HStack(spacing: 8) {
                inspectorButton(
                    "在 Finder 中查看",
                    systemImage: "finder",
                    action: model.revealSelectedFace
                )
                .disabled(model.selectedSource == nil)

                if let source = model.selectedSource,
                   model.availableActions(for: source).contains(.remove) {
                    Button {
                        deleteConfirmationPresented = true
                    } label: {
                        Image.englishSystemName("trash")
                            .font(.system(size: 12, weight: .semibold))
                            .frame(width: 34, height: 34)
                    }
                    .buttonStyle(InspectorButtonStyle(cornerRadius: 17, destructive: true))
                    .accessibilityLabel("移除字体")
                }
            }

            if face.sources.count > 1 {
                Picker("字体文件", selection: $model.selectedSourcePath) {
                    Text("选择字体文件").tag(String?.none)
                    ForEach(face.sources) { source in
                        Text(source.path).tag(Optional(source.path))
                    }
                }
            }

            if let source = model.selectedSource {
                Text(sourceStatus(model.status(for: source).state))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack {
                    ForEach(model.availableActions(for: source).filter { $0 != .remove }, id: \.rawValue) { action in
                        Button(action.title) { model.perform(action, on: source) }
                    }
                }
            }
        }
    }

    private func sourceStatus(_ state: FontOperationState) -> String {
        switch state {
        case .available: "仅在字体库"
        case .active: "当前会话已激活"
        case .installed: "已安装"
        case .external: "外部文件"
        case .system: "系统字体"
        case .unavailable: "文件暂时不可用"
        }
    }

    private func faceNavigator(_ family: FamilyCard, face: FaceSummary) -> some View {
        HStack(spacing: 0) {
            Button {
                model.moveFace(in: family, offset: -1)
            } label: {
                Image.englishSystemName("chevron.left")
                    .frame(width: 16, height: 16)
            }
            .accessibilityLabel("上一个字款")

            Text(face.styleName)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(maxWidth: .infinity)

            Button {
                model.moveFace(in: family, offset: 1)
            } label: {
                Image.englishSystemName("chevron.right")
                    .frame(width: 16, height: 16)
            }
            .accessibilityLabel("下一个字款")
        }
        .font(.system(size: 10, weight: .medium))
        .foregroundStyle(.secondary)
        .buttonStyle(.plain)
        .frame(width: 82, height: 16)
        .padding(.horizontal, 4)
    }

    private func preview(_ face: FaceSummary) -> some View {
        FontPreviewView(
            text: "ABCDEFGHIJKLMNOPQRSTUVWXY\nabcdefghijklmnopqrstuvwxyz\n0123456789",
            face: face,
            size: 16,
            color: .primary,
            axes: model.axisValues,
            alignment: .left,
            lineLimit: 4,
            lineHeight: 22
        )
        .frame(maxWidth: .infinity)
        .frame(minHeight: 66)
        .padding(.horizontal, 4)
    }

    private func axes(_ face: FaceSummary) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(visibleAxes(face)) { axis in
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 8) {
                        Text(axis.name)
                            .font(.system(size: 14, weight: .medium, design: .monospaced))
                            .tracking(-0.7)
                        Spacer(minLength: 0)
                        Text(axisValue(axis))
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .tracking(-0.6)
                            .foregroundStyle(.secondary)
                    }
                    .frame(height: 20)
                    .padding(.horizontal, 4)

                    Slider(
                        value: Binding(
                            get: { model.axisValues[axis.tag, default: axis.defaultValue] },
                            set: { model.axisValues[axis.tag] = $0 }
                        ),
                        in: axis.minimum...axis.maximum
                    )
                    .controlSize(.small)
                    .frame(height: 32)
                    .padding(.horizontal, 6)
                    .accessibilityLabel(axis.name)
                    .accessibilityValue(axisValue(axis))
                    .sliderHaptics(
                        value: model.axisValues[axis.tag, default: axis.defaultValue],
                        in: axis.minimum...axis.maximum
                    )

                    HStack {
                        Text(axis.minimum.formatted(.number.precision(.fractionLength(0...2))))
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text(axis.maximum.formatted(.number.precision(.fractionLength(0...2))))
                            .foregroundStyle(.tertiary)
                    }
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .frame(height: 15)
                    .padding(.horizontal, 4)
                }
            }
        }
    }

    private func copySection(_ family: FamilyCard, face: FaceSummary) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(spacing: 4) {
                inspectorButton("CSS", systemImage: "apple.terminal") {
                    model.copy("font-family: \"\(family.displayName)\";")
                }
                inspectorButton("CSS font-face", systemImage: "at") {
                    model.copy(cssFontFace(family, face: face))
                }
                inspectorButton("SwiftUI", systemImage: "swift") {
                    model.copy(swiftUIFont(family, face: face))
                }
                inspectorButton("Figma", systemImage: "f.circle") {
                    model.copyForFigma(family, face: face)
                }
                inspectorButton("Sketch", systemImage: "s.circle") {
                    model.copyForSketch(family, face: face)
                }
            }
            .padding(.bottom, 10)

            VStack(spacing: 4) {
                inspectorButton("字族名", systemImage: "doc.on.doc") {
                    model.copy(family.displayName)
                }
                inspectorButton("PostScript 名", systemImage: "doc.on.doc") {
                    model.copy(face.postScriptName)
                }
                .disabled(face.postScriptName == nil)
            }
        }
    }

    private func information(_ face: FaceSummary) -> some View {
        VStack(spacing: 4) {
            informationRow("设计师", value: face.designer ?? "—")
            informationRow("厂牌", value: face.manufacturer ?? "—")
            informationRow("格式", value: formattedFontFormat(face.format))
            informationRow("字符数", value: formattedGlyphCount(face))
            informationRow("文件体积", value: formattedFileSize(face.fileSize))
            informationRow("版权", value: face.copyright ?? "—")
        }
        .padding(.horizontal, 4)
    }

    private func informationRow(_ label: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 0) {
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 79, alignment: .leading)

            Text(value)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .lineLimit(nil)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func disclosureHeader(_ title: String, isExpanded: Binding<Bool>) -> some View {
        Button {
            isExpanded.wrappedValue.toggle()
        } label: {
            HStack(spacing: 8) {
                Text(title)
                    .font(.system(size: 12, weight: .medium))
                Spacer(minLength: 0)
                Image.englishSystemName("chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .rotationEffect(isExpanded.wrappedValue ? .zero : .degrees(-90))
                    .foregroundStyle(.tertiary)
            }
            .frame(height: 26)
            .padding(.horizontal, 4)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityValue(isExpanded.wrappedValue ? "已展开" : "已折叠")
    }

    private func inspectorButton(
        _ title: String,
        systemImage: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image.englishSystemName(systemImage)
                    .font(.system(size: 12, weight: .semibold))
                    .frame(width: 14)
                Text(title)
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: 34, maxHeight: 34)
            .contentShape(.rect)
        }
        .buttonStyle(InspectorButtonStyle())
    }

    private var inspectorDivider: some View {
        Divider()
            .padding(.vertical, 8.5)
    }

    private func visibleAxes(_ face: FaceSummary) -> [VariableAxisModel] {
        face.axes.filter { !$0.hidden }
    }

    private func axisValue(_ axis: VariableAxisModel) -> String {
        model.axisValues[axis.tag, default: axis.defaultValue]
            .formatted(.number.precision(.fractionLength(0...2)))
    }

    private func formattedVersion(_ version: String?) -> String {
        guard let version, !version.isEmpty else { return "—" }
        let trimmed = version.replacingOccurrences(
            of: "^Version\\s*",
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        return trimmed.lowercased().hasPrefix("v") ? trimmed.uppercased() : "V\(trimmed)"
    }

    private func formattedFileSize(_ bytes: UInt64) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    private func formattedFontFormat(_ format: String) -> String {
        switch format.uppercased() {
        case "TTF":
            "OpenType TrueType"
        case "OTF":
            "OpenType CFF"
        default:
            format
        }
    }

    private func formattedGlyphCount(_ face: FaceSummary) -> String {
        guard let glyphCount = localFontGlyphCount(for: face) else { return "—" }
        return glyphCount.formatted()
    }

    private func cssFontFace(_ family: FamilyCard, face: FaceSummary) -> String {
        let fileName = face.sourcePath.map { URL(fileURLWithPath: $0).lastPathComponent } ?? "font-file"
        return """
        @font-face {
          font-family: "\(family.displayName)";
          src: url("\(fileName)");
          font-style: normal;
        }
        """
    }

    private func swiftUIFont(_ family: FamilyCard, face: FaceSummary) -> String {
        let name = face.postScriptName ?? family.displayName
        return ".font(.custom(\"\(name)\", size: 16))"
    }
}

private struct InspectorButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    var cornerRadius: CGFloat = 8
    var destructive = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(destructive ? Color.red : Color.primary)
            .background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(backgroundColor(isPressed: configuration.isPressed))
            }
            .opacity(isEnabled ? 1 : 0.45)
    }

    private func backgroundColor(isPressed: Bool) -> Color {
        if destructive {
            return Color.red.opacity(isPressed ? 0.24 : 0.15)
        }
        return Color.primary.opacity(isPressed ? 0.13 : 0.075)
    }
}
