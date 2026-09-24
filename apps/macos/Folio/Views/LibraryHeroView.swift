import SwiftUI

struct LibraryHeroView: View {
    let presentation: HeroPresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image.englishSystemName(presentation.symbol)
                    .font(.system(size: 20, weight: .semibold))
                    .symbolRenderingMode(.monochrome)
                    .foregroundStyle(iconColor)

                Text(presentation.title)
                    .font(.system(size: 24, weight: .medium))
                    .fontWidth(.condensed)

                if presentation.kind != .normal {
                    Image.englishSystemName("chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
            }

            Text(presentation.subtitle)
                .font(.system(size: 24, weight: .regular))
                .fontWidth(.condensed)
                .foregroundStyle(.secondary)

            if let detail = presentation.detail {
                Text(detail)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)
            }
        }
        .frame(maxWidth: 648, minHeight: 104, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var iconColor: Color {
        switch presentation.kind {
        case .normal:
            Color(red: 38.0 / 255.0, green: 191.0 / 255.0, blue: 77.0 / 255.0)
        case .damaged:
            Color(red: 245.0 / 255.0, green: 35.0 / 255.0, blue: 75.0 / 255.0)
        case .update:
            Color(red: 0, green: 120.0 / 255.0, blue: 240.0 / 255.0)
        case .cloudAhead, .localUnsynced, .cloudStorageLow:
            Color(red: 245.0 / 255.0, green: 134.0 / 255.0, blue: 37.0 / 255.0)
        case .conflict:
            Color(red: 203.0 / 255.0, green: 48.0 / 255.0, blue: 224.0 / 255.0)
        }
    }
}

#if DEBUG
#Preview("Hero 状态") {
    ScrollView {
        VStack(spacing: 12) {
            ForEach(HeroPresentation.previewCases) { item in
                LibraryHeroView(presentation: item)
            }
        }
        .padding()
    }
    .frame(width: 760, height: 800)
}
#endif
