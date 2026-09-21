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
                .inspectorColumnWidth(min: 220, ideal: 284, max: 360)
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
        .background(WindowSizeController())
        .task { model.start() }
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
    }
}

private struct WindowSizeController: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            view.window?.minSize = NSSize(width: 512, height: 468)
        }
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {
        DispatchQueue.main.async {
            guard let window = view.window,
                  window.minSize != NSSize(width: 512, height: 468) else { return }
            window.minSize = NSSize(width: 512, height: 468)
        }
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
