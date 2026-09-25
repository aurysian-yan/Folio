import AppKit
import SwiftUI

struct SidebarView: View {
    @Bindable var model: LibraryViewModel
    @State private var cloud = CloudSyncModel.shared
    @State private var dismissedSyncError: String?
    @State private var isRenamingCloud = false
    @State private var cloudNameDraft = ""
    @Environment(\.folioThemeColor) private var themeColor

    var body: some View {
        List(selection: $model.selectedDestination) {
            Section {
                sidebarRow("全部字体", symbol: "textformat.alt", count: model.snapshot.familyCount, destination: .allFonts)
                    .tag(SidebarDestination.allFonts)
                sidebarRow("最近", symbol: "clock", count: model.snapshot.recentCount, destination: .recent)
                    .tag(SidebarDestination.recent)
                sidebarRow("收藏", symbol: "star", count: nil, destination: .favorites)
                    .tag(SidebarDestination.favorites)
            } header: {
                sidebarSectionHeader("本地")
            }

            Section {
                sidebarRow("已挂载", symbol: "checkmark.diamond", count: model.fontStateCounts[.active] ?? 0, destination: .fontState(.active))
                    .tag(SidebarDestination.fontState(.active))
                    .help("当前登录会话已激活")
                sidebarRow("已安装", symbol: "square.and.arrow.down", count: model.fontStateCounts[.installed] ?? 0, destination: .fontState(.installed), speed: 1.29)
                    .tag(SidebarDestination.fontState(.installed))
                    .help("包含手动安装和 Folio 安装的字体")
                sidebarRow("仅在字体库", symbol: "book.closed", count: model.fontStateCounts[.available] ?? 0, destination: .fontState(.available))
                    .tag(SidebarDestination.fontState(.available))
                    .help("Folio 字体库中尚未挂载或安装的副本")
                sidebarRow("外部文件", symbol: "doc", count: model.fontStateCounts[.external] ?? 0, destination: .fontState(.external))
                    .tag(SidebarDestination.fontState(.external))
                    .help("引用的文件和已添加文件夹中的字体")
                sidebarRow("系统字体", symbol: "laptopcomputer.and.arrow.down", count: model.fontStateCounts[.system] ?? 0, destination: .fontState(.system))
                    .tag(SidebarDestination.fontState(.system))
                sidebarRow("文件不可用", symbol: "exclamationmark.triangle", count: model.fontStateCounts[.unavailable] ?? 0, destination: .fontState(.unavailable))
                    .tag(SidebarDestination.fontState(.unavailable))
            } header: {
                sidebarSectionHeader("字体状态")
            }

            Section {
                Label {
                    Text("在线字体")
                } icon: {
                    Image.englishSystemName("globe")
                }
                    .foregroundStyle(.tertiary)
                    .help("在线字体将在后续版本提供")
                sidebarRow("字体健康", symbol: "stethoscope", count: UInt64(healthCount), destination: .fontHealth)
                    .tag(SidebarDestination.fontHealth)
            } header: {
                sidebarSectionHeader("工具")
            }

            Section {
                ForEach(model.snapshot.collections) { collection in
                    sidebarRow(
                        collection.name,
                        symbol: collection.icon.symbolName,
                        count: collection.memberCount,
                        destination: .collection(collection.id),
                        symbolColor: collection.color.color
                    )
                        .tag(SidebarDestination.collection(collection.id))
                        .contextMenu {
                            Button("编辑收藏夹…") {
                                model.collectionEditor = .edit(collection)
                            }
                            Button("删除收藏夹", role: .destructive) {
                                model.deleteCollection(collection)
                            }
                        }
                }
                Button {
                    model.collectionEditor = .create
                } label: {
                    HStack(spacing: 8) {
                        Image.englishSystemName("plus")
                            .foregroundStyle(Color.secondary)
                        Text("新收藏夹")
                            .foregroundStyle(Color.secondary)
                    }
                }
                .buttonStyle(.plain)
            } header: {
                sidebarSectionHeader("收藏夹")
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            cloudFooter
        }
        .background(SidebarSelectionHighlightController())
        .environment(\.appearsActive, true)
        .navigationTitle("Folio")
    }

    private var cloudFooter: some View {
        let isSelected = model.selectedDestination == .cloudFonts
        return VStack(alignment: .leading, spacing: 8) {
            sidebarSectionHeader("云端")
                .padding(.horizontal, 16)
            Button {
                model.selectedDestination = .cloudFonts
            } label: {
                sidebarRowContent(
                    cloud.connectionName,
                    symbol: "externaldrive.connected.to.line.below",
                    count: cloud.isConnected ? UInt64(cloud.fonts.filter { !$0.deleted }.count) : nil,
                    destination: .cloudFonts,
                    showsDisclosure: true
                )
                .padding(.horizontal, 12)
                .frame(height: 28)
                .contentShape(Rectangle())
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(isSelected ? themeColor : .clear)
                )
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 10)
            .contextMenu {
                if cloud.isConnected {
                    Button("重命名…") {
                        cloudNameDraft = cloud.connectionName
                        isRenamingCloud = true
                    }
                }
            }

            if cloud.isConnected {
                if cloud.isRunning {
                    ProgressView()
                        .progressViewStyle(.linear)
                        .tint(themeColor)
                        .padding(.horizontal, 10)
                }
                HStack {
                    Text("字体占用")
                    Spacer()
                    Text(ByteCountFormatter.string(fromByteCount: Int64(clamping: cloud.fonts.filter { !$0.deleted }.reduce(0) { $0 + $1.fileSize }), countStyle: .file))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 16)
            }

            if cloud.isRunning {
                Text("已上传 \(cloud.status?.uploadedFiles ?? 0) 个 · 已下载 \(cloud.status?.downloadedFiles ?? 0) 个")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
            } else if let error = cloud.status?.errorMessage, error != dismissedSyncError {
                HStack(alignment: .top, spacing: 8) {
                    Image.englishSystemName("exclamationmark.icloud.fill")
                        .foregroundStyle(.orange)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(cloud.status?.phase == "已取消" ? "同步已取消" : "同步未完成")
                            .fontWeight(.medium)
                        Button {
                            cloud.syncNow()
                        } label: {
                            HStack(spacing: 2) {
                                Text("立即同步")
                                Image.englishSystemName("chevron.right")
                            }
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.orange)
                    }
                    Spacer(minLength: 0)
                    Button {
                        dismissedSyncError = error
                    } label: {
                        Image.englishSystemName("xmark")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.tertiary)
                    .accessibilityLabel("关闭同步提示")
                }
                .font(.caption)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
                .padding(.horizontal, 10)
            } else if !cloud.conflicts.isEmpty {
                Button("\(cloud.conflicts.count) 个同步冲突待处理") {
                    model.selectedDestination = .cloudFonts
                }
                .buttonStyle(.link)
                .font(.caption)
                .padding(.horizontal, 16)
            }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .alert("重命名云端", isPresented: $isRenamingCloud) {
            TextField("名称", text: $cloudNameDraft)
            Button("取消", role: .cancel) {}
            Button("保存") { cloud.renameConnection(cloudNameDraft) }
        } message: {
            Text("留空则显示服务器名称。")
        }
    }

    private var healthCount: Int {
        let health = model.snapshot.health
        return Int(health.damagedFiles + health.multipleRevisions + health.metadataConflicts)
    }

    private func sidebarSectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
    }

    private func sidebarRow(
        _ title: String,
        symbol: String,
        count: UInt64?,
        destination: SidebarDestination,
        speed: Double = 0.76,
        symbolColor: Color? = nil
    ) -> some View {
        let isSelected = model.selectedDestination == destination
        return sidebarRowContent(
            title,
            symbol: symbol,
            count: count,
            destination: destination,
            speed: speed,
            symbolColor: symbolColor
        )
        .listRowBackground(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(isSelected ? themeColor : .clear)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
        )
    }

    private func sidebarRowContent(
        _ title: String,
        symbol: String,
        count: UInt64?,
        destination: SidebarDestination,
        speed: Double = 0.76,
        symbolColor: Color? = nil,
        showsDisclosure: Bool = false
    ) -> some View {
        let isSelected = model.selectedDestination == destination
        let symbolScale = destination == .cloudFonts ? 1.25 : 1.0
        return HStack {
            Label {
                Text(title)
                    .lineLimit(1)
                    .foregroundStyle(isSelected ? Color.white : Color.primary)
            } icon: {
                if let symbolColor {
                    SidebarSymbolIcon(
                        symbol: symbol,
                        isSelected: isSelected,
                        speed: speed
                    )
                    .foregroundStyle(isSelected ? .white : symbolColor)
                    .scaleEffect(symbolScale)
                } else {
                    SidebarSymbolIcon(
                        symbol: symbol,
                        isSelected: isSelected,
                        speed: speed
                    )
                    .foregroundStyle(isSelected ? .white : themeColor)
                    .scaleEffect(symbolScale)
                }
            }
            Spacer()
            if let count {
                Text(count, format: .number)
                    .foregroundStyle(isSelected ? Color.white.opacity(0.88) : Color.secondary)
                    .monospacedDigit()
            }
            if showsDisclosure {
                Image.englishSystemName("chevron.right")
                    .font(.caption)
                    .foregroundStyle(isSelected ? Color.white.opacity(0.88) : Color.secondary)
            }
        }
    }
}

private struct SidebarSelectionHighlightController: NSViewRepresentable {
    func makeNSView(context: Context) -> SidebarSelectionHighlightView {
        SidebarSelectionHighlightView()
    }

    func updateNSView(_ view: SidebarSelectionHighlightView, context: Context) {
        view.updateSelectionHighlight()
    }
}

private final class SidebarSelectionHighlightView: NSView {
    private weak var sidebar: NSOutlineView?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        sidebar = nil
        updateSelectionHighlight()
    }

    func updateSelectionHighlight() {
        DispatchQueue.main.async { [weak self] in
            guard let self, let contentView = self.window?.contentView else { return }
            let outline = self.sidebar ?? self.findSidebar(in: contentView)
            self.sidebar = outline
            if let outline, outline.selectionHighlightStyle != .none {
                outline.selectionHighlightStyle = .none
            }
        }
    }

    private func findSidebar(in view: NSView) -> NSOutlineView? {
        if let outline = view as? NSOutlineView, outline.style == .sourceList {
            return outline
        }
        for subview in view.subviews {
            if let outline = findSidebar(in: subview) {
                return outline
            }
        }
        return nil
    }
}

/// 侧栏图标：切换到该项时先播消失动画，再紧接着用绘制动画出现。
/// 绘制效果需要 macOS 26，旧系统与减弱动态效果下直接显示静态图标。
private struct SidebarSymbolIcon: View {
    let symbol: String
    let isSelected: Bool
    var speed: Double = 0.63

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isVisible = true

    var body: some View {
        ZStack {
            Image.englishSystemName(symbol)
                .opacity(0)
            icon
        }
        .onChange(of: isSelected) { _, selected in
            guard selected else { return }
            replay()
        }
    }

    @ViewBuilder
    private var icon: some View {
        if #available(macOS 26.0, *) {
            if isVisible {
                Image.englishSystemName(symbol)
                    .transition(AnyTransition.asymmetric(
                        insertion: AnyTransition(.symbolEffect(.drawOn, options: .speed(speed))),
                        removal: AnyTransition(.symbolEffect(.disappear, options: .speed(speed)))
                    ))
            }
        } else {
            Image.englishSystemName(symbol)
        }
    }

    private func replay() {
        guard #available(macOS 26.0, *), !reduceMotion else { return }
        withAnimation(.easeOut(duration: 0.33), completionCriteria: .removed) {
            isVisible = false
        } completion: {
            withAnimation(.easeIn(duration: 0.48)) {
                isVisible = true
            }
        }
    }
}

#if DEBUG
#Preview("侧边栏") {
    @Previewable @State var model = SidebarPreviewModel.make()
    SidebarView(model: model)
        .frame(width: 240, height: 720)
}

@MainActor
private enum SidebarPreviewModel {
    static func make() -> LibraryViewModel {
        let model = LibraryViewModel()
        model.snapshot = LibrarySnapshot(
            familyCount: 463,
            faceCount: 812,
            variableFamilyCount: 96,
            recentCount: 12,
            collections: [
                CollectionSummary(id: CollectionID(rawValue: "sans"), name: "无衬线", icon: .type, color: .blue, memberCount: 24),
                CollectionSummary(id: CollectionID(rawValue: "serif"), name: "衬线", icon: .books, color: .purple, memberCount: 18)
            ],
            roots: [],
            health: HealthSummary(
                damagedFiles: 1,
                duplicateSources: 0,
                multipleRevisions: 2,
                metadataConflicts: 0
            )
        )
        model.fontStateCounts = [
            .active: 128,
            .installed: 210,
            .available: 96,
            .external: 18,
            .system: 11,
            .unavailable: 2
        ]
        return model
    }
}
#endif
