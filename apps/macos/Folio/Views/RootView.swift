import SwiftUI

struct RootView: View {
    @State private var model = LibraryViewModel()
    @State private var cloud = CloudSyncModel.shared
    @State private var sidebarPage = SidebarPage.navigation
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
            SidebarView(model: model, selectedPage: $sidebarPage)
                .navigationSplitViewColumnWidth(240)
        } detail: {
            if model.selectedDestination == .onlineFonts {
                OnlineFontsView(model: model)
            } else if model.selectedDestination == .cloudFonts {
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
        .alert(L.text("common.operationFailed"), isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) {
            Button(L.text("common.ok")) { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? L.text("common.unknownError"))
        }
        .sheet(item: $model.favoriteFolderEditor) { intent in
            FavoriteFolderEditorView(model: model, intent: intent)
        }
        .confirmationDialog(L.text("import.importFonts"), isPresented: $model.isImportChoicePresented) {
            Button(L.text("import.copyToLibrary")) { model.importPending(as: .copy) }
            Button(L.text("import.referenceOriginal")) { model.importPending(as: .reference) }
            Button(L.text("common.cancel"), role: .cancel) {}
        } message: {
            Text(L.text("import.chooseMode"))
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
            Text(model.isCloudImportReport ? L.text("import.addToCloud") : L.text("import.importResults"))
                .font(.headline)
            List {
                Section(model.isCloudImportReport ? L.text("font.fonts") : L.text("import.title")) {
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
                    Button(L.text("import.retryFailed")) { model.retryFailedOutcomes() }
                }
                if !model.isCloudImportReport, model.importOutcomes.contains(where: { $0.error == nil }) {
                    Button(L.text("import.activateImported")) {
                        model.performImportedBatch(.activate)
                    }
                    Button(L.text("import.installImported")) {
                        model.performImportedBatch(.install)
                    }
                }
                Spacer()
                Button(L.text("common.done")) { dismiss() }
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

private enum FavoriteFolderEditorTab: String, CaseIterable, Identifiable {
    case general
    case filters

    var id: Self { self }

    var title: String {
        switch self {
        case .general: L.text("collection.general")
        case .filters: L.text("filters.conditions")
        }
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
    @State private var selectedTab: FavoriteFolderEditorTab = .general
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
            favoriteFolderPicker
                .frame(maxWidth: .infinity, alignment: .center)
            pager

            HStack {
                Spacer()
                Button(L.text("common.cancel")) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(intent.isCreate ? L.text("common.create") : L.text("common.save"), action: save)
                    .keyboardShortcut(.defaultAction)
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isLoading || loadFailed)
            }
        }
        .padding()
        .frame(minWidth: 520, minHeight: 540)
        .tint(themeColor)
        .accentColor(themeColor)
        .task { await load() }
    }

    private var favoriteFolderPicker: some View {
        GlassTabPicker(
            title: L.text("collection.settings"),
            options: FavoriteFolderEditorTab.allCases.map {
                GlassTabPicker<FavoriteFolderEditorTab>.Option(value: $0, title: $0.title)
            },
            selection: pickerSelection
        )
    }

    private var pageAnimation: Animation {
        .smooth(duration: 0.45)
    }

    private var pager: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 0) {
                ForEach(FavoriteFolderEditorTab.allCases) { tab in
                    page(for: tab)
                        .containerRelativeFrame(.horizontal)
                        .id(tab)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        .scrollIndicators(.never)
        .scrollPosition(id: scrollSelection)
        .background(ScrollWheelPager(onStep: step))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func page(for tab: FavoriteFolderEditorTab) -> some View {
        Group {
            switch tab {
            case .general:
                generalSettings
            case .filters:
                filterSettings
            }
        }
        .padding(.top, 14)
    }

    private func step(_ direction: Int) {
        let tabs = FavoriteFolderEditorTab.allCases
        guard let index = tabs.firstIndex(of: selectedTab) else { return }
        let next = index + direction
        guard tabs.indices.contains(next) else { return }
        withAnimation(pageAnimation) {
            selectedTab = tabs[next]
        }
    }

    private var pickerSelection: Binding<FavoriteFolderEditorTab> {
        Binding(
            get: { selectedTab },
            set: { tab in
                withAnimation(pageAnimation) {
                    selectedTab = tab
                }
            }
        )
    }

    private var scrollSelection: Binding<FavoriteFolderEditorTab?> {
        Binding(
            get: { selectedTab },
            set: { tab in
                guard let tab else { return }
                selectedTab = tab
            }
        )
    }

    private var generalSettings: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                TextField(L.text("collection.name"), text: $name)
                    .focused($nameFocused)
                    .onSubmit(save)
                Text(L.text("common.icon"))
                    .font(.subheadline)
                    .padding(.horizontal, 6)
                    .padding(.top, 8)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 7), spacing: 8) {
                    ForEach(CollectionIcon.allCases) { option in
                        Button {
                            icon = option
                        } label: {
                            AnimatedSymbolIcon(symbol: option.symbolName, isSelected: icon == option)
                                .font(.system(size: 18))
                                .frame(maxWidth: .infinity, minHeight: 32)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .tint(icon == option ? themeColor : .secondary)
                        .accessibilityLabel(option.title)
                        .accessibilityAddTraits(icon == option ? .isSelected : [])
                        .help(option.title)
                    }
                }
                HStack {
                    Text(L.text("common.color"))
                        .font(.subheadline)
                        .padding(.horizontal, 6)
                    Spacer()
                    Text(color.title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 6)
                }
                .padding(.top, 8)
                HStack(spacing: 8) {
                    ForEach(CollectionColor.allCases) { option in
                        colorSwatch(option)
                    }
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var filterSettings: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(L.text("library.searchFonts"))
                        .font(.system(size: 12))
                        .padding(.horizontal, 6)
                        .padding(.top, 8)
                    Text(L.text("library.searchHint"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 6)
                }
                TextField(L.text("filters.inputKeyword"), text: $text)
                    .textFieldStyle(.roundedBorder)
                VStack(alignment: .leading, spacing: 6) {
                    Text(L.text("filters.conditions"))
                        .font(.system(size: 12))
                        .padding(.horizontal, 6)
                        .padding(.top, 8)
                    Text(L.text("filters.smartHint"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 6)
                }
                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 100)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(FacetKind.allCases, id: \.self) { kind in
                            let facetOptions = options.filter { $0.kind == kind }
                            if !facetOptions.isEmpty {
                                FacetDisclosureGroupView(
                                    kind: kind,
                                    options: facetOptions,
                                    selectedFacets: selectedFacets,
                                    titleFont: .system(size: 12),
                                    onToggle: toggle
                                )
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
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
