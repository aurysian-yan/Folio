import AppKit
import SwiftUI

struct FontInspectorView: View {
    @Bindable var model: LibraryViewModel

    @State private var previewExpanded = true
    @State private var axesExpanded = true
    @State private var copyExpanded = true
    @State private var informationExpanded = true
    @State private var destructiveActionsPresented = false

    var body: some View {
        Group {
            if let family = model.selectedFamily, let face = model.selectedFace {
                inspector(family, face: face)
            } else {
                ContentUnavailableView {
                    Label {
                        Text(L.text("inspector.selectFont"))
                    } icon: {
                        Image.englishSystemName("character.cursor.ibeam")
                    }
                } description: {
                    Text(L.text("inspector.selectFamilyHint"))
                }
            }
        }
        .confirmationDialog(destructiveDialogTitle, isPresented: $destructiveActionsPresented) {
            if let source = model.selectedSource {
                let actions = model.availableActions(for: source)
                if actions.contains(.uninstall) {
                    Button(L.text("inspector.uninstall"), role: .destructive) {
                        model.perform(.uninstall, on: source)
                    }
                }
                if actions.contains(.remove) {
                    Button(L.text("inspector.moveToTrash"), role: .destructive) {
                        model.trashSelectedFace()
                    }
                }
            }
            Button(L.text("common.cancel"), role: .cancel) {}
        } message: {
            Text(destructiveDialogMessage)
        }
    }

    private func inspector(_ family: FamilyCard, face: FaceSummary) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                header(family, face: face)

                VStack(alignment: .leading, spacing: 0) {
                    disclosureHeader(L.text("preview.title"), isExpanded: $previewExpanded)
                    if previewExpanded {
                        if face.location?.localAvailable != false { InspectorFontPreview(model: model, face: face) }
                        else { Text(L.text("fontLocation.previewHint")).foregroundStyle(.secondary) }
                    }
                }

                inspectorDivider

                VStack(alignment:.leading,spacing:10) {
                    Text(L.text("fontLocation.title")).font(.headline)
                    Text(family.locationLabel(selected:face)).foregroundStyle(.secondary)
                    if let date = face.location?.cloudConfirmedAtMs { Text(L.format("fontLocation.lastConfirmed",Date(timeIntervalSince1970:Double(date)/1000).formatted())).font(.caption).foregroundStyle(.secondary) }
                    ForEach(face.location?.files ?? [],id:\.fingerprint) { file in
                        Text(file.filename)
                        ForEach(file.localSources,id:\.path) { source in
                            let status = model.sourceStatuses[source.path]
                            let kind = status?.isManagedCopy == true ? "managed" : status?.state == .installed ? "installed" : status?.state == .system ? "system" : "reference"
                            Text(L.text("fontLocation.source.\(kind)")).font(.caption).foregroundStyle(.secondary)
                            if (model.selectedSourcePath ?? face.sourcePath) == source.path { Text(L.text("fontLocation.currentPreview")).font(.caption).foregroundStyle(.secondary) }
                            Button(source.path) { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath:source.path)]) }.lineLimit(nil)
                        }
                        if let state = file.transferStatus, state != "done" { Text(L.text("fontLocation.transfer.\(state)")).font(.caption) }
                        if file.cloudAvailable && file.localSources.isEmpty { Button(L.text("fontLocation.download")) { CloudSyncModel.shared.download(file.fingerprint) } }
                        if !file.cloudAvailable && !file.localSources.contains(where: { $0.kind == "managed" }),
                           let path = file.localSources.first?.path, let source = face.sources.first(where: { $0.path == path }), CloudSyncModel.shared.isConnected {
                            Button(L.text("cloud.addToCloud")) { model.addSourceToCloud(source) }.disabled(CloudSyncModel.shared.isRunning)
                        }
                        if file.localSources.contains(where: { $0.kind == "managed" }) {
                            if !file.cloudAvailable && !file.uploadExcluded { Button(L.text("cloud.upload")) { CloudSyncModel.shared.excludeUpload(file.fingerprint, excluded:false) } }
                            if file.cloudAvailable { Button(L.text("fontLocation.removeDownload")) { CloudSyncModel.shared.removeDownload(file.fingerprint) } }
                            Button(L.text(file.uploadExcluded ? "fontLocation.resumeUpload" : "fontLocation.keepLocal")) { CloudSyncModel.shared.excludeUpload(file.fingerprint,excluded:!file.uploadExcluded) }
                        }
                    }
                }
                inspectorDivider

                if family.faces.count > 1 {
                    facePicker(family, face: face)
                    inspectorDivider
                }

                if !visibleAxes(face).isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        disclosureHeader(L.text("inspector.variableAxes"), isExpanded: $axesExpanded)
                        if axesExpanded {
                            axes(face)
                        }
                    }
                    inspectorDivider
                }

                VStack(alignment: .leading, spacing: 0) {
                    disclosureHeader(L.text("inspector.copyAs"), isExpanded: $copyExpanded)
                    if copyExpanded {
                        copySection(family, face: face)
                    }
                }

                inspectorDivider

                VStack(alignment: .leading, spacing: 10) {
                    disclosureHeader(L.text("inspector.information"), isExpanded: $informationExpanded)
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
                    .font(.system(size: 22, weight: .medium))
                    .fontWidth(.condensed)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)

                HStack(spacing: 5) {
                    Text(formattedVersion(face.version))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .layoutPriority(1)
                        .help(formattedVersion(face.version))
                    Text("|")
                        .foregroundStyle(.tertiary)
                        .fixedSize()
                    Text(formattedFileSize(face.fileSize))
                        .fixedSize(horizontal: true, vertical: false)
                    Spacer(minLength: 0)
                }
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .padding(.horizontal, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: 16)

                if let source = model.selectedSource {
                    sourceStatusLabel(source)
                        .padding(.horizontal, 4)
                }
            }

            HStack(spacing: 8) {
                if let source = model.selectedSource,
                   !visibleActions(for: source).isEmpty {
                    Button(action: model.revealSelectedFace) {
                        Image.englishSystemName("finder")
                            .font(.system(size: 12, weight: .semibold))
                            .frame(width: 34, height: 34)
                    }
                    .buttonStyle(InspectorButtonStyle(cornerRadius: 17))
                    .accessibilityLabel(L.text("inspector.revealInFinder"))
                } else {
                    inspectorButton(L.text("inspector.revealInFinder"), systemImage: "finder", action: model.revealSelectedFace)
                        .disabled(model.selectedSource == nil)
                }

                if let source = model.selectedSource {
                    ForEach(visibleActions(for: source), id: \.rawValue) { action in
                        inspectorButton(
                            action.title,
                            systemImage: actionSymbol(action),
                            titleFont: .system(size: 14, weight: .medium),
                            centersWhenTight: true
                        ) {
                            model.perform(action, on: source)
                        }
                    }
                }

                if !destructiveActions.isEmpty {
                    Button {
                        destructiveActionsPresented = true
                    } label: {
                        Image.englishSystemName("trash")
                            .font(.system(size: 12, weight: .semibold))
                            .frame(width: 34, height: 34)
                    }
                    .buttonStyle(InspectorButtonStyle(cornerRadius: 17, destructive: true))
                    .accessibilityLabel(destructiveButtonLabel)
                }
            }

            if face.sources.count > 1 {
                Picker(L.text("inspector.fontFile"), selection: $model.selectedSourcePath) {
                    Text(L.text("inspector.selectFontFile")).tag(String?.none)
                    ForEach(face.sources) { source in
                        Text(source.path).tag(Optional(source.path))
                    }
                }
            }

        }
    }

    private func sourceStatus(_ state: FontOperationState) -> String {
        switch state {
        case .available: L.text("fontState.available")
        case .active: L.text("fontState.active")
        case .installed: L.text("fontState.installed")
        case .external: L.text("fontState.external")
        case .system: L.text("fontState.system")
        case .unavailable: L.text("fontState.unavailableTemporary")
        }
    }

    private func sourceStatusLabel(_ source: FontSource) -> some View {
        let state = model.status(for: source).state
        return HStack(spacing: 6) {
            Image.englishSystemName(statusSymbol(state))
                .font(.system(size: 12, weight: .medium))
                .frame(width: 16)
            Text(sourceStatus(state))
                .font(.system(size: 12, weight: .medium))
        }
        .foregroundStyle(.secondary)
    }

    private func statusSymbol(_ state: FontOperationState) -> String {
        switch state {
        case .available: "plus.diamond"
        case .active: "checkmark.diamond"
        case .installed: "minus.diamond"
        case .external: "doc"
        case .system: "laptopcomputer.and.arrow.down"
        case .unavailable: "exclamationmark.triangle"
        }
    }

    private func actionSymbol(_ action: FontAction) -> String {
        switch action {
        case .activate: "plus.diamond"
        case .deactivate: "eject"
        case .install: "square.and.arrow.down"
        case .uninstall: "square.and.arrow.up"
        case .remove: "trash"
        }
    }

    private func visibleActions(for source: FontSource) -> [FontAction] {
        model.availableActions(for: source).filter { $0 != .remove && $0 != .uninstall }
    }

    private var destructiveActions: [FontAction] {
        guard let source = model.selectedSource else { return [] }
        return model.availableActions(for: source).filter { $0 == .uninstall || $0 == .remove }
    }

    private var destructiveButtonLabel: String {
        if destructiveActions.count > 1 { return L.text("inspector.uninstallOrRemove") }
        return destructiveActions.first == .uninstall ? L.text("inspector.uninstall") : L.text("inspector.removeFont")
    }

    private var destructiveDialogTitle: String {
        destructiveActions.count > 1 ? L.text("inspector.manageFonts") : destructiveButtonLabel
    }

    private var destructiveDialogMessage: String {
        if destructiveActions.contains(.uninstall) && destructiveActions.contains(.remove) {
            return L.text("inspector.chooseAction")
        }
        if destructiveActions.contains(.uninstall) { return L.text("inspector.uninstallDescription") }
        if destructiveActions.contains(.remove) { return L.text("inspector.removeDescription") }
        return ""
    }

    private func facePicker(_ family: FamilyCard, face: FaceSummary) -> some View {
        HStack {
            Text(L.text("font.weight"))
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Picker(L.text("font.weight"), selection: Binding(
                get: { model.selectedFaceID ?? face.id },
                set: { faceID in
                    guard let selectedFace = family.faces.first(where: { $0.id == faceID }) else { return }
                    model.selectFace(selectedFace)
                }
            )) {
                ForEach(family.faces) { item in
                    Text(item.styleName).tag(item.id)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .font(.system(size: 12, weight: .medium))
        }
        .frame(height: 26)
        .padding(.horizontal, 4)
    }

    private func axes(_ face: FaceSummary) -> some View {
        VStack(alignment: .leading, spacing: 12) {
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
                    .frame(height: 18)
                    .padding(.horizontal, 4)

                    Slider(
                        value: Binding(
                            get: { model.axisValues[axis.tag, default: axis.defaultValue] },
                            set: { model.axisValues[axis.tag] = $0 }
                        ),
                        in: axis.minimum...axis.maximum
                    )
                    .controlSize(.small)
                    .frame(height: 24)
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
                    .frame(height: 14)
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
                inspectorButton(L.text("font.familyName"), systemImage: "doc.on.doc") {
                    model.copy(family.displayName)
                }
                inspectorButton(L.text("font.postScriptName"), systemImage: "doc.on.doc") {
                    model.copy(face.postScriptName)
                }
                .disabled(face.postScriptName == nil)
            }
        }
    }

    private func information(_ face: FaceSummary) -> some View {
        VStack(spacing: 4) {
            informationRow(L.text("font.designer"), value: face.designer ?? "—")
            informationRow(L.text("font.foundry"), value: face.manufacturer ?? "—")
            informationRow(L.text("font.format"), value: formattedFontFormat(face.format))
            informationRow(L.text("font.glyphCount"), value: formattedGlyphCount(face))
            informationRow(L.text("font.fileSize"), value: formattedFileSize(face.fileSize))
            informationRow(L.text("font.copyright"), value: face.copyright ?? "—")
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
        .accessibilityValue(isExpanded.wrappedValue ? L.text("inspector.expanded") : L.text("inspector.collapsed"))
    }

    private func inspectorButton(
        _ title: String,
        systemImage: String,
        titleFont: Font = .system(size: 12, weight: .medium),
        centersWhenTight: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Group {
                if centersWhenTight {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 10) {
                            Image.englishSystemName(systemImage)
                                .font(.system(size: 12, weight: .semibold))
                                .frame(width: 16)
                            Text(title)
                                .font(titleFont)
                                .fixedSize(horizontal: true, vertical: false)
                            Spacer(minLength: 0)
                        }

                        Text(title)
                            .font(titleFont)
                            .fixedSize(horizontal: true, vertical: false)
                            .frame(maxWidth: .infinity, alignment: .center)
                    }
                } else {
                    HStack(spacing: 10) {
                        Image.englishSystemName(systemImage)
                            .font(.system(size: 12, weight: .semibold))
                            .frame(width: 16)
                        Text(title)
                            .font(titleFont)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                }
            }
            .padding(.horizontal, 12)
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

private struct InspectorFontPreview: View {
    @Bindable var model: LibraryViewModel
    let face: FaceSummary
    @State private var dragOriginHeight: CGFloat?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            EditableInspectorFontPreview(
                text: $model.inspectorPreviewText,
                face: face,
                size: model.inspectorPreviewSize,
                color: .primary,
                axes: model.axisValues
            )
            .frame(maxWidth: .infinity)
            .frame(minHeight: 66)
            .frame(height: model.inspectorPreviewHeight, alignment: .top)
            .padding(.horizontal, 4)
            .clipped()

            previewResizeHandle

            previewSizeAdjustment
        }
        .transaction { $0.animation = nil }
    }

    private var previewResizeHandle: some View {
        Image.englishSystemName("line.3.horizontal")
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(.tertiary)
            .frame(maxWidth: .infinity)
            .frame(height: 12)
            .contentShape(.rect)
            .highPriorityGesture(
                DragGesture()
                    .onChanged { value in
                        let origin = dragOriginHeight ?? model.inspectorPreviewHeight
                        dragOriginHeight = origin
                        model.inspectorPreviewHeight = min(max(origin + value.translation.height, 66), 720)
                    }
                    .onEnded { _ in
                        dragOriginHeight = nil
                    }
            )
            .accessibilityLabel(L.text("inspector.previewAreaHeight"))
            .accessibilityHint(L.text("inspector.previewAreaHeightHint"))
    }

    private var previewSizeAdjustment: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(L.text("preview.size"))
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                Spacer(minLength: 0)
                Text("\(Int(model.inspectorPreviewSize.rounded())) px")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            .frame(height: 18)
            .padding(.horizontal, 4)

            Slider(value: $model.inspectorPreviewSize, in: 10...32)
                .controlSize(.small)
                .frame(height: 24)
                .padding(.horizontal, 6)
                .accessibilityLabel(L.text("preview.size"))
                .accessibilityValue("\(Int(model.inspectorPreviewSize.rounded())) px")
                .sliderHaptics(value: model.inspectorPreviewSize, in: 10...32, feedbackStep: 1)

            HStack {
                Text("10")
                    .foregroundStyle(.secondary)
                Spacer()
                Text("32")
                    .foregroundStyle(.tertiary)
            }
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .frame(height: 14)
            .padding(.horizontal, 4)
        }
    }
}

private struct EditableInspectorFontPreview: NSViewRepresentable {
    @Binding var text: String
    let face: FaceSummary
    let size: Double
    let color: Color
    let axes: [String: Double]

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true

        let textView = NSTextView()
        textView.delegate = context.coordinator
        textView.drawsBackground = false
        textView.isRichText = false
        textView.isEditable = true
        textView.allowsUndo = true
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [.width]
        textView.textContainerInset = .zero
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(
            width: 0,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.setAccessibilityLabel(L.text("desktop.fontPreviewText"))
        scrollView.documentView = textView
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NSTextView else { return }
        context.coordinator.text = $text
        if textView.string != text {
            textView.string = text
        }
        textView.font = localFont(for: face, size: size, axes: axes)
        textView.textColor = NSColor(color)
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var text: Binding<String>

        init(text: Binding<String>) {
            self.text = text
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            text.wrappedValue = textView.string
        }
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
