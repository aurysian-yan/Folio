import SwiftUI

struct RootView: View {
    @State private var model = LibraryViewModel()
    @State private var cloud = CloudSyncModel.shared
    @Environment(\.scenePhase) private var scenePhase
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @AppStorage(AppPreferences.libraryViewMode) private var preferredViewMode =
        LibraryViewMode.compactGrid.rawValue
    @AppStorage(AppPreferences.previewSize) private var preferredPreviewSize = 48.0
    @AppStorage(AppPreferences.useCollectionThemeColor) private var useCollectionThemeColor = true
    @AppStorage(AppPreferences.defaultThemeColor) private var defaultThemeColor = DefaultThemeColor.folio.rawValue

    private var themeColor: Color {
        if useCollectionThemeColor {
            switch model.selectedDestination {
            case let .collection(id):
                if let folder = model.snapshot.collections.first(where: { $0.id == id }) {
                    return folder.color.color
                }
            case let .smartFolder(id):
                if let folder = model.snapshot.smartFolders.first(where: { $0.id == id }) {
                    return folder.color.color
                }
            default:
                break
            }
        }
        return (DefaultThemeColor(rawValue: defaultThemeColor) ?? .folio).color
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView(model: model)
                .navigationSplitViewColumnWidth(min: 160, ideal: 240, max: 300)
        } detail: {
            if model.selectedDestination == .cloudFonts {
                CloudLibraryView(model: model)
            } else {
                LibraryView(model: model)
            }
        }
        .inspector(isPresented: $model.inspectorPresented) {
            FontInspectorView(model: model)
                .inspectorColumnWidth(min: 220, ideal: 260, max: 340)
        }
        .background {
            GeometryReader { proxy in
                Color.clear
                    .onChange(of: proxy.size.width) { _, width in
                        guard width < 760 else { return }
                        columnVisibility = .detailOnly
                        model.inspectorPresented = false
                    }
            }
        }
        .background(WindowLayoutPersistenceController())
        .task {
            cloud.start()
            model.start()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { cloud.requestAutomaticSync() }
        }
        .onChange(of: cloud.libraryGeneration) { _, _ in
            model.reloadAfterSync()
        }
        .onOpenURL { model.receiveOpenURL($0) }
        .onChange(of: preferredViewMode) { _, rawValue in
            model.applyPreferredViewMode(rawValue)
        }
        .onChange(of: preferredPreviewSize) { _, size in
            model.applyPreferredPreviewSize(size)
        }
        .alert("无法完成操作", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) {
            Button("好") { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? "发生未知错误")
        }
        .sheet(item: $model.favoriteFolderEditor) { intent in
            FavoriteFolderEditorView(model: model, intent: intent)
        }
        .confirmationDialog("导入字体", isPresented: $model.isImportChoicePresented) {
            Button("复制到 Folio 字体库") { model.importPending(as: .copy) }
            Button("引用原文件") { model.importPending(as: .reference) }
            Button("取消", role: .cancel) {}
        } message: {
            Text("选择字体文件的保存方式")
        }
        .sheet(isPresented: $model.isImportReportPresented) {
            ImportReportView(model: model)
        }
        .tint(themeColor)
        .accentColor(themeColor)
        .environment(\.folioThemeColor, themeColor)
    }
}

private struct ImportReportView: View {
    @Bindable var model: LibraryViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(model.isCloudImportReport ? "添加至云端" : "导入结果")
                .font(.headline)
            List {
                Section(model.isCloudImportReport ? "字体" : "导入") {
                    ForEach(model.importOutcomes.indices, id: \.self) { index in
                        outcomeRow(model.importOutcomes[index])
                    }
                }
                if let action = model.lastReportedBatchAction, !model.batchOutcomes.isEmpty {
                    Section(action.title) {
                        ForEach(model.batchOutcomes.indices, id: \.self) { index in
                            outcomeRow(model.batchOutcomes[index])
                        }
                    }
                }
            }
            HStack {
                if model.importOutcomes.contains(where: { $0.error != nil })
                    || model.batchOutcomes.contains(where: { $0.error != nil }) {
                    Button("重试失败项") { model.retryFailedOutcomes() }
                }
                if !model.isCloudImportReport, model.importOutcomes.contains(where: { $0.error == nil }) {
                    Button("激活成功导入的字体") {
                        model.performImportedBatch(.activate)
                    }
                    Button("安装成功导入的字体") {
                        model.performImportedBatch(.install)
                    }
                }
                Spacer()
                Button("完成") { dismiss() }
            }
        }
        .padding()
        .frame(width: 480, height: 360)
    }

    private func outcomeRow(_ outcome: FontOperationOutcome) -> some View {
        HStack {
            Image.englishSystemName(outcome.error == nil ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                .foregroundStyle(outcome.error == nil ? .green : .orange)
            VStack(alignment: .leading) {
                Text(outcome.name)
                if let error = outcome.error {
                    Text(error).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }
}

private struct WindowLayoutPersistenceController: NSViewRepresentable {
    private let windowFrameAutosaveName = "Folio.MainWindow"
    private let searchFieldWidth: CGFloat = 240

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        configureWindowLayout(from: view)
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {
        configureWindowLayout(from: view)
    }

    private func configureWindowLayout(from view: NSView) {
        DispatchQueue.main.async {
            guard let window = view.window else { return }
            if window.minSize != NSSize(width: 512, height: 468) {
                window.minSize = NSSize(width: 512, height: 468)
            }
            if window.frameAutosaveName != windowFrameAutosaveName {
                window.setFrameAutosaveName(windowFrameAutosaveName)
            }

            if let contentView = window.contentView {
                for (index, splitView) in splitViews(in: contentView).enumerated() {
                    let autosaveName = "Folio.SplitView.\(index)"
                    if splitView.autosaveName != autosaveName {
                        splitView.autosaveName = autosaveName
                    }
                }
            }

            guard let searchItem = window.toolbar?.items
                .compactMap({ $0 as? NSSearchToolbarItem })
                .first else { return }
            searchItem.preferredWidthForSearchField = searchFieldWidth
            let widthConstraintIdentifier = "Folio.SearchFieldWidth"
            if !searchItem.searchField.constraintsAffectingLayout(for: .horizontal).contains(where: {
                $0.identifier == widthConstraintIdentifier
            }) {
                let widthConstraint = searchItem.searchField.widthAnchor
                    .constraint(equalToConstant: searchFieldWidth)
                widthConstraint.identifier = widthConstraintIdentifier
                widthConstraint.priority = .defaultHigh
                widthConstraint.isActive = true
            }
        }
    }

    private func splitViews(in view: NSView) -> [NSSplitView] {
        var result: [NSSplitView] = []
        func collect(from view: NSView) {
            if let splitView = view as? NSSplitView {
                result.append(splitView)
            }
            view.subviews.forEach { collect(from: $0) }
        }
        collect(from: view)
        return result
    }
}

private struct FavoriteFolderEditorView: View {
    @Bindable var model: LibraryViewModel
    @Environment(\.folioThemeColor) private var themeColor
    let intent: FavoriteFolderEditorIntent
    @Environment(\.dismiss) private var dismiss
    @FocusState private var nameFocused: Bool
    @State private var name = ""
    @State private var text = ""
    @State private var options: [FacetOption] = []
    @State private var selectedFacets: Set<FacetOption> = []
    @State private var icon: CollectionIcon
    @State private var color: CollectionColor
    @State private var isLoading = true
    @State private var loadFailed = false

    init(model: LibraryViewModel, intent: FavoriteFolderEditorIntent) {
        self.model = model
        self.intent = intent
        _icon = State(initialValue: intent.initialIcon)
        _color = State(initialValue: intent.initialColor)
        if case .create = intent {
            _text = State(initialValue: model.favoriteFolderSeedText)
            _selectedFacets = State(initialValue: model.favoriteFolderSeedFacets)
        } else {
            _name = State(initialValue: intent.initialName)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(intent.title)
                .font(.headline)
            TextField("收藏夹名称", text: $name)
                .focused($nameFocused)
                .onSubmit(save)
            Text("图标")
                .font(.subheadline)
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 8), spacing: 6) {
                    ForEach(CollectionIcon.allCases) { option in
                        Button {
                            icon = option
                        } label: {
                            Image.englishSystemName(option.symbolName)
                                .frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .tint(icon == option ? themeColor : .secondary)
                        .accessibilityLabel(option.title)
                        .accessibilityAddTraits(icon == option ? .isSelected : [])
                        .help(option.title)
                    }
                }
            }
            .frame(height: 110)
            HStack {
                Text("颜色")
                    .font(.subheadline)
                Spacer()
                Text(color.title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                ForEach(CollectionColor.allCases) { option in
                    colorSwatch(option)
                }
            }
            TextField("搜索字体", text: $text)
                .textFieldStyle(.roundedBorder)
            Text("筛选条件")
                .font(.subheadline)
            Text("添加筛选条件后，符合条件的字体会自动显示在此收藏夹中。")
                .font(.caption)
                .foregroundStyle(.secondary)
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(FacetKind.allCases, id: \.self) { kind in
                            let group = options.filter { $0.kind == kind }
                            if !group.isEmpty {
                                facetRow(kind, options: group)
                            }
                        }
                    }
                }
            }
            HStack {
                Spacer()
                Button("取消") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(intent.isCreate ? "创建" : "保存", action: save)
                    .keyboardShortcut(.defaultAction)
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isLoading || loadFailed)
            }
        }
        .padding()
        .frame(minWidth: 520, minHeight: 540)
        .task { await load() }
    }

    private func facetRow(_ kind: FacetKind, options: [FacetOption]) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(kind.title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 72, alignment: .leading)
                .padding(.top, 5)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(options) { option in
                        let isSelected = selectedFacets.contains(where: { $0.id == option.id })
                        Button {
                            toggle(option)
                        } label: {
                            HStack(spacing: 4) {
                                Text(option.label)
                                    .lineLimit(1)
                                Text(option.familyCount, format: .number)
                                    .monospacedDigit()
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .tint(isSelected ? themeColor : .secondary)
                        .accessibilityLabel("\(option.label)，\(option.familyCount) 个字族")
                        .accessibilityAddTraits(isSelected ? .isSelected : [])
                    }
                }
            }
        }
    }

    private func toggle(_ option: FacetOption) {
        if let existing = selectedFacets.first(where: { $0.id == option.id }) {
            selectedFacets.remove(existing)
        } else {
            selectedFacets.insert(option)
        }
    }

    private func load() async {
        do {
            options = try await model.loadSmartFolderFacetOptions()
            if case let .editSmartFolder(folder) = intent,
               let details = try await model.loadSmartFolderDetails(folder.id, options: options) {
                name = details.summary.name
                text = details.text
                selectedFacets = details.selectedFacets
            } else {
                selectedFacets = Set(selectedFacets.map { selected in
                    options.first(where: { $0.id == selected.id }) ?? selected
                })
            }
            isLoading = false
            nameFocused = true
        } catch {
            isLoading = false
            loadFailed = true
            model.errorMessage = error.localizedDescription
        }
    }

    private func save() {
        guard !isLoading, !loadFailed else { return }
        model.saveFavoriteFolder(
            intent,
            name: name,
            text: text,
            facets: selectedFacets,
            icon: icon,
            color: color
        )
    }

    private func colorSwatch(_ option: CollectionColor) -> some View {
        let isSelected = color == option
        return Button {
            color = option
        } label: {
            ZStack {
                Circle().fill(option.color)
                if isSelected {
                    Circle()
                        .stroke(Color.primary, lineWidth: 2)
                        .padding(2)
                }
            }
            .frame(width: 24, height: 24)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .help(option.title)
    }
}
