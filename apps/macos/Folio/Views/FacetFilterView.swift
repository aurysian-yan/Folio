import SwiftUI

struct FacetFilterView: View {
    @Bindable var model: LibraryViewModel

    var body: some View {
        DisclosureGroup(isExpanded: $model.filterExpanded) {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(FacetKind.allCases, id: \.self) { kind in
                    let options = model.facetOptions.filter { $0.kind == kind }
                    if !options.isEmpty {
                        HStack(spacing: 8) {
                            Text(kind.title)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(.secondary)
                                .frame(width: 60, alignment: .leading)
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 4) {
                                    ForEach(options) { option in
                                        facetButton(option)
                                    }
                                }
                            }
                            .frame(minWidth: 0, maxWidth: .infinity)
                            .fixedSize(horizontal: false, vertical: true)
                            .clipped()
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 24)
                    }
                }
            }
            .padding(.top, 8)
        } label: {
            Text("按分类筛选字体")
                .font(.headline)
        }
        .frame(maxWidth: 648)
    }

    private func facetButton(_ option: FacetOption) -> some View {
        let selected = model.selectedFacets.contains(option)
        return Button {
            model.toggleFacet(option)
        } label: {
            HStack(spacing: 0) {
                if selected {
                    Image.englishSystemName("checkmark")
                        .font(.system(size: 8, weight: .medium))
                        .frame(width: 24)
                }
                Text(option.label)
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(1)
                Text(option.familyCount, format: .number)
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .opacity(0.75)
                    .padding(.leading, 4)
            }
            .foregroundStyle(selected ? Color.white : Color.primary)
            .padding(.leading, selected ? 0 : 7)
            .padding(.trailing, selected ? 6 : 7)
            .frame(height: 24)
            .fixedSize(horizontal: true, vertical: false)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(Color(red: 0, green: 136 / 255, blue: 1))
                } else {
                    ZStack {
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(.ultraThickMaterial)
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(Color.primary.opacity(0.07))
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(option.label)，\(option.familyCount) 个字族")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
