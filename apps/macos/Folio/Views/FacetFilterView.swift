import SwiftUI

enum SidebarLayoutMetrics {
    static let cardHorizontalInset: CGFloat = 8
    static let cardCornerRadius: CGFloat = 10
    static let sidebarRowExpansion: CGFloat = 7
}

struct FacetDisclosureGroupView: View {
    let kind: FacetKind
    let options: [FacetOption]
    let selectedFacets: Set<FacetOption>
    var animatesExpansion = true
    var titleFont: Font = .subheadline
    let onToggle: (FacetOption) -> Void

    @Environment(\.folioThemeColor) private var themeColor
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                if animatesExpansion {
                    withAnimation(.easeInOut(duration: 0.18)) {
                        isExpanded.toggle()
                    }
                } else {
                    isExpanded.toggle()
                }
            } label: {
                HStack {
                    Text(kind.title)
                        .font(titleFont)
                        .foregroundStyle(.primary)
                    Spacer(minLength: 8)
                    Image.englishSystemName(isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(kind.title)
            .accessibilityValue(isExpanded ? "已展开" : "已折叠")

            if isExpanded {
                FacetChipFlowLayout(horizontalSpacing: 6, verticalSpacing: 6) {
                    ForEach(options) { option in
                        facetButton(option)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 2)
                .transition(.asymmetric(
                    insertion: .move(edge: .top).combined(with: .opacity),
                    removal: .opacity
                ))
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            .quaternary,
            in: RoundedRectangle(cornerRadius: SidebarLayoutMetrics.cardCornerRadius, style: .continuous)
        )
    }

    private func facetButton(_ option: FacetOption) -> some View {
        let isSelected = selectedFacets.contains(option)
        return Button {
            onToggle(option)
        } label: {
            HStack(spacing: 4) {
                if isSelected {
                    Image.englishSystemName("checkmark")
                        .font(.system(size: 8, weight: .medium))
                        .frame(width: 16)
                }
                Text(option.label)
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(option.familyCount, format: .number)
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .opacity(0.75)
            }
            .foregroundStyle(isSelected ? Color.white : Color.primary)
            .padding(.horizontal, 7)
            .frame(height: 26)
            .background {
                if isSelected {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(themeColor)
                } else {
                    ZStack {
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(.ultraThickMaterial)
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(Color.primary.opacity(0.07))
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(option.label)，\(option.familyCount) 个字族")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

private struct FacetChipFlowLayout: Layout {
    let horizontalSpacing: CGFloat
    let verticalSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let width = proposal.width ?? sizes.reduce(0) { $0 + $1.width + horizontalSpacing }
        let arrangement = arrange(sizes, within: width)
        return CGSize(width: proposal.width ?? arrangement.size.width, height: arrangement.size.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let arrangement = arrange(sizes, within: bounds.width)
        for (index, subview) in subviews.enumerated() {
            let size = sizes[index]
            let width = min(size.width, bounds.width)
            subview.place(
                at: CGPoint(x: bounds.minX + arrangement.origins[index].x, y: bounds.minY + arrangement.origins[index].y),
                proposal: ProposedViewSize(width: width, height: size.height)
            )
        }
    }

    private func arrange(_ sizes: [CGSize], within width: CGFloat) -> (origins: [CGPoint], size: CGSize) {
        guard !sizes.isEmpty else { return ([], .zero) }

        let availableWidth = max(width, 1)
        var origins: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var contentWidth: CGFloat = 0

        for size in sizes {
            let itemWidth = min(size.width, availableWidth)
            if x > 0, x + itemWidth > availableWidth {
                x = 0
                y += rowHeight + verticalSpacing
                rowHeight = 0
            }

            origins.append(CGPoint(x: x, y: y))
            x += itemWidth + horizontalSpacing
            contentWidth = max(contentWidth, min(x - horizontalSpacing, availableWidth))
            rowHeight = max(rowHeight, size.height)
        }

        return (origins, CGSize(width: contentWidth, height: y + rowHeight))
    }
}
