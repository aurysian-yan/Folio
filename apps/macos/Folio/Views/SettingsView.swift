@preconcurrency import AppKit
import SwiftUI

struct SettingsView: View {
    @State private var cloud = CloudSyncModel.shared
    @State private var selection: SettingsSection = .cloud
    @State private var draft = SettingsDraft()
    @State private var testingConnection = false
    @State private var showResetConfirmation = false
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
                    Picker("设置分类", selection: pickerSelection) {
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
                "恢复默认值？",
                isPresented: $showResetConfirmation
            ) {
                Button("恢复默认值", role: .destructive) { resetToDefaults() }
            } message: {
                Text("所有偏好将恢复为初始设置，WebDAV 连接信息不受影响。")
            }
            .onAppear {
                cloud.start()
                loadDraft()
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

    private var bottomBar: some View {
        HStack(spacing: 12) {
            circleButton("arrow.counterclockwise", label: "恢复默认值") {
                showResetConfirmation = true
            }
            Spacer()
            circleButton("xmark", label: "取消") { closeWindow() }
                .keyboardShortcut(.cancelAction)
            circleButton("checkmark", label: "好", filled: true) { commit() }
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
        case .importing: importForm
        case .display: displayForm
        case .theme: themeForm
        case .cards: cardsForm
        case .about: AboutView()
        }
    }

    private var cloudForm: some View {
        Form {
            Section {
                TextField("服务器地址", text: $draft.serverURL, prompt: Text("https://"))
                    .textContentType(.URL)
                TextField("远端目录", text: $draft.remoteDirectory)
                TextField("账号", text: $draft.username)
                SecureField("密码或应用密码", text: $draft.password)
                Toggle("自动同步", isOn: $draft.automatic)
            } header: {
                Text("WebDAV 连接")
            } footer: {
                Text("密码保存在 macOS 钥匙串中，不会写入字体库数据库。")
            }

            Section {
                HStack(spacing: 10) {
                    Button("测试连接") {
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
                            .accessibilityLabel("正在连接")
                    }
                    Spacer()
                }

                if let message = cloud.message {
                    Text(message)
                        .font(.callout)
                        .foregroundStyle(cloud.errorMessage == nil ? Color.secondary : Color.red)
                }
            } footer: {
                Text("填写后点击“好”保存连接。")
            }

            if cloud.isConnected {
                Section("同步状态") {
                    HStack(spacing: 10) {
                        Image.englishSystemName(cloud.isRunning ? "arrow.triangle.2.circlepath" : "checkmark.icloud")
                            .foregroundStyle(cloud.isRunning ? themeColor : Color.green)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(cloud.isRunning ? "正在同步…" : "已连接 \(cloud.connectionName)")
                            if cloud.isRunning {
                                Text("已上传 \(cloud.status?.uploadedFiles ?? 0) 个 · 已下载 \(cloud.status?.downloadedFiles ?? 0) 个")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            } else if let phase = cloud.status?.phase, !phase.isEmpty {
                                Text(phase)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                    }

                    HStack {
                        Button(cloud.isRunning ? "取消同步" : "立即同步") {
                            if cloud.isRunning { cloud.cancel() } else { cloud.syncNow() }
                        }
                        Spacer()
                        Button("断开连接", role: .destructive) { cloud.disconnect() }
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    private var importForm: some View {
        Form {
            Section {
                Toggle("每次询问导入方式", isOn: $draft.askImportMode)
                Picker("默认导入方式", selection: $draft.defaultImportMode) {
                    ForEach(FontImportMode.allCases) { mode in
                        Text(mode.title).tag(mode.rawValue)
                    }
                }
                .disabled(draft.askImportMode)
            } footer: {
                Text("关闭“每次询问”后，导入字体将直接使用默认方式。")
            }
        }
        .formStyle(.grouped)
    }

    private var displayForm: some View {
        Form {
            Section {
                Picker("当前视图", selection: $draft.libraryViewMode) {
                    ForEach(LibraryViewMode.allCases) { mode in
                        Text(mode.accessibilityTitle)
                            .tag(mode.rawValue)
                    }
                }
                PreferenceSliderRow(
                    title: "预览字号",
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
                Picker("默认主题色", selection: $draft.defaultThemeColor) {
                    ForEach(DefaultThemeColor.allCases) { option in
                        Text(option.title).tag(option.rawValue)
                    }
                }
                Toggle("进入收藏夹时使用收藏夹颜色", isOn: $draft.useCollectionThemeColor)
            }
        }
        .formStyle(.grouped)
    }

    private var cardsForm: some View {
        Form {
            Section {
                Toggle("悬停时选中字体卡片", isOn: $draft.selectCardsOnHover)
                Toggle("切换字体卡片时提供触觉反馈", isOn: $draft.hoverSelectionHaptics)
                Toggle("拖动滑块时提供触觉反馈", isOn: $draft.sliderHaptics)
                HStack {
                    Text("滚轮滚动速度")
                    Slider(
                        value: $draft.expandedCardWheelSpeed,
                        in: 0.5...2.0,
                        step: 0.05
                    )
                    .accessibilityLabel("滚轮滚动速度")
                    Text("\(draft.expandedCardWheelSpeed, specifier: "%.2f")×")
                        .font(.system(.body, design: .monospaced))
                        .monospacedDigit()
                        .frame(width: 54, alignment: .trailing)
                }
            } footer: {
                Text("触觉反馈仅适用于支持该功能的内建或外接妙控板。")
            }
        }
        .formStyle(.grouped)
    }

    /// 用已保存的偏好与连接信息初始化草稿。
    private func loadDraft() {
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
            draft.remoteDirectory = profile.remoteDirectory
            draft.username = profile.username
            draft.automatic = profile.automatic
        }
        draft.password = ""
    }

    /// 写入草稿并关闭窗口。
    private func commit() {
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
            directory: draft.remoteDirectory,
            username: draft.username,
            automatic: draft.automatic
        )
        draft = SettingsDraft()
        draft.serverURL = connection.serverURL
        draft.remoteDirectory = connection.directory
        draft.username = connection.username
        draft.automatic = connection.automatic
    }

    private func closeWindow() {
        NSApp.keyWindow?.performClose(nil)
    }
}

private enum SettingsSection: String, CaseIterable, Identifiable {
    case cloud
    case importing
    case display
    case theme
    case cards
    case about

    var id: String { rawValue }

    var title: String {
        switch self {
        case .cloud: "云同步"
        case .importing: "导入"
        case .display: "显示"
        case .theme: "主题色"
        case .cards: "字体卡片"
        case .about: "关于"
        }
    }
}

/// 设置窗口的编辑草稿；点“好”后写入偏好，点“取消”丢弃。
private struct SettingsDraft {
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

/// 把设置窗口内的滚轮事件转成按页离散切换，避免自由滚动停在两页之间。
private struct ScrollWheelPager: NSViewRepresentable {
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
