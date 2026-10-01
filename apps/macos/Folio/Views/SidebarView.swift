import AppKit
import SwiftUI

enum SidebarPage: String, CaseIterable, Identifiable {
    case navigation
    case filters

    var id: String { rawValue }

    var title: String {
        switch self {
        case .navigation: L.text("navigation.navigation")
        case .filters: L.text("navigation.filters")
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
        Picker(L.text("navigation.sidebarCategory"), selection: sidebarPageSelection) {
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
        .alert(L.text("cloud.renameConnection"), isPresented: $isRenamingCloud) {
            TextField(L.text("common.name"), text: $cloudNameDraft)
            Button(L.text("common.cancel"), role: .cancel) {}
            Button(L.text("common.save")) { cloud.renameConnection(cloudNameDraft) }
        } message: {
            Text(L.text("cloud.renameHint"))
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
                    sidebarRow(L.text("navigation.allFonts"), symbol: "textformat.alt", count: model.snapshot.familyCount, destination: .allFonts)
                        .tag(SidebarDestination.allFonts)
                    sidebarRow(L.text("navigation.recent"), symbol: "clock", count: model.snapshot.recentCount, destination: .recent)
                        .tag(SidebarDestination.recent)
                    sidebarRow(L.text("navigation.favorites"), symbol: "star", count: nil, destination: .favorites)
                        .tag(SidebarDestination.favorites)
                } header: {
                    sidebarSectionHeader(L.text("navigation.local"))
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
                            Button(L.text("collection.editEllipsis")) {
                                model.favoriteFolderEditor = .editSmartFolder(folder)
                            }
                            Button(L.text("collection.delete"), role: .destructive) {
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
                            Button(L.text("collection.editEllipsis")) {
                                model.favoriteFolderEditor = .editCollection(collection)
                            }
                            Button(L.text("collection.delete"), role: .destructive) {
                                model.deleteCollection(collection)
                            }
                        }
                    }
                    Button {
                        model.beginFavoriteFolderCreation()
                    } label: {
                        HStack {
                            Label {
                                Text(L.text("collection.new"))
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
                    sidebarSectionHeader(L.text("navigation.collections"))
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
                                Button(L.text("common.renameEllipsis")) {
                                    cloudNameDraft = cloud.connectionName
                                    isRenamingCloud = true
                                }
                            }
                        }
                } header: {
                    sidebarSectionHeader(L.text("navigation.cloud"))
                }
                Section {
                    sidebarRow(L.text("fontState.active"), symbol: "checkmark.diamond", count: model.fontStateCounts[.active] ?? 0, destination: .fontState(.active))
                        .tag(SidebarDestination.fontState(.active))
                        .help(L.text("fontState.helpActive"))
                    sidebarRow(L.text("fontState.installed"), symbol: "square.and.arrow.down", count: model.fontStateCounts[.installed] ?? 0, destination: .fontState(.installed), speed: 1.29)
                        .tag(SidebarDestination.fontState(.installed))
                        .help(L.text("fontState.helpInstalled"))
                    sidebarRow(L.text("fontState.available"), symbol: "book.closed", count: model.fontStateCounts[.available] ?? 0, destination: .fontState(.available))
                        .tag(SidebarDestination.fontState(.available))
                        .help(L.text("fontState.helpAvailable"))
                    sidebarRow(L.text("fontState.external"), symbol: "doc", count: model.fontStateCounts[.external] ?? 0, destination: .fontState(.external))
                        .tag(SidebarDestination.fontState(.external))
                        .help(L.text("fontState.helpExternal"))
                    sidebarRow(L.text("fontState.system"), symbol: "laptopcomputer.and.arrow.down", count: model.fontStateCounts[.system] ?? 0, destination: .fontState(.system))
                        .tag(SidebarDestination.fontState(.system))
                    sidebarRow(L.text("fontState.unavailable"), symbol: "exclamationmark.triangle", count: model.fontStateCounts[.unavailable] ?? 0, destination: .fontState(.unavailable))
                        .tag(SidebarDestination.fontState(.unavailable))
                } header: {
                    sidebarSectionHeader(L.text("navigation.fontState"))
                }
                Section {
                    sidebarRow(L.text("navigation.onlineFonts"), symbol: "globe", count: nil, destination: .onlineFonts)
                        .tag(SidebarDestination.onlineFonts)
                    sidebarRow(L.text("navigation.fontHealth"), symbol: "stethoscope", count: UInt64(healthCount), destination: .fontHealth)
                        .tag(SidebarDestination.fontHealth)
                } header: {
                    sidebarSectionHeader(L.text("navigation.tools"))
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
                    sidebarSectionHeader(L.text("filters.title"))
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

    private var runningSyncSummary: String {
        guard let status = cloud.status else { return L.text("cloud.syncing") }
        var parts = ["\(status.stage) \(status.stageCompleted)/\(status.stageTotal)"]
        if status.uploadedFiles > 0 { parts.append(L.format("cloud.uploadedCount", String(status.uploadedFiles))) }
        if status.downloadedFiles > 0 { parts.append(L.format("cloud.downloadedCount", String(status.downloadedFiles))) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var cloudSyncStatus: some View {
        if let statusKey = transientCloudStatusKey, statusKey != dismissedCloudStatusKey {
            if cloud.isRunning {
                cloudStatusCard(
                    icon: "arrow.triangle.2.circlepath",
                    iconColor: themeColor,
                    title: L.format("cloud.syncingPercent", String(cloud.status?.percent ?? 0)),
                    ringProgress: Double(cloud.status?.percent ?? 0) / 100,
                    onDismiss: { dismissedCloudStatusKey = statusKey }
                ) {
                    Text(runningSyncSummary)
                        .foregroundStyle(.secondary)
                }
            } else if cloud.status?.errorMessage != nil {
                cloudStatusCard(
                    icon: "exclamationmark.icloud.fill",
                    iconColor: .orange,
                    title: cloud.status?.phase == "已取消" ? L.text("cloud.syncCancelled") : L.text("cloud.syncIncomplete"),
                    onDismiss: { dismissedCloudStatusKey = statusKey }
                ) {
                    Button {
                        cloud.syncNow()
                    } label: {
                        syncActionLabel(L.text("cloud.syncNow"))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.orange)
                }
            } else if cloud.isConnected, !cloud.conflicts.isEmpty {
                cloudStatusCard(
                    icon: "exclamationmark.icloud.fill",
                    iconColor: .orange,
                    title: L.format("cloud.conflictsPendingShort", String(cloud.conflicts.count)),
                    onDismiss: { dismissedCloudStatusKey = statusKey }
                ) {
                    Button {
                        model.selectedDestination = .cloudFonts
                    } label: {
                        syncActionLabel(L.text("macos.viewConflicts"))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.orange)
                }
            }
        } else if cloud.isConnected {
            cloudStatusCard(
                icon: "checkmark.icloud.fill",
                iconColor: themeColor,
                title: L.text("cloud.allSynced")
            ) {
                Button {
                    cloud.syncNow()
                } label: {
                    syncActionLabel(L.text("cloud.syncNow"))
                }
                .buttonStyle(.plain)
                .foregroundStyle(themeColor)
            }
        } else {
            cloudStatusCard(icon: "icloud", iconColor: .secondary, title: L.text("cloud.notConnected")) {
                Text(L.text("cloud.connectInSettings"))
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
        icon: String,
        iconColor: Color,
        title: String,
        ringProgress: Double? = nil,
        onDismiss: (() -> Void)? = nil,
        @ViewBuilder detail: () -> Detail
    ) -> some View {
        let card = HStack(alignment: .center, spacing: 8) {
            Group {
                if let ringProgress {
                    RingSyncProgressView(
                        tint: iconColor,
                        progress: ringProgress,
                        size: 16,
                        lineWidth: 2
                    )
                } else {
                    Image.englishSystemName(icon)
                        .font(.system(size: 14))
                        .foregroundStyle(iconColor)
                        .accessibilityHidden(true)
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
                .accessibilityLabel(L.text("cloud.closeStatus"))
            }
        }
        .frame(minHeight: 35)
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
                    Text(L.format("cloud.fontUsage", cloudFontStorage))
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
                            .accessibilityLabel(L.text("navigation.smartCollections"))
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

struct RingSyncProgressView: View {
    let tint: Color
    let progress: Double
    var size: CGFloat = 20
    var lineWidth: CGFloat = 2.4
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.secondary.opacity(0.24), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: min(max(progress, 0), 1))
                .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: size, height: size)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: progress)
        .accessibilityHidden(true)
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
