import SwiftUI

struct RootView: View {
    @State private var model = LibraryViewModel()
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @AppStorage(AppPreferences.libraryViewMode) private var preferredViewMode =
        LibraryViewMode.compactGrid.rawValue
    @AppStorage(AppPreferences.previewSize) private var preferredPreviewSize = 48.0

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView(model: model)
                .navigationSplitViewColumnWidth(min: 160, ideal: 240, max: 300)
        } detail: {
            LibraryView(model: model)
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
        .task { model.start() }
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
        .sheet(isPresented: $model.isCreatingCollection) {
            NewCollectionView(model: model)
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
    }
}

private struct ImportReportView: View {
    @Bindable var model: LibraryViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("导入结果")
                .font(.headline)
            List {
                Section("导入") {
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
                if model.importOutcomes.contains(where: { $0.error == nil }) {
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

private struct NewCollectionView: View {
    @Bindable var model: LibraryViewModel
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("新建收藏夹")
                .font(.headline)
            TextField("收藏夹名称", text: $model.newCollectionName)
                .focused($focused)
                .onSubmit(model.createCollection)
            HStack {
                Spacer()
                Button("取消") {
                    model.isCreatingCollection = false
                    model.newCollectionName = ""
                }
                .keyboardShortcut(.cancelAction)
                Button("创建", action: model.createCollection)
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.newCollectionName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding()
        .frame(width: 360)
        .onAppear { focused = true }
    }
}
