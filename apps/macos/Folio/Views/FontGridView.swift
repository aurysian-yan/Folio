import SwiftUI

struct FontGridView: View {
    @Bindable var model: LibraryViewModel

    private var presentation: FontCardPresentation {
        switch model.viewMode {
        case .compactGrid: .compact
        case .largeGrid: .large
        case .list: .strip
        case .stack: .expanded
        }
    }

    var body: some View {
        Group {
            if presentation == .expanded || presentation == .strip {
                LazyVStack(spacing: 12) {
                    cards
                }
            } else {
                LazyVGrid(
                    columns: [GridItem(
                        .adaptive(
                            minimum: presentation.width
                        ),
                        spacing: 12
                    )],
                    alignment: .leading,
                    spacing: 12
                ) {
                    cards
                }
            }
        }
        .id(presentation)
        .transition(.opacity)
        .animation(.easeInOut(duration: 0.18), value: presentation)
        .padding(10)
        .frame(maxWidth: presentation == .expanded
            ? presentation.width + 20
            : LibraryLayout.cardContainerMaxWidth)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var cards: some View {
        ForEach(model.families) { family in
            FontFamilyCardView(
                model: model,
                family: family,
                presentation: presentation
            )
            .frame(maxWidth: presentation == .expanded ? presentation.width : .infinity)
        }
    }
}
