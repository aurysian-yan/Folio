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
    let family: FamilyCard
    let presentation: FontCardPresentation

    private let cornerRadius: CGFloat = 16

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

    var body: some View {
        ZStack(alignment: .topTrailing) {
            cardContent
                .frame(maxWidth: presentation == .expanded ? .infinity : nil)
                .frame(
                    width: presentation == .expanded ? nil : presentation.width,
                    height: presentation.height
                )
                .background {
                    cardShape.fill(.ultraThickMaterial)
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
                .overlay {
                    cardShape.stroke(
                        selected && presentation != .expanded
                            ? Color(red: 0, green: 120 / 255, blue: 240 / 255)
                            : Color.primary.opacity(presentation == .expanded ? 0 : 0.1),
                        lineWidth: selected && presentation != .expanded ? 3 : 1
                    )
                    .allowsHitTesting(false)
                }

            if selected, presentation != .expanded {
                cardActions
                    .padding(10)
            }
        }
        .frame(maxWidth: presentation == .expanded ? presentation.width : nil)
        .frame(height: presentation.height)
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
        .onTapGesture {
            select()
        }
        .onHover { hovering in
            guard hovering, selectCardsOnHover, !selected else { return }
            if hoverSelectionHaptics {
                NSHapticFeedbackManager.defaultPerformer.perform(
                    .alignment,
                    performanceTime: .now
                )
            }
            select()
        }
        .contextMenu {
            Button(family.isFavorite ? "取消收藏" : "收藏") {
                model.toggleFavorite(family)
            }
            Button("在 Finder 中显示") {
                select()
                model.revealSelectedFace()
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
    }

    @ViewBuilder
    private var cardContent: some View {
        switch presentation {
        case .compact:
            VStack(spacing: 0) {
                preview(alignment: .center, lineLimit: 2)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                VStack(spacing: 2) {
                    familyName
                    if selected {
                        faceSelector
                    } else {
                        familyMetadata
                    }
                }
            }
            .padding(10)
        case .large:
            VStack(spacing: 0) {
                preview(alignment: .center)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
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
        case .strip:
            VStack(spacing: 0) {
                preview(alignment: .left)
                    .frame(maxWidth: .infinity)
                    .frame(height: 42)
                    .padding(.horizontal, 4)
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
            VStack(alignment: .leading, spacing: 0) {
                preview(alignment: .left)
                    .frame(maxWidth: .infinity)
                    .frame(height: 28)
                Spacer(minLength: 0)
                familyName
                HStack {
                    familyMetadata
                    Spacer(minLength: 8)
                    faceSelector
                }
            }
            .padding(14)
        }
    }

    private func preview(alignment: NSTextAlignment, lineLimit: Int = 1) -> some View {
        FontPreviewView(
            text: model.previewText,
            face: face,
            size: model.previewSize,
            color: model.previewColor,
            axes: selected ? model.axisValues : [:],
            alignment: alignment,
            lineLimit: lineLimit
        )
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
                    Image(systemName: "chevron.left")
                        .frame(width: 22, height: 16)
                }
                Spacer(minLength: 0)
                Button {
                    model.moveFace(in: family, offset: 1)
                } label: {
                    Image(systemName: "chevron.right")
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
            Image(systemName: systemName)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 22, height: 22)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }
}
