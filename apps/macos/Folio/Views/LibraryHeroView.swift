import SwiftUI

struct LibraryHeroView: View {
    let presentation: HeroPresentation
    var onAction: ((HeroAction) -> Void)? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) {
                    heroIcon
                    heading.fixedSize(horizontal: true, vertical: false)
                }
                VStack(alignment: .leading, spacing: 8) {
                    heroIcon
                    heading
                }
            }
            .padding(.horizontal, 2)

            Text(presentation.subtitle)
                .font(.system(size: 24, weight: .regular))
                .fontWidth(.condensed)
                .foregroundStyle(.secondary)
                .frame(minHeight: 32, alignment: .leading)
                .padding(.leading, 4)

            Group {
                if let action = presentation.sync.action, let onAction {
                    Button { onAction(action) } label: { syncLabel }
                        .buttonStyle(.plain)
                } else {
                    syncLabel
                }
            }
            .padding(.top, 8)
            .padding(.leading, 4)

            if let detail = presentation.detail {
                HStack(alignment: .top, spacing: 4) {
                    Image.englishSystemName("lasso.badge.sparkles")
                        .frame(width: 16, height: 32)
                        .accessibilityHidden(true)
                    Text(detail).frame(minHeight: 32, alignment: .leading)
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.secondary)
                .padding(.leading, 4)
            }
        }
        .frame(maxWidth: 648, minHeight: 104, alignment: .leading)
        .padding(10)
        .frame(maxWidth: 946)
    }

    private var heroIcon: some View {
        Image.englishSystemName(presentation.symbol)
            .font(.system(size: 20, weight: .semibold))
            .symbolRenderingMode(.monochrome)
            .foregroundStyle(iconColor)
            .frame(width: 24, height: 32)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var heading: some View {
        Group {
            if let action = presentation.action, let onAction {
                Button { onAction(action) } label: {
                    HStack(spacing: 6) {
                        Text(presentation.title)
                        Image.englishSystemName("chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.tertiary)
                            .accessibilityHidden(true)
                    }
                }
                .buttonStyle(.plain)
            } else {
                Text(presentation.title)
            }
        }
        .font(.system(size: 24, weight: .medium))
        .fontWidth(.condensed)
        .frame(minHeight: 32, alignment: .leading)
        .accessibilityAddTraits(.isHeader)
    }

    private var syncLabel: some View {
        HStack(alignment: .top, spacing: 4) {
            Image.englishSystemName(syncSymbol)
                .symbolEffect(.rotate, options: .repeating, isActive: presentation.sync.state == .running && !reduceMotion)
                .foregroundStyle(syncColor)
                .frame(width: 16, height: 32)
                .accessibilityHidden(true)
            Text(presentation.sync.text).frame(minHeight: 32, alignment: .leading)
        }
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(.secondary)
    }

    private var syncSymbol: String {
        switch presentation.sync.state {
        case .running, .checking: "arrow.trianglehead.2.clockwise.rotate.90"
        case .error: "exclamationmark.triangle"
        case .synced: "checkmark.icloud"
        default: "icloud"
        }
    }

    private var syncColor: Color {
        switch presentation.sync.state {
        case .pending, .error: .orange
        case .running: .blue
        default: .secondary
        }
    }

    private var iconColor: Color {
        switch presentation.kind {
        case .normal: Color(red: 38.0 / 255.0, green: 191.0 / 255.0, blue: 77.0 / 255.0)
        case .damaged: Color(red: 245.0 / 255.0, green: 35.0 / 255.0, blue: 75.0 / 255.0)
        case .update: Color(red: 0, green: 120.0 / 255.0, blue: 240.0 / 255.0)
        case .cloudAhead, .localUnsynced, .cloudStorageLow: Color(red: 245.0 / 255.0, green: 134.0 / 255.0, blue: 37.0 / 255.0)
        case .conflict: Color(red: 203.0 / 255.0, green: 48.0 / 255.0, blue: 224.0 / 255.0)
        }
    }
}

#if DEBUG
#Preview("Hero 状态") {
    ScrollView {
        VStack(spacing: 12) {
            ForEach(HeroPresentation.previewCases) { item in LibraryHeroView(presentation: item, onAction: { _ in }) }
        }
        .padding()
    }
    .frame(width: 760, height: 1000)
}
#endif
