import SwiftUI

/// 胶囊玻璃分段控件：用于工具栏之外的分页切换，外观对齐系统工具栏分段控件。
/// macOS 26 及以上使用 Liquid Glass，选中项为内部浅胶囊；更早系统回退到系统分段 Picker。
struct GlassTabPicker<Value: Hashable>: View {
    struct Option: Identifiable {
        let value: Value
        let title: String

        var id: Value { value }
    }

    let title: String
    let options: [Option]
    @Binding var selection: Value

    @Namespace private var selectionAnimation

    var body: some View {
        if #available(macOS 26.0, *) {
            glassBody
                .accessibilityRepresentation { representation }
        } else {
            representation
                .pickerStyle(.segmented)
                .labelsHidden()
        }
    }

    @available(macOS 26.0, *)
    private var glassBody: some View {
        HStack(spacing: 2) {
            ForEach(options) { option in
                segment(option)
            }
        }
        .padding(3)
        .glassEffect(.regular.interactive(), in: .capsule)
    }

    @available(macOS 26.0, *)
    private func segment(_ option: Option) -> some View {
        let isSelected = selection == option.value
        return Button {
            withAnimation(.smooth(duration: 0.28)) {
                selection = option.value
            }
        } label: {
            Text(option.title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(isSelected ? Color.primary : Color.secondary)
                .padding(.horizontal, 14)
                .padding(.vertical, 3)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .background {
            if isSelected {
                Capsule()
                    .fill(Color.primary.opacity(0.1))
                    .overlay {
                        Capsule().strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5)
                    }
                    .matchedGeometryEffect(id: "selection", in: selectionAnimation)
            }
        }
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var representation: some View {
        Picker(title, selection: $selection) {
            ForEach(options) { option in
                Text(option.title).tag(option.value)
            }
        }
    }
}
