import AppKit
import SwiftUI

enum SidebarPage: String, CaseIterable, Identifiable {
    case navigation
    case filters

    var id: String { rawValue }

    var title: String {
        switch self {
        case .navigation: "导航"
        case .filters: "筛选"
        }
    }

    var symbolName: String {
        switch self {
        case .navigation: "location"
        case .filters: "line.3.horizontal.decrease"
        }
    }
}

struct SidebarView: View {
    @Bindable var model: LibraryViewModel
    @Binding var selectedPage: SidebarPage
    @State private var cloud = CloudSyncModel.shared
    @State private var dismissedCloudStatusKey: String?
    @State private var isRenamingCloud = false
    @State private var cloudNameDraft = ""
    @Environment(\.folioThemeColor) private var themeColor

    /// 切换侧栏分页。
    private func selectPage(_ page: SidebarPage) {
        guard page != selectedPage else { return }
        selectedPage = page
    }

    /// 侧栏分页切换控件；放进侧栏列工具栏，使用系统原生的玻璃分段样式。
    private var sidebarPagePicker: some View {
        Picker("侧边栏分类", selection: sidebarPageSelection) {
            ForEach(SidebarPage.allCases) { page in
                Image.englishSystemName(page.symbolName)
                    .accessibilityLabel(page.title)
                    .tag(page)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(width: 76)
    }

    private var sidebarPageSelection: Binding<SidebarPage> {
        Binding(
            get: { selectedPage },
            set: { selectPage($0) }
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            sidebarPageContent
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            cloudSyncStatus
        }
        .environment(\.appearsActive, true)
        .navigationTitle("Folio")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                sidebarPagePicker
            }
        }
        .onAppear {
            selectedPage = .navigation
        }
        .onChange(of: model.selectedDestination) { _, _ in
            guard selectedPage != .navigation else { return }
            selectPage(.navigation)
        }
        .onChange(of: transientCloudStatusKey) { _, statusKey in
            if statusKey != dismissedCloudStatusKey {
                dismissedCloudStatusKey = nil
            }
        }
        .alert("重命名云端", isPresented: $isRenamingCloud) {
            TextField("名称", text: $cloudNameDraft)
            Button("取消", role: .cancel) {}
            Button("保存") { cloud.renameConnection(cloudNameDraft) }
        } message: {
            Text("留空则显示服务器名称。")
        }
    }

    /// 侧栏分页内容：同一时刻只渲染当前页。
    private var sidebarPageContent: some View {
        sidebarList(for: selectedPage)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func sidebarList(for page: SidebarPage) -> some View {
        List(selection: $model.selectedDestination) {
            switch page {
            case .navigation:
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
                    ForEach(model.snapshot.smartFolders) { folder in
                        sidebarRow(
                            folder.name,
                            symbol: folder.icon.symbolName,
                            count: folder.matchCount,
                            destination: .smartFolder(folder.id),
                            symbolColor: folder.color.color,
                            trailingSymbol: "sparkles.2"
                        )
                        .tag(SidebarDestination.smartFolder(folder.id))
                        .contextMenu {
                            Button("编辑收藏夹…") {
                                model.favoriteFolderEditor = .editSmartFolder(folder)
                            }
                            Button("删除收藏夹", role: .destructive) {
                                model.deleteSmartFolder(folder)
                            }
                        }
                    }
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
                                model.favoriteFolderEditor = .editCollection(collection)
                            }
                            Button("删除收藏夹", role: .destructive) {
                                model.deleteCollection(collection)
                            }
                        }
                    }
                    Button {
                        model.beginFavoriteFolderCreation()
                    } label: {
                        HStack {
                            Label {
                                Text("新建收藏夹")
                                    .foregroundStyle(Color.secondary)
                            } icon: {
                                Image.englishSystemName("plus")
                                    .foregroundStyle(Color.secondary)
                            }
                            Spacer()
                        }
                    }
                    .buttonStyle(.plain)
                } header: {
                    sidebarSectionHeader("收藏夹")
                }
                Section {
                    cloudSidebarRowContent(isSelected: model.selectedDestination == .cloudFonts)
                        .listRowBackground(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(model.selectedDestination == .cloudFonts ? themeColor : .clear)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 2)
                        )
                        .tag(SidebarDestination.cloudFonts)
                        .contextMenu {
                            if cloud.isConnected {
                                Button("重命名…") {
                                    cloudNameDraft = cloud.connectionName
                                    isRenamingCloud = true
                                }
                            }
                        }
                } header: {
                    sidebarSectionHeader("云端")
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
                    sidebarRow("在线字体", symbol: "globe", count: nil, destination: .onlineFonts)
                        .tag(SidebarDestination.onlineFonts)
                    sidebarRow("字体健康", symbol: "stethoscope", count: UInt64(healthCount), destination: .fontHealth)
                        .tag(SidebarDestination.fontHealth)
                } header: {
                    sidebarSectionHeader("工具")
                }
            case .filters:
                Section {
                    ForEach(FacetKind.allCases, id: \.self) { kind in
                        let options = model.facetOptions.filter { $0.kind == kind }
                        if !options.isEmpty {
                            FacetDisclosureGroupView(
                                kind: kind,
                                options: options,
                                selectedFacets: model.selectedFacets,
                                animatesExpansion: false,
                                onToggle: model.toggleFacet
                            )
                            .listRowInsets(EdgeInsets(
                                top: 2,
                                leading: -SidebarLayoutMetrics.sidebarRowExpansion,
                                bottom: 2,
                                trailing: -SidebarLayoutMetrics.sidebarRowExpansion
                            ))
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.clear)
                        }
                    }
                } header: {
                    sidebarSectionHeader("筛选")
                }
            }
        }
        .listStyle(.sidebar)
        .background(SidebarSelectionHighlightController())
    }

    private var healthCount: Int {
        let health = model.snapshot.health
        return Int(health.damagedFiles + health.multipleRevisions + health.metadataConflicts)
    }

    private var cloudFontStorage: String {
        ByteCountFormatter.string(
            fromByteCount: Int64(clamping: cloud.fonts.filter { !$0.deleted }.reduce(0) { $0 + $1.fileSize }),
            countStyle: .file
        )
    }

    private var transientCloudStatusKey: String? {
        if cloud.isRunning {
            return "running"
        }
        if let errorMessage = cloud.status?.errorMessage {
            return "error|\(cloud.status?.phase ?? "")|\(errorMessage)"
        }
        if cloud.isConnected, !cloud.conflicts.isEmpty {
            return "conflicts|\(cloud.conflicts.map(\.id).sorted().joined(separator: "|"))"
        }
        return nil
    }

    @ViewBuilder
    private var cloudSyncStatus: some View {
        if let statusKey = transientCloudStatusKey, statusKey != dismissedCloudStatusKey {
            if cloud.isRunning {
                cloudStatusCard(
                    icon: nil,
                    iconColor: themeColor,
                    title: "正在同步",
                    onDismiss: { dismissedCloudStatusKey = statusKey }
                ) {
                    Text("上传 \(cloud.status?.uploadedFiles ?? 0) 个 · 下载 \(cloud.status?.downloadedFiles ?? 0) 个")
                        .foregroundStyle(themeColor)
                }
            } else if cloud.status?.errorMessage != nil {
                cloudStatusCard(
                    icon: "exclamationmark.icloud.fill",
                    iconColor: .orange,
                    title: cloud.status?.phase == "已取消" ? "同步已取消" : "同步未完成",
                    onDismiss: { dismissedCloudStatusKey = statusKey }
                ) {
                    Button {
                        cloud.syncNow()
                    } label: {
                        syncActionLabel("立即同步")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.orange)
                }
            } else if cloud.isConnected, !cloud.conflicts.isEmpty {
                cloudStatusCard(
                    icon: "exclamationmark.icloud.fill",
                    iconColor: .orange,
                    title: "\(cloud.conflicts.count) 个同步冲突待处理",
                    onDismiss: { dismissedCloudStatusKey = statusKey }
                ) {
                    Button {
                        model.selectedDestination = .cloudFonts
                    } label: {
                        syncActionLabel("查看冲突")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.orange)
                }
            }
        } else if cloud.isConnected {
            cloudStatusCard(
                icon: "checkmark.icloud.fill",
                iconColor: themeColor,
                title: "本地与云端均为最新"
            ) {
                Button {
                    cloud.syncNow()
                } label: {
                    syncActionLabel("立即同步")
                }
                .buttonStyle(.plain)
                .foregroundStyle(themeColor)
            }
        } else {
            cloudStatusCard(icon: "icloud", iconColor: .secondary, title: "未连接云端") {
                Text("在设置中连接 WebDAV")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func syncActionLabel(_ title: String) -> some View {
        HStack(spacing: 2) {
            Text(title)
            Image.englishSystemName("chevron.right")
                .font(.system(size: 10, weight: .semibold))
        }
    }

    private func cloudStatusCard<Detail: View>(
        icon: String?,
        iconColor: Color,
        title: String,
        onDismiss: (() -> Void)? = nil,
        @ViewBuilder detail: () -> Detail
    ) -> some View {
        let card = HStack(alignment: .center, spacing: 8) {
            Group {
                if let icon {
                    Image.englishSystemName(icon)
                        .font(.system(size: 14))
                        .foregroundStyle(iconColor)
                        .accessibilityHidden(true)
                } else {
                    RingSyncProgressView(tint: iconColor)
                }
            }
            .frame(width: 22, height: 22)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                detail()
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let onDismiss {
                Button(action: onDismiss) {
                    Image.englishSystemName("xmark")
                        .font(.system(size: 12, weight: .regular))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.tertiary)
                .accessibilityLabel("关闭同步状态")
            }
        }
        .frame(height: 35)
        .padding(.leading, 8)
        .padding(.trailing, 14)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)

        return Group {
            if #available(macOS 26.0, *) {
                card.glassEffect(
                    .regular,
                    in: RoundedRectangle(cornerRadius: SidebarLayoutMetrics.cardCornerRadius, style: .continuous)
                )
            } else {
                card
                    .background(
                        .ultraThinMaterial,
                        in: RoundedRectangle(cornerRadius: SidebarLayoutMetrics.cardCornerRadius, style: .continuous)
                    )
                    .overlay {
                        RoundedRectangle(cornerRadius: SidebarLayoutMetrics.cardCornerRadius, style: .continuous)
                            .strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5)
                    }
            }
        }
        .padding(.horizontal, SidebarLayoutMetrics.cardHorizontalInset)
        .padding(.vertical, 8)
    }

    private func cloudSidebarRowContent(isSelected: Bool) -> some View {
        HStack(alignment: .center, spacing: 8) {
            AnimatedSymbolIcon(
                symbol: "externaldrive.connected.to.line.below",
                isSelected: isSelected
            )
            .foregroundStyle(isSelected ? Color.white : themeColor)
            .scaleEffect(1.25)
            .frame(width: 22, height: 22)
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(cloud.connectionName)
                    .lineLimit(1)
                    .foregroundStyle(isSelected ? Color.white : Color.primary)
                if cloud.isConnected {
                    Text("字体占用 \(cloudFontStorage)")
                        .font(.system(size: 12))
                        .foregroundStyle(isSelected ? Color.white.opacity(0.88) : Color.secondary)
                }
            }

            Spacer(minLength: 0)
            if cloud.isConnected {
                Text(cloud.fonts.filter { !$0.deleted }.count, format: .number)
                    .foregroundStyle(isSelected ? Color.white.opacity(0.88) : Color.secondary)
                    .monospacedDigit()
            }
        }
        .accessibilityElement(children: .combine)
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
        symbolColor: Color? = nil,
        trailingSymbol: String? = nil
    ) -> some View {
        let isSelected = model.selectedDestination == destination
        return sidebarRowContent(
            title,
            symbol: symbol,
            count: count,
            destination: destination,
            speed: speed,
            symbolColor: symbolColor,
            trailingSymbol: trailingSymbol
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
        trailingSymbol: String? = nil
    ) -> some View {
        let isSelected = model.selectedDestination == destination
        let symbolScale = destination == .cloudFonts ? 1.25 : 1.0
        return HStack {
            Label {
                HStack(spacing: 4) {
                    Text(title)
                        .lineLimit(1)
                    if let trailingSymbol {
                        Image.englishSystemName(trailingSymbol)
                            .font(.caption2)
                            .accessibilityLabel("智慧收藏夹")
                    }
                }
                .foregroundStyle(isSelected ? Color.white : Color.primary)
            } icon: {
                if let symbolColor {
                    AnimatedSymbolIcon(
                        symbol: symbol,
                        isSelected: isSelected,
                        speed: speed
                    )
                    .foregroundStyle(isSelected ? .white : symbolColor)
                    .scaleEffect(symbolScale)
                } else {
                    AnimatedSymbolIcon(
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
        }
    }
}

private struct RingSyncProgressView: View {
    let tint: Color
    @State private var rotation = 0.0

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.secondary.opacity(0.24), lineWidth: 2)
            Circle()
                .trim(from: 0, to: 0.27)
                .stroke(tint, style: StrokeStyle(lineWidth: 2.4, lineCap: .round))
                .rotationEffect(.degrees(rotation - 90))
        }
        .frame(width: 14, height: 14)
        .accessibilityHidden(true)
        .onAppear {
            withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                rotation = 360
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
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        updateSelectionHighlight()
    }

    func updateSelectionHighlight() {
        DispatchQueue.main.async { [weak self] in
            guard let self, let contentView = self.window?.contentView else { return }
            for sidebar in self.findSidebars(in: contentView) where sidebar.selectionHighlightStyle != .none {
                sidebar.selectionHighlightStyle = .none
            }
        }
    }

    private func findSidebars(in view: NSView) -> [NSOutlineView] {
        if let outline = view as? NSOutlineView, outline.style == .sourceList {
            return [outline]
        }
        return view.subviews.flatMap(findSidebars(in:))
    }
}

#if DEBUG
#Preview("侧边栏") {
    @Previewable @State var model = SidebarPreviewModel.make()
    @Previewable @State var selectedPage = SidebarPage.navigation
    SidebarView(model: model, selectedPage: $selectedPage)
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
            smartFolders: [
                SmartFolderSummary(
                    id: SmartFolderID(rawValue: "variable"),
                    name: "可变字体",
                    icon: .type,
                    color: .blue,
                    matchCount: 96
                )
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
