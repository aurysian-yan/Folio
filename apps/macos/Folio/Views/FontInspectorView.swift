import AppKit
import SwiftUI

struct FontInspectorView: View {
    @Bindable var model: LibraryViewModel

    var body: some View {
        Group {
            if let family = model.selectedFamily, let face = model.selectedFace {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        header(family, face: face)
                        Divider()
                        preview(face)
                        if !face.axes.filter({ !$0.hidden }).isEmpty {
                            Divider()
                            axes(face)
                        }
                        Divider()
                        copySection(family, face: face)
                        Divider()
                        information(face)
                    }
                    .padding()
                }
            } else {
                ContentUnavailableView(
                    "选择字体",
                    systemImage: "character.cursor.ibeam",
                    description: Text("选择一个字族以查看详细信息")
                )
            }
        }
        .navigationTitle("字体检查器")
    }

    private func header(_ family: FamilyCard, face: FaceSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(family.displayName)
                .font(.title2.weight(.semibold))
            Picker("字款", selection: Binding(
                get: { face.id },
                set: { id in
                    if let selected = family.faces.first(where: { $0.id == id }) {
                        model.selectFace(selected)
                    }
                }
            )) {
                ForEach(family.faces) { item in
                    Text(item.styleName).tag(item.id)
                }
            }
            .labelsHidden()

            LabeledContent("版本", value: face.version ?? "未知")
            LabeledContent("文件大小", value: ByteCountFormatter.string(fromByteCount: Int64(face.fileSize), countStyle: .file))

            HStack {
                Button("在 Finder 中显示", systemImage: "folder") {
                    model.revealSelectedFace()
                }
                .disabled(face.sourcePath == nil)
                Button("删除", systemImage: "trash", role: .destructive) {}
                    .disabled(true)
                    .help("删除将在文件管理语义确定后提供")
            }
        }
    }

    private func preview(_ face: FaceSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("预览")
                .font(.headline)
            FontPreviewView(
                text: "Aa Bb Cc\n0123456789",
                face: face,
                size: 36,
                color: model.previewColor,
                axes: model.axisValues
            )
            .frame(maxWidth: .infinity, minHeight: 100)
            .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func axes(_ face: FaceSummary) -> some View {
        let visibleAxes = face.axes.filter { !$0.hidden }
        return VStack(alignment: .leading, spacing: 12) {
            Text("可变轴")
                .font(.headline)
            ForEach(visibleAxes, id: \.tag) { axis in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(axis.name)
                        Spacer()
                        Text(model.axisValues[axis.tag, default: axis.defaultValue].formatted(.number.precision(.fractionLength(0...2))))
                            .monospacedDigit()
                    }
                    Slider(
                        value: Binding(
                            get: { model.axisValues[axis.tag, default: axis.defaultValue] },
                            set: { model.axisValues[axis.tag] = $0 }
                        ),
                        in: axis.minimum...axis.maximum
                    )
                    .accessibilityLabel(axis.name)
                    .accessibilityValue(model.axisValues[axis.tag, default: axis.defaultValue].formatted(.number.precision(.fractionLength(0...2))))
                    .sliderHaptics(
                        value: model.axisValues[axis.tag, default: axis.defaultValue],
                        in: axis.minimum...axis.maximum
                    )
                }
            }
        }
    }

    private func copySection(_ family: FamilyCard, face: FaceSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("复制为")
                .font(.headline)
            HStack {
                Button("字族名") { model.copy(family.displayName) }
                Button("PostScript 名称") { model.copy(face.postScriptName) }
                    .disabled(face.postScriptName == nil)
            }
            HStack {
                Button("CSS") {}
                Button("SwiftUI") {}
                Button("Figma") {}
            }
            .disabled(true)
            .help("代码格式将在生成规则确定后提供")
        }
    }

    private func information(_ face: FaceSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("字体信息")
                .font(.headline)
            LabeledContent("格式", value: face.format)
            LabeledContent("字款", value: face.styleName)
            LabeledContent("厂牌", value: face.manufacturer ?? "未知")
            LabeledContent("许可", value: face.license)
            LabeledContent("文字系统", value: face.scripts.isEmpty ? "未知" : face.scripts.joined(separator: "、"))
            if let path = face.sourcePath {
                LabeledContent("文件") {
                    Text(URL(fileURLWithPath: path).lastPathComponent)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
    }
}
