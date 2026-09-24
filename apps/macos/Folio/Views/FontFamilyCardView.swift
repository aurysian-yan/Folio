import AppKit
import SwiftUI

enum FontCardPresentation: Hashable, Sendable {
    case compact
    case large
    case strip
    case expanded

    var width: CGFloat {
        switch self {
        case .compact: 152
        case .large, .strip: 272
        case .expanded: 410
        }
    }

    var height: CGFloat {
        switch self {
        case .compact: 152
        case .large: 164
        case .strip: 84
        case .expanded: 280
        }
    }

    var familyFontSize: CGFloat {
        switch self {
        case .compact: 14
        case .large, .strip: 15
        case .expanded: 17
        }
    }

    var aspectRatio: CGFloat {
        width / height
    }

    var faceSelectorWidth: CGFloat {
        switch self {
        case .compact: 108
        case .large, .strip: 112
        case .expanded: 140
        }
    }
}

struct FontFamilyCardView: View {
    @Bindable var model: LibraryViewModel
    @AppStorage(AppPreferences.selectCardsOnHover) private var selectCardsOnHover = true
    @AppStorage(AppPreferences.hoverSelectionHaptics) private var hoverSelectionHaptics = true
    @AppStorage(AppPreferences.expandedCardWidth) private var expandedCardWidth = 410.0
    @State private var hoverSelectionTask: Task<Void, Never>?
    @State private var previewSizeUpdateTask: Task<Void, Never>?
    @State private var displayedPreviewSize: Double
    let family: FamilyCard
    let presentation: FontCardPresentation

    private let cornerRadius: CGFloat = 16
    private let expandedFooterHeight: CGFloat = 44

    init(
        model: LibraryViewModel,
        family: FamilyCard,
        presentation: FontCardPresentation
    ) {
        self.model = model
        self.family = family
        self.presentation = presentation
        _displayedPreviewSize = State(initialValue: model.committedPreviewSize)
    }

    private var face: FaceSummary? {
        if selected,
           let selectedFaceID = model.selectedFaceID,
           let selected = family.faces.first(where: { $0.id == selectedFaceID }) {
            return selected
        }
        return family.defaultFace
    }

    private var selected: Bool {
        model.selectedFamilyID == family.id
    }

    private var cardShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
    }

    private var cardWidth: CGFloat {
        presentation == .expanded ? CGFloat(expandedCardWidth) : presentation.width
    }

    private var cardHeight: CGFloat {
        presentation == .expanded
            ? cardWidth / FontCardPresentation.expanded.aspectRatio
            : presentation.height
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            sizedCardContent
                .background {
                    cardShape.fill(.thickMaterial)
                    cardShape.fill(
                        Color(nsColor: .controlBackgroundColor)
                            .opacity(presentation == .expanded ? 0.72 : 0.58)
                    )
                    if let cardBackgroundColor = model.cardBackgroundColor {
                        cardShape.fill(cardBackgroundColor)
                    }
                    if selected, presentation != .expanded {
                        LinearGradient(
                            stops: [
                                .init(color: .clear, location: 0.53125),
                                .init(color: Color.accentColor.opacity(0.4), location: 1),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .clipShape(cardShape)
                    }
                }
                .clipShape(cardShape)
                .overlay {
                    cardShape.stroke(
                        selected && presentation != .expanded
                            ? Color(red: 0, green: 120 / 255, blue: 240 / 255)
                            : Color.primary.opacity(presentation == .expanded ? 0.08 : 0.1),
                        lineWidth: selected && presentation != .expanded ? 3 : 1
                    )
                    .allowsHitTesting(false)
                }

            if selected, presentation != .expanded {
                cardActions
                    .padding(10)
            }
        }
        .frame(maxWidth: presentation == .expanded ? cardWidth : nil)
        .contentShape(cardShape)
        .shadow(
            color: presentation == .expanded ? .black.opacity(0.15) : .clear,
            radius: 8,
            y: 12
        )
        .shadow(
            color: presentation == .expanded ? .black.opacity(0.05) : .clear,
            radius: 2.5,
            y: 6
        )
        .shadow(
            color: presentation == .expanded ? .black.opacity(0.05) : .clear,
            radius: 1,
            y: 2
        )
        .onTapGesture {
            hoverSelectionTask?.cancel()
            select()
        }
        .onHover { hovering in
            updateHoverSelection(hovering)
        }
        .contextMenu {
            if let face, face.sources.contains(where: { !model.availableActions(for: $0).isEmpty }) {
                Menu("字体操作") {
                    ForEach(face.sources.filter { !model.availableActions(for: $0).isEmpty }) { source in
                        Menu(source.path) {
                            ForEach(model.availableActions(for: source), id: \.rawValue) { action in
                                Button(action.title) { model.perform(action, on: source) }
                            }
                        }
                    }
                }
            }
            Button(family.isFavorite ? "取消收藏" : "收藏") {
                model.toggleFavorite(family)
            }
            if let face {
                Menu("在 Finder 中显示") {
                    ForEach(face.sources) { source in
                        Button(source.path) {
                            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: source.path)])
                        }
                    }
                }
            }
            Divider()
            Button("复制字族名") {
                model.copy(family.displayName)
            }
            if let postScriptName = face?.postScriptName {
                Button("复制 PostScript 名称") {
                    model.copy(postScriptName)
                }
            }
            if !model.snapshot.collections.isEmpty {
                Divider()
                Menu("加入收藏夹") {
                    ForEach(model.snapshot.collections) { collection in
                        Button(collection.name) {
                            model.setCollection(collection, family: family, member: true)
                        }
                    }
                }
                Menu("移出收藏夹") {
                    ForEach(model.snapshot.collections) { collection in
                        Button(collection.name) {
                            model.setCollection(collection, family: family, member: false)
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(family.displayName)，\(family.faces.count) 个样式")
        .accessibilityAddTraits(selected ? .isSelected : [])
        .onAppear { model.loadMoreIfNeeded(current: family) }
        .onChange(of: model.previewSizeCommitGeneration) { _, _ in
            schedulePreviewSizeUpdate()
        }
        .onDisappear {
            hoverSelectionTask?.cancel()
            previewSizeUpdateTask?.cancel()
        }
    }

    @ViewBuilder
    private var sizedCardContent: some View {
        switch presentation {
        case .compact, .large:
            Color.clear
                .aspectRatio(presentation.aspectRatio, contentMode: .fit)
                .overlay {
                    GeometryReader { geometry in
                        cardContent(cardSize: geometry.size)
                            .frame(width: geometry.size.width, height: geometry.size.height)
                    }
                }
        case .strip:
            cardContent()
                .frame(maxWidth: .infinity)
                .frame(height: presentation.height)
        case .expanded:
            cardContent()
                .frame(width: cardWidth, height: cardHeight)
        }
    }

    @ViewBuilder
    private func cardContent(cardSize: CGSize? = nil) -> some View {
        switch presentation {
        case .compact:
            VStack(spacing: 0) {
                preview(alignment: .center, lineLimit: 2)
                    .frame(maxWidth: .infinity)
                    .frame(height: previewHeight(in: cardSize, footerHeight: 36))
                    .clipped()
                    .zIndex(0)
                VStack(spacing: 2) {
                    familyName
                    if selected {
                        faceSelector
                    } else {
                        familyMetadata
                    }
                }
                .frame(height: 36)
                .zIndex(1)
            }
            .padding(10)
        case .large:
            VStack(spacing: 0) {
                preview(alignment: .center)
                    .frame(maxWidth: .infinity)
                    .frame(height: previewHeight(in: cardSize, footerHeight: 22))
                    .clipped()
                    .zIndex(0)
                HStack {
                    familyName
                    Spacer(minLength: 8)
                    if selected {
                        faceSelector
                    } else {
                        familyMetadata
                    }
                }
                .padding(.horizontal, 4)
                .frame(height: 22)
                .zIndex(1)
            }
            .padding(10)
        case .strip:
            VStack(spacing: 0) {
                preview(alignment: .left)
                    .frame(maxWidth: .infinity)
                    .frame(height: 42)
                    .padding(.horizontal, 4)
                    .clipped()
                HStack {
                    familyName
                    Spacer(minLength: 8)
                    if selected {
                        faceSelector
                    } else {
                        familyMetadata
                    }
                }
                .padding(.horizontal, 4)
                .frame(height: 22)
            }
            .padding(10)
        case .expanded:
            GeometryReader { geometry in
                let contentWidth = max(0, geometry.size.width - 28)
                let contentHeight = max(0, geometry.size.height - 28)

                ZStack(alignment: .bottom) {
                    preview(
                        alignment: .left,
                        verticalAlignment: .top,
                        lineLimit: 6
                    )
                    .frame(
                        width: contentWidth,
                        height: contentHeight,
                        alignment: .top
                    )
                    .clipped()
                    .mask {
                        VStack(spacing: 0) {
                            Rectangle()
                            Color.clear
                                .frame(height: expandedFooterHeight)
                        }
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        familyName
                        HStack {
                            familyMetadata
                            Spacer(minLength: 8)
                            faceSelector
                        }
                    }
                    .frame(width: contentWidth, alignment: .leading)
                    .frame(height: expandedFooterHeight, alignment: .bottom)
                }
                .frame(width: contentWidth, height: contentHeight)
                .position(
                    x: geometry.size.width / 2,
                    y: geometry.size.height / 2
                )
            }
        }
    }

    private func previewHeight(in cardSize: CGSize?, footerHeight: CGFloat) -> CGFloat {
        max(0, (cardSize?.height ?? presentation.height) - 20 - footerHeight)
    }

    private func preview(
        alignment: NSTextAlignment,
        verticalAlignment: FontPreviewVerticalAlignment = .center,
        lineLimit: Int = 1
    ) -> some View {
        FontPreviewView(
            text: model.previewText,
            face: face,
            size: cardPreviewSize,
            color: model.previewColor,
            axes: selected ? model.axisValues : [:],
            alignment: alignment,
            verticalAlignment: verticalAlignment,
            lineLimit: lineLimit
        )
    }

    private var cardPreviewSize: Double {
        if model.isPreviewSizeEditing,
           model.previewSizeEditingFamilyID == family.id {
            return model.previewSize
        }
        return displayedPreviewSize
    }

    private func schedulePreviewSizeUpdate() {
        previewSizeUpdateTask?.cancel()
        let targetSize = model.committedPreviewSize
        let anchorID = model.previewSizeEditingFamilyID ?? model.families.first?.id
        guard family.id != anchorID,
              let familyIndex = model.families.firstIndex(where: { $0.id == family.id }) else {
            displayedPreviewSize = targetSize
            return
        }
        let anchorIndex = anchorID.flatMap { id in
            model.families.firstIndex(where: { $0.id == id })
        } ?? 0
        let updateOrder = abs(familyIndex - anchorIndex) + 1
        let delayMilliseconds = min(updateOrder * 10, 1_000)
        previewSizeUpdateTask = Task { @MainActor in
            do {
                try await Task.sleep(for: .milliseconds(delayMilliseconds))
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            displayedPreviewSize = targetSize
        }
    }

    private var familyName: some View {
        Text(family.displayName)
            .font(.system(
                size: presentation.familyFontSize,
                weight: selected && presentation != .expanded ? .semibold : .medium
            ))
            .lineLimit(1)
    }

    private var familyMetadata: some View {
        HStack(spacing: 5) {
            Text("\(family.faces.count)个样式")
            if family.isVariable {
                Rectangle()
                    .fill(Color.secondary.opacity(0.45))
                    .frame(width: 1, height: 10)
                Text("VF")
            }
        }
        .font(.system(
            size: presentation == .expanded ? 13 : 12,
            weight: .medium,
            design: .monospaced
        ))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .frame(height: 16)
    }

    private var faceSelector: some View {
        ZStack {
            HStack(spacing: 0) {
                Button {
                    model.moveFace(in: family, offset: -1)
                } label: {
                    Image.englishSystemName("chevron.left")
                        .frame(width: 22, height: 16)
                }
                Spacer(minLength: 0)
                Button {
                    model.moveFace(in: family, offset: 1)
                } label: {
                    Image.englishSystemName("chevron.right")
                        .frame(width: 22, height: 16)
                }
            }
            Text(face?.styleName ?? "Regular")
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .lineLimit(1)
                .truncationMode(.middle)
                .padding(.horizontal, 24)
        }
        .frame(width: presentation.faceSelectorWidth, height: 16)
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(.secondary)
        .buttonStyle(.plain)
        .disabled(family.faces.count < 2)
    }

    private var cardActions: some View {
        HStack(spacing: 8) {
            CardGlassButton(
                systemName: "document.on.document",
                accessibilityLabel: "复制字族名"
            ) {
                model.copy(family.displayName)
            }
            CardGlassButton(
                systemName: family.isFavorite ? "star.fill" : "star",
                accessibilityLabel: family.isFavorite ? "取消收藏" : "收藏"
            ) {
                model.toggleFavorite(family)
            }
        }
    }

    private func select() {
        guard model.selectedFamilyID != family.id else { return }
        model.selectFamily(family)
    }

    private func updateHoverSelection(_ hovering: Bool) {
        hoverSelectionTask?.cancel()
        hoverSelectionTask = nil

        guard hovering, selectCardsOnHover, !selected else { return }
        hoverSelectionTask = Task { @MainActor in
            do {
                try await Task.sleep(for: .milliseconds(180))
            } catch {
                return
            }
            guard !selected else { return }
            if hoverSelectionHaptics {
                NSHapticFeedbackManager.defaultPerformer.perform(
                    .alignment,
                    performanceTime: .now
                )
            }
            select()
        }
    }
}

private struct CardGlassButton: View {
    let systemName: String
    let accessibilityLabel: String
    let action: () -> Void

    var body: some View {
        if #available(macOS 26.0, *) {
            button
                .glassEffect(.regular, in: Circle())
        } else {
            button
                .background(.ultraThinMaterial, in: Circle())
                .overlay {
                    Circle()
                        .stroke(Color.primary.opacity(0.12), lineWidth: 0.5)
                }
        }
    }

    private var button: some View {
        Button(action: action) {
            Image.englishSystemName(systemName)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 22, height: 22)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }
}
