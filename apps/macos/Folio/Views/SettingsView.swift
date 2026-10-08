@preconcurrency import AppKit
import SwiftUI

struct SettingsView: View {
    @State private var cloud = CloudSyncModel.shared
    @State private var selection: SettingsSection = .cloud
    @State private var draft = SettingsDraft()
    @State private var testingConnection = false
    @State private var testingMirror = false
    @State private var mirrorMessage: String?
    @State private var showResetConfirmation = false
    @State private var showSyncRebuildConfirmation = false
    @State private var storageUsage: StorageUsageDto?
    @State private var previewCacheBytes: UInt64?
    @State private var storageMessage: String?
    @State private var storageBusy = false
    @AppStorage(AppPreferences.selectCardsOnHover) private var selectCardsOnHover = true
    @AppStorage(AppPreferences.hoverSelectionHaptics) private var hoverSelectionHaptics = true
    @AppStorage(AppPreferences.sliderHaptics) private var sliderHaptics = true
    @AppStorage(AppPreferences.libraryViewMode) private var libraryViewMode =
        LibraryViewMode.compactGrid.rawValue
    @AppStorage(AppPreferences.previewSize) private var previewSize = 48.0
    @AppStorage(AppPreferences.expandedCardWheelSpeed) private var expandedCardWheelSpeed = 1.25
    @AppStorage(AppPreferences.askImportMode) private var askImportMode = false
    @AppStorage(AppPreferences.defaultImportMode) private var defaultImportMode = FontImportMode.copy.rawValue
    @AppStorage(AppPreferences.useCollectionThemeColor) private var useCollectionThemeColor = true
    @AppStorage(AppPreferences.defaultThemeColor) private var defaultThemeColor = DefaultThemeColor.folio.rawValue
    @AppStorage(AppPreferences.googleFontsMirrorTemplate) private var googleFontsMirrorTemplate = ""

    private var themeColor: Color {
        (DefaultThemeColor(rawValue: draft.defaultThemeColor) ?? .folio).color
    }

    /// 分页切换动画：平滑缓动、稍长时长，避免看起来生硬。
    private var pageAnimation: Animation {
        .smooth(duration: 0.45)
    }

    var body: some View {
        pager
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker(L.text("settings.category"), selection: pickerSelection) {
                        ForEach(SettingsSection.allCases) { section in
                            Text(section.title).tag(section)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
            }
            .tint(themeColor)
            .accentColor(themeColor)
            .frame(minWidth: 660, idealWidth: 700, minHeight: 520, idealHeight: 560)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                bottomBar
            }
            .confirmationDialog(
                L.text("settings.resetTitle"),
                isPresented: $showResetConfirmation
            ) {
                Button(L.text("settings.resetAction"), role: .destructive) { resetToDefaults() }
            } message: {
                Text(L.text("settings.resetMessage"))
            }
            .confirmationDialog(
                L.text("settings.rebuildTitle"),
                isPresented: $showSyncRebuildConfirmation
            ) {
                Button(L.text("settings.rebuildAction")) { rebuildSyncIndexes() }
            } message: {
                Text(L.text("settings.rebuildMessage"))
            }
            .onAppear {
                cloud.start()
                loadDraft()
                if UserDefaults.standard.string(forKey: "settings.requestedPage") == "about" {
                    selection = .about
                    UserDefaults.standard.removeObject(forKey: "settings.requestedPage")
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("FolioShowAbout"))) { _ in
                selection = .about
                UserDefaults.standard.removeObject(forKey: "settings.requestedPage")
            }
            .onChange(of: selection) { _, section in
                if section == .storage { loadStorageUsage() }
            }
    }

    /// 横向分页内容；分段控件与滑动共用同一个选中项，按页吸合。
    private var pager: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 0) {
                ForEach(SettingsSection.allCases) { section in
                    page(for: section)
                        .containerRelativeFrame([.horizontal, .vertical])
                        .id(section)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        .scrollIndicators(.never)
        .scrollPosition(id: scrollSelection)
        .background(ScrollWheelPager(onStep: step))
    }

    /// 滚轮/触控板按页离散切换，避免自由停在两页之间。
    private func step(_ direction: Int) {
        let sections = SettingsSection.allCases
        guard let index = sections.firstIndex(of: selection) else { return }
        let next = index + direction
        guard sections.indices.contains(next) else { return }
        withAnimation(pageAnimation) {
            selection = sections[next]
        }
    }

    /// 分段控件选择：带切换动画。
    private var pickerSelection: Binding<SettingsSection> {
        Binding(
            get: { selection },
            set: { section in
                withAnimation(pageAnimation) {
                    selection = section
                }
            }
        )
    }

    private var scrollSelection: Binding<SettingsSection?> {
        Binding(
            get: { selection },
            set: { value in
                guard let value else { return }
                selection = value
            }
        )
    }

    private var webDAVPresetSelection: Binding<WebDAVPreset> {
        Binding(
            get: { draft.webDAVPreset },
            set: { preset in
                draft.webDAVPreset = preset
                draft.serverURL = preset.serverURL ?? ""
            }
        )
    }

    private var bottomBar: some View {
        HStack(spacing: 12) {
            circleButton("arrow.counterclockwise", label: L.text("settings.resetAction")) {
                showResetConfirmation = true
            }
            Spacer()
            circleButton("xmark", label: L.text("common.cancel")) { closeWindow() }
                .keyboardShortcut(.cancelAction)
            circleButton("checkmark", label: L.text("common.ok"), filled: true) { commit() }
                .keyboardShortcut(.defaultAction)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(.bar)
    }

    /// 圆形图标按钮，使用应用主题色。
    private func circleButton(
        _ symbol: String,
        label: String,
        filled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image.englishSystemName(symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(filled ? Color.white : themeColor)
                .frame(width: 30, height: 30)
                .background(filled ? themeColor : themeColor.opacity(0.14), in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help(label)
        .accessibilityLabel(label)
    }

    private func page(for section: SettingsSection) -> some View {
        content(for: section)
            .padding(.top, 14)
    }

    @ViewBuilder
    private func content(for section: SettingsSection) -> some View {
        switch section {
        case .cloud: cloudForm
        case .onlineFonts: onlineFontsForm
        case .importing: importForm
        case .display: displayForm
        case .theme: themeForm
        case .cards: cardsForm
        case .storage: storageForm
        case .about: AboutView(isActive: selection == .about)
        }
    }

    private var cloudForm: some View {
        Form {
            Section {
                Picker(L.text("cloud.provider"), selection: webDAVPresetSelection) {
                    ForEach(WebDAVPreset.allCases) { preset in
                        Text(preset.title).tag(preset)
                    }
                }
                .pickerStyle(.segmented)
                TextField(L.text("cloud.serverURL"), text: $draft.serverURL, prompt: Text("https://"))
                    .textContentType(.URL)
                    .onChange(of: draft.serverURL) { _, serverURL in
                        draft.webDAVPreset = WebDAVPreset.matching(serverURL)
                    }
                TextField(L.text("cloud.remoteDirectory"), text: $draft.remoteDirectory)
                TextField(L.text("cloud.username"), text: $draft.username)
                SecureField(L.text("cloud.password"), text: $draft.password)
                Toggle(L.text("fontLocation.autoDownload"),isOn:Binding(get:{cloud.automaticDownload},set:{cloud.setAutomaticDownload($0)}))
                Text(L.text("fontLocation.autoDownloadHint")).font(.caption).foregroundStyle(.secondary)
                Toggle(L.text("cloud.autoSync"), isOn: $draft.automatic)
            } header: {
                Text(L.text("cloud.connection"))
            } footer: {
                Text(L.text("cloud.passwordInKeychain"))
            }

            Section {
                HStack(spacing: 10) {
                    Button(L.text("cloud.testConnection")) {
                        testingConnection = true
                        Task {
                            _ = await cloud.testConnection(
                                serverURL: draft.serverURL,
                                directory: draft.remoteDirectory,
                                username: draft.username,
                                password: draft.password
                            )
                            testingConnection = false
                        }
                    }
                    .disabled(testingConnection || draft.serverURL.isEmpty || draft.username.isEmpty)

                    if testingConnection {
                        ProgressView()
                            .controlSize(.small)
                            .accessibilityLabel(L.text("cloud.connecting"))
                    }
                    Spacer()
                }

                if let message = cloud.message {
                    Text(message)
                        .font(.callout)
                        .foregroundStyle(cloud.errorMessage == nil ? Color.secondary : Color.red)
                }
            } footer: {
                Text(L.text("cloud.saveConnectionHint"))
            }

            if cloud.isConnected {
                Section(L.text("cloud.syncStatus")) {
                    HStack(spacing: 10) {
                        Group {
                            if cloud.isRunning {
                                RingSyncProgressView(
                                    tint: themeColor,
                                    progress: Double(cloud.status?.percent ?? 0) / 100,
                                    size: 14,
                                    lineWidth: 2
                                )
                            } else {
                                Image.englishSystemName("checkmark.icloud")
                                    .foregroundStyle(Color.green)
                            }
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(cloud.isRunning ? L.format("cloud.syncingPercent", String(cloud.status?.percent ?? 0)) : L.format("cloud.connectedTo", cloud.connectionName))
                            if cloud.isRunning {
                                if let status = cloud.status {
                                    Text("\(status.stage) \(status.stageCompleted)/\(status.stageTotal) · \(L.format("cloud.uploadedCount", String(status.uploadedFiles))) · \(L.format("cloud.downloadedCount", String(status.downloadedFiles)))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            } else if let phase = cloud.status?.phase, !phase.isEmpty {
                                Text(phase)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                    }

                    HStack {
                        Button(cloud.isRunning ? L.text("cloud.cancelSync") : L.text("cloud.syncNow")) {
                            if cloud.isRunning { cloud.cancel() } else { cloud.syncNow() }
                        }
                        Spacer()
                        Button(L.text("cloud.disconnect"), role: .destructive) { cloud.disconnect() }
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    private var importForm: some View {
        Form {
            Section {
                Toggle(L.text("import.askEachTime"), isOn: $draft.askImportMode)
                Picker(L.text("import.defaultMode"), selection: $draft.defaultImportMode) {
                    ForEach(FontImportMode.allCases) { mode in
                        Text(mode.title).tag(mode.rawValue)
                    }
                }
                .disabled(draft.askImportMode)
            } footer: {
                Text(L.text("import.askDisabledHint"))
            }
        }
        .formStyle(.grouped)
    }

    private var onlineFontsForm: some View {
        Form {
            Section {
                Picker(L.text("macos.address"), selection: $draft.useCustomGoogleFontsMirror) {
                    Text(L.text("macos.officialAddress")).tag(false)
                    Text(L.text("macos.customMirror")).tag(true)
                }
                .pickerStyle(.segmented)
                .onChange(of: draft.useCustomGoogleFontsMirror) { _, enabled in
                    if enabled && draft.googleFontsMirrorTemplate.isEmpty {
                        draft.googleFontsMirrorTemplate = "https://raw.githubusercontent.com/google/fonts/{commit}/{path}"
                    }
                }
                if draft.useCustomGoogleFontsMirror {
                    TextField(L.text("macos.httpsTemplate"), text: $draft.googleFontsMirrorTemplate)
                        .textContentType(.URL)
                        .disabled(testingMirror)
                        .onChange(of: draft.googleFontsMirrorTemplate) { _, _ in
                            mirrorMessage = nil
                        }
                    Text(L.text("macos.mirrorHint"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    HStack {
                        Button(L.text("macos.testMirror")) { testMirror() }
                            .disabled(testingMirror)
                        if testingMirror { ProgressView().controlSize(.small) }
                        if let mirrorMessage {
                            Text(mirrorMessage).font(.callout).foregroundStyle(.secondary)
                        }
                    }
                }
            } header: {
                Text(L.text("macos.fontDownloadAddress"))
            } footer: {
                Text(L.text("macos.mirrorFallback"))
            }
        }
        .formStyle(.grouped)
    }

    private func testMirror() {
        let template = draft.googleFontsMirrorTemplate.trimmingCharacters(in: .whitespacesAndNewlines)
        let cacheDirectory = OnlineFontsView.cacheDirectory
        testingMirror = true
        mirrorMessage = nil
        Task.detached {
            let message: String
            do {
                let online = try FolioOnline.open(cacheDirectory: cacheDirectory)
                try online.validateMirror(template: template)
                try online.testMirror(template: template)
                message = L.text("macos.mirrorAvailable")
            } catch {
                message = error.localizedDescription
            }
            await MainActor.run {
                mirrorMessage = message
                testingMirror = false
            }
        }
    }

    private var displayForm: some View {
        Form {
            Section {
                Picker(L.text("settings.defaultView"), selection: $draft.libraryViewMode) {
                    ForEach(LibraryViewMode.allCases) { mode in
                        Text(mode.accessibilityTitle)
                            .tag(mode.rawValue)
                    }
                }
                PreferenceSliderRow(
                    title: L.text("preview.size"),
                    value: $draft.previewSize,
                    range: 18...106,
                    step: 1
                )
            }
        }
        .formStyle(.grouped)
    }

    private var themeForm: some View {
        Form {
            Section {
                Picker(L.text("theme.default"), selection: $draft.defaultThemeColor) {
                    ForEach(DefaultThemeColor.allCases) { option in
                        Text(option.title).tag(option.rawValue)
                    }
                }
                Toggle(L.text("theme.useCollectionColor"), isOn: $draft.useCollectionThemeColor)
            }
        }
        .formStyle(.grouped)
    }

    private var cardsForm: some View {
        Form {
            Section {
                Toggle(L.text("cards.selectOnHover"), isOn: $draft.selectCardsOnHover)
                Toggle(L.text("cards.hoverHaptics"), isOn: $draft.hoverSelectionHaptics)
                Toggle(L.text("cards.sliderHaptics"), isOn: $draft.sliderHaptics)
                HStack {
                    Text(L.text("cards.scrollSpeed"))
                    Slider(
                        value: $draft.expandedCardWheelSpeed,
                        in: 0.5...2.0,
                        step: 0.05
                    )
                    .accessibilityLabel(L.text("cards.scrollSpeed"))
                    Text("\(draft.expandedCardWheelSpeed, specifier: "%.2f")×")
                        .font(.system(.body, design: .monospaced))
                        .monospacedDigit()
                        .frame(width: 54, alignment: .trailing)
                }
            } footer: {
                Text(L.text("cards.hapticsNote"))
            }
        }
        .formStyle(.grouped)
    }

    private var storageForm: some View {
        Form {
            Section(L.text("storage.space")) {
                if let storageUsage {
                    StorageOverviewChart(
                        databaseBytes: storageUsage.databaseBytes,
                        managedFontBytes: storageUsage.managedFontBytes,
                        previewBytes: previewCacheBytes ?? 0,
                        volumeTotalBytes: storageUsage.volumeTotalBytes,
                        volumeFreeBytes: storageUsage.volumeFreeBytes
                    )
                    .padding(.vertical, 12)
                    Text(L.text("storage.totalNote"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ProgressView(L.text("storage.measuring"))
                }
            }
            Section {
                if let storageUsage {
                    storageDetail(
                        L.text("storage.managedFonts"),
                        detail: L.text("storage.managedFontsDetail"),
                        bytes: storageUsage.managedFontBytes,
                        color: .accentColor
                    )
                    storageDetail(
                        L.text("storage.libraryDatabase"),
                        detail: L.text("storage.libraryDatabaseDetail"),
                        bytes: storageUsage.databaseBytes,
                        color: .primary
                    )
                    HStack(spacing: 10) {
                        Circle().fill(Color.secondary).frame(width: 9, height: 9)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L.text("storage.catalogCache"))
                            Text(L.format("storage.catalogCacheDetail", String(storageUsage.catalogCacheEntries)))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(formatBytes(storageUsage.catalogCacheEstimatedBytes))
                            .foregroundStyle(.secondary)
                        Button(L.text("storage.clean")) { clearCatalogCache() }
                            .accessibilityLabel(L.text("storage.cleanCatalogCache"))
                            .disabled(storageBusy || cloud.isRunning)
                    }
                    storageDetail(
                        L.text("storage.onlinePreviewCache"),
                        detail: L.text("storage.onlinePreviewCacheDetail"),
                        bytes: previewCacheBytes ?? 0,
                        color: .orange
                    ) {
                        Button(L.text("storage.clean")) { clearPreviewCache() }
                            .accessibilityLabel(L.text("storage.cleanPreviewCache"))
                            .disabled(storageBusy || cloud.isRunning)
                    }
                }
            } header: {
                Text(L.text("storage.usageDetails"))
            } footer: {
                Text(L.text("storage.cleanHint"))
            }
            Section {
                Button(L.text("storage.rebuildIndex")) { showSyncRebuildConfirmation = true }
                    .disabled(storageBusy || cloud.isRunning)
            } header: {
                Text(L.text("cloud.syncIndex"))
            } footer: {
                Text(L.text("storage.syncIndexDetail"))
            }
            if let storageMessage {
                Section {
                    Text(storageMessage)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
    }

    private func storageDetail<Accessory: View>(
        _ title: String,
        detail: String,
        bytes: UInt64,
        color: Color,
        @ViewBuilder accessory: () -> Accessory
    ) -> some View {
        HStack(spacing: 10) {
            Circle().fill(color).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(formatBytes(bytes)).foregroundStyle(.secondary)
            accessory()
        }
    }

    private func storageDetail(
        _ title: String,
        detail: String,
        bytes: UInt64,
        color: Color
    ) -> some View {
        storageDetail(title, detail: detail, bytes: bytes, color: color) { EmptyView() }
    }

    private func formatBytes(_ bytes: UInt64) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(clamping: bytes), countStyle: .file)
    }

    private func loadStorageUsage() {
        Task {
            do {
                storageUsage = try await cloud.storageUsage()
                let cacheDirectory = OnlineFontsView.cacheDirectory
                previewCacheBytes = try await Task.detached(priority: .userInitiated) {
                    try FolioOnline.open(cacheDirectory: cacheDirectory).previewCacheBytes()
                }.value
            } catch {
                storageMessage = error.localizedDescription
            }
        }
    }

    private func clearCatalogCache() {
        storageBusy = true
        storageMessage = nil
        Task {
            defer { storageBusy = false }
            do {
                let removed = try await cloud.clearCatalogCache()
                storageMessage = L.format("storage.catalogCleaned", String(removed))
                loadStorageUsage()
            } catch {
                storageMessage = error.localizedDescription
            }
        }
    }

    private func clearPreviewCache() {
        storageBusy = true
        storageMessage = nil
        let cacheDirectory = OnlineFontsView.cacheDirectory
        Task {
            defer { storageBusy = false }
            do {
                let bytes = try await cloud.clearPreviewCache(cacheDirectory: cacheDirectory)
                storageMessage = L.format("storage.previewCleaned", formatBytes(bytes))
                loadStorageUsage()
            } catch {
                storageMessage = error.localizedDescription
            }
        }
    }

    private func rebuildSyncIndexes() {
        storageBusy = true
        storageMessage = nil
        Task {
            defer { storageBusy = false }
            do {
                try await cloud.rebuildSyncIndexes()
                storageMessage = L.text("cloud.rebuildDone")
                loadStorageUsage()
            } catch {
                storageMessage = error.localizedDescription
            }
        }
    }

    /// 用已保存的偏好与连接信息初始化草稿。
    private func loadDraft() {
        draft.googleFontsMirrorTemplate = googleFontsMirrorTemplate
        draft.useCustomGoogleFontsMirror = !googleFontsMirrorTemplate.isEmpty
        draft.selectCardsOnHover = selectCardsOnHover
        draft.hoverSelectionHaptics = hoverSelectionHaptics
        draft.sliderHaptics = sliderHaptics
        draft.libraryViewMode = libraryViewMode
        draft.previewSize = previewSize
        draft.expandedCardWheelSpeed = expandedCardWheelSpeed
        draft.askImportMode = askImportMode
        draft.defaultImportMode = defaultImportMode
        draft.useCollectionThemeColor = useCollectionThemeColor
        draft.defaultThemeColor = defaultThemeColor
        if let profile = cloud.profile {
            draft.serverURL = profile.serverUrl
            draft.webDAVPreset = WebDAVPreset.matching(profile.serverUrl)
            draft.remoteDirectory = profile.remoteDirectory
            draft.username = profile.username
            draft.automatic = profile.automatic
        }
        draft.password = ""
    }

    /// 写入草稿并关闭窗口。
    private func commit() {
        let template = draft.useCustomGoogleFontsMirror
            ? draft.googleFontsMirrorTemplate.trimmingCharacters(in: .whitespacesAndNewlines) : ""
        if draft.useCustomGoogleFontsMirror {
            do {
                let online = try FolioOnline.open(cacheDirectory: OnlineFontsView.cacheDirectory)
                try online.validateMirror(template: template)
            } catch {
                mirrorMessage = error.localizedDescription
                selection = .onlineFonts
                return
            }
        }
        googleFontsMirrorTemplate = template
        selectCardsOnHover = draft.selectCardsOnHover
        hoverSelectionHaptics = draft.hoverSelectionHaptics
        sliderHaptics = draft.sliderHaptics
        libraryViewMode = draft.libraryViewMode
        previewSize = draft.previewSize
        expandedCardWheelSpeed = draft.expandedCardWheelSpeed
        askImportMode = draft.askImportMode
        defaultImportMode = draft.defaultImportMode
        useCollectionThemeColor = draft.useCollectionThemeColor
        defaultThemeColor = draft.defaultThemeColor

        let profile = cloud.profile
        let connectionChanged = draft.serverURL != (profile?.serverUrl ?? "")
            || draft.remoteDirectory != (profile?.remoteDirectory ?? "")
            || draft.username != (profile?.username ?? "")
            || draft.automatic != (profile?.automatic ?? true)
            || !draft.password.isEmpty
        if !draft.serverURL.isEmpty, !draft.username.isEmpty, connectionChanged {
            cloud.saveConnection(
                serverURL: draft.serverURL,
                directory: draft.remoteDirectory,
                username: draft.username,
                password: draft.password,
                automatic: draft.automatic
            )
        }
        closeWindow()
    }

    /// 恢复默认偏好，保留当前 WebDAV 连接信息。
    private func resetToDefaults() {
        let connection = (
            serverURL: draft.serverURL,
            preset: draft.webDAVPreset,
            directory: draft.remoteDirectory,
            username: draft.username,
            automatic: draft.automatic
        )
        draft = SettingsDraft()
        draft.serverURL = connection.serverURL
        draft.webDAVPreset = connection.preset
        draft.remoteDirectory = connection.directory
        draft.username = connection.username
        draft.automatic = connection.automatic
    }

    private func closeWindow() {
        NSApp.keyWindow?.performClose(nil)
    }
}

private struct StorageOverviewChart: View {
    let databaseBytes: UInt64
    let managedFontBytes: UInt64
    let previewBytes: UInt64
    let volumeTotalBytes: UInt64
    let volumeFreeBytes: UInt64

    private struct Segment {
        let bytes: UInt64
        let color: Color
        let isFolio: Bool
    }

    private var totalBytes: UInt64 {
        databaseBytes + managedFontBytes + previewBytes
    }

    private var volumePercentage: Double {
        guard volumeTotalBytes > 0 else { return 0 }
        return Double(totalBytes) / Double(volumeTotalBytes) * 100
    }

    private var otherUsedBytes: UInt64 {
        let used = volumeTotalBytes > volumeFreeBytes ? volumeTotalBytes - volumeFreeBytes : 0
        return used > totalBytes ? used - totalBytes : 0
    }

    private var percentageLabel: String {
        if volumePercentage > 0, volumePercentage < 0.1 { return "<0.1%" }
        return String(format: "%.1f%%", volumePercentage)
    }

    private var segments: [Segment] {
        return [
            Segment(bytes: otherUsedBytes, color: .secondary, isFolio: false),
            Segment(bytes: managedFontBytes, color: .accentColor, isFolio: true),
            Segment(bytes: databaseBytes, color: .primary, isFolio: true),
            Segment(bytes: previewBytes, color: .orange, isFolio: true),
            Segment(bytes: volumeFreeBytes, color: .primary.opacity(0.12), isFolio: false),
        ].filter { $0.bytes > 0 }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(L.text("storage.folioUsage"))
                Spacer()
                Text(ByteCountFormatter.string(fromByteCount: Int64(clamping: totalBytes), countStyle: .file))
                    .font(.title2.weight(.semibold))
                    .monospacedDigit()
            }
            GeometryReader { geometry in
                HStack(spacing: 0) {
                    ForEach(segments.indices, id: \.self) { index in
                        Rectangle()
                            .fill(segments[index].color)
                            .frame(width: segmentWidth(segments[index], in: geometry.size.width))
                    }
                }
            }
            .frame(height: 18)
            .background(Color.primary.opacity(0.12))
            .clipShape(Capsule())
            HStack {
                Text(L.format("storage.diskOf", ByteCountFormatter.string(fromByteCount: Int64(clamping: totalBytes), countStyle: .file), ByteCountFormatter.string(fromByteCount: Int64(clamping: volumeTotalBytes), countStyle: .file)))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(percentageLabel).font(.callout.weight(.semibold)).monospacedDigit()
            }
            HStack(spacing: 18) {
                Circle().fill(Color.secondary).frame(width: 9, height: 9)
                Text("\(L.text("storage.otherApps")) \(ByteCountFormatter.string(fromByteCount: Int64(clamping: otherUsedBytes), countStyle: .file))")
                Circle().fill(Color.primary.opacity(0.12)).frame(width: 9, height: 9)
                Text(L.format("storage.freeSpace", ByteCountFormatter.string(fromByteCount: Int64(clamping: volumeFreeBytes), countStyle: .file)))
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L.format(
            "storage.accessibilityUsage",
            ByteCountFormatter.string(fromByteCount: Int64(clamping: totalBytes), countStyle: .file),
            percentageLabel,
            ByteCountFormatter.string(fromByteCount: Int64(clamping: otherUsedBytes), countStyle: .file),
            ByteCountFormatter.string(fromByteCount: Int64(clamping: volumeFreeBytes), countStyle: .file)
        ))
    }

    private func segmentWidth(_ segment: Segment, in width: CGFloat) -> CGFloat {
        guard volumeTotalBytes > 0 else { return 0 }
        let exact = width * min(CGFloat(Double(segment.bytes) / Double(volumeTotalBytes)), 1)
        return segment.isFolio ? max(2, exact) : exact
    }
}

private enum SettingsSection: String, CaseIterable, Identifiable {
    case cloud
    case onlineFonts
    case importing
    case display
    case theme
    case cards
    case storage
    case about

    var id: String { rawValue }

    var title: String {
        switch self {
        case .cloud: L.text("settings.cloud")
        case .onlineFonts: L.text("settings.onlineFonts")
        case .importing: L.text("settings.importing")
        case .display: L.text("settings.display")
        case .theme: L.text("settings.theme")
        case .cards: L.text("settings.cards")
        case .storage: L.text("settings.storage")
        case .about: L.text("settings.about")
        }
    }
}

private enum WebDAVPreset: String, CaseIterable, Identifiable {
    case none
    case pan123
    case jianguoyun

    var id: String { rawValue }

    var title: String {
        switch self {
        case .none: L.text("macos.providerNone")
        case .pan123: L.text("macos.provider123")
        case .jianguoyun: L.text("macos.providerJianguoyun")
        }
    }

    var serverURL: String? {
        switch self {
        case .none: nil
        case .pan123: "https://webdav.123pan.cn/webdav"
        case .jianguoyun: "https://dav.jianguoyun.com/dav"
        }
    }

    static func matching(_ serverURL: String) -> Self {
        let normalized = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            .lowercased()
        return allCases.first { preset in
            guard let presetURL = preset.serverURL else { return false }
            return presetURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                .lowercased() == normalized
        } ?? .none
    }
}

/// 设置窗口的编辑草稿；点“好”后写入偏好，点“取消”丢弃。
private struct SettingsDraft {
    var useCustomGoogleFontsMirror = false
    var googleFontsMirrorTemplate = ""
    var selectCardsOnHover = true
    var hoverSelectionHaptics = true
    var sliderHaptics = true
    var libraryViewMode = LibraryViewMode.compactGrid.rawValue
    var previewSize = 48.0
    var expandedCardWheelSpeed = 1.25
    var askImportMode = false
    var defaultImportMode = FontImportMode.copy.rawValue
    var useCollectionThemeColor = true
    var defaultThemeColor = DefaultThemeColor.folio.rawValue
    var serverURL = ""
    var webDAVPreset: WebDAVPreset = .none
    var remoteDirectory = "Folio"
    var username = ""
    var password = ""
    var automatic = true
}

private struct PreferenceSliderRow: View {
    let title: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double

    @State private var draftValue: Double
    @State private var isEditing = false

    init(
        title: String,
        value: Binding<Double>,
        range: ClosedRange<Double>,
        step: Double
    ) {
        self.title = title
        _value = value
        self.range = range
        self.step = step
        _draftValue = State(initialValue: value.wrappedValue)
    }

    var body: some View {
        HStack {
            Text(title)
            Slider(
                value: $draftValue,
                in: range,
                step: step,
                onEditingChanged: { editing in
                    isEditing = editing
                    if !editing {
                        value = draftValue
                    }
                }
            )
            .sliderHaptics(
                value: draftValue,
                in: range,
                feedbackStep: step
            )
            Text("\(Int(draftValue.rounded()))px")
                .font(.system(.body, design: .monospaced))
                .monospacedDigit()
                .frame(width: 54, alignment: .trailing)
        }
        .onChange(of: value) { _, newValue in
            guard !isEditing else { return }
            draftValue = newValue
        }
    }
}

/// 把滚轮和触控板事件转成按页离散切换，避免自由滚动停在两页之间。
struct ScrollWheelPager: NSViewRepresentable {
    let onStep: (Int) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onStep: onStep)
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        context.coordinator.hostView = view
        context.coordinator.install()
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.onStep = onStep
        context.coordinator.hostWindow = nsView.window
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.uninstall()
    }

    @MainActor
    final class Coordinator {
        var onStep: (Int) -> Void
        weak var hostView: NSView?
        weak var hostWindow: NSWindow?
        private var monitor: Any?
        private var accumulated: CGFloat = 0
        private var lastStepTime: TimeInterval = 0
        private var lastEventTime: TimeInterval = 0

        init(onStep: @escaping (Int) -> Void) {
            self.onStep = onStep
        }

        func install() {
            monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
                // 先取出可发送的标量，再回到主线程判定，避免跨隔离持有 NSEvent。
                let location = event.locationInWindow
                let windowNumber = event.windowNumber
                let deltaX = event.scrollingDeltaX
                let deltaY = event.scrollingDeltaY
                let precise = event.hasPreciseScrollingDeltas
                let hasMomentum = event.momentumPhase != []
                let consumed = MainActor.assumeIsolated { () -> Bool in
                    guard let self else { return false }
                    return self.decide(
                        location: location,
                        windowNumber: windowNumber,
                        deltaX: deltaX,
                        deltaY: deltaY,
                        precise: precise,
                        hasMomentum: hasMomentum
                    )
                }
                return consumed ? nil : event
            }
        }

        func uninstall() {
            if let monitor {
                NSEvent.removeMonitor(monitor)
            }
            monitor = nil
        }

        /// 返回 true 表示消费该事件，不交给内容滚动。
        private func decide(
            location: NSPoint,
            windowNumber: Int,
            deltaX: CGFloat,
            deltaY: CGFloat,
            precise: Bool,
            hasMomentum: Bool
        ) -> Bool {
            guard let window = hostWindow, window.windowNumber == windowNumber else { return false }

            // 两次滚动间隔过久视为新的手势，清零累计，避免零星小动作攒够阈值。
            let now = ProcessInfo.processInfo.systemUptime
            if now - lastEventTime > 0.4 {
                accumulated = 0
            }
            lastEventTime = now

            // 触控板横向滑动：需要明显滑动才切页。
            if precise, abs(deltaX) > abs(deltaY) {
                guard !hasMomentum else { return true }
                if accumulated != 0, (accumulated > 0) != (deltaX > 0) { accumulated = 0 }
                accumulated += deltaX
                stepIfReady(threshold: 60, cooldown: 0.5, now: now)
                return true
            }

            // 纵向滚动：内容还能滚就先滚内容，滚到边缘再切页。
            if let scroll = nearestScrollView(in: window, at: location),
               canScroll(scroll, deltaY: deltaY) {
                accumulated = 0
                return false
            }
            guard !hasMomentum else { return true }
            if accumulated != 0, (accumulated > 0) != (deltaY > 0) { accumulated = 0 }
            accumulated += deltaY
            stepIfReady(threshold: precise ? 80 : 3, cooldown: 0.5, now: now)
            return true
        }

        private func stepIfReady(threshold: CGFloat, cooldown: TimeInterval, now: TimeInterval) {
            guard abs(accumulated) >= threshold, now - lastStepTime > cooldown else { return }
            onStep(accumulated > 0 ? -1 : 1)
            accumulated = 0
            lastStepTime = now
        }

        /// 指针下最近的滚动视图。
        private func nearestScrollView(in window: NSWindow, at location: NSPoint) -> NSScrollView? {
            guard let content = window.contentView else { return nil }
            let point = content.convert(location, from: nil)
            var view: NSView? = content.hitTest(point)
            while let current = view {
                if let scroll = current as? NSScrollView {
                    return scroll
                }
                view = current.superview
            }
            return nil
        }

        /// 给定滚动方向上是否还有可滚区域。
        private func canScroll(_ scroll: NSScrollView, deltaY: CGFloat) -> Bool {
            guard let document = scroll.documentView else { return false }
            let visible = document.visibleRect
            let bounds = document.bounds
            guard bounds.height > visible.height + 1 else { return false }
            if deltaY > 0 {
                return visible.minY > bounds.minY + 1
            } else {
                return visible.maxY < bounds.maxY - 1
            }
        }
    }
}

#if DEBUG
#Preview {
    SettingsView()
}
#endif
