import SwiftUI

struct LibraryListView: View {
    @Bindable var model: LibraryViewModel
    @Environment(\.folioThemeColor) private var themeColor

    var body: some View {
        Table(model.families, selection: $model.selectedFamilyID) {
            TableColumn("预览") { family in
                FontPreviewView(
                    text: model.previewText,
                    face: family.defaultFace,
                    size: min(model.previewSize, 28),
                    color: model.previewColor,
                    axes: [:],
                    alignment: .left
                )
                .frame(height: 34)
                .onAppear { model.loadMoreIfNeeded(current: family) }
            }
            .width(min: 110, ideal: 160)

            TableColumn("字族") { family in
                Text(family.displayName)
                    .lineLimit(1)
            }
            .width(min: 120, ideal: 180)

            TableColumn("字款") { family in
                Text(family.faces.count, format: .number)
            }
            .width(50)

            TableColumn("可变") { family in
                Image.englishSystemName(family.isVariable ? "checkmark" : "minus")
                    .foregroundStyle(family.isVariable ? themeColor : Color.secondary)
                    .accessibilityLabel(family.isVariable ? "可变字体" : "非可变字体")
            }
            .width(50)

            TableColumn("厂牌") { family in
                Text(family.manufacturer ?? "—")
                    .lineLimit(1)
                    .foregroundStyle(.secondary)
            }
            .width(min: 100, ideal: 160)
        }
        .onChange(of: model.selectedFamilyID) { _, id in
            guard let id, let family = model.families.first(where: { $0.id == id }) else { return }
            model.selectFamily(family)
        }
    }
}
