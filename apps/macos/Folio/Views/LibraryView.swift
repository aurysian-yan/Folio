import SwiftUI

enum LibraryLayout {
    static let titleMaxWidth: CGFloat = 960
    static let cardContainerMaxWidth = titleMaxWidth + 256
}

struct LibraryView: View {
    @Bindable var model: LibraryViewModel

    var body: some View {
        Group {
            if model.snapshot.roots.isEmpty, !model.isLoading {
                emptyLibrary
            } else {
                gridContent
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            PreviewBar(model: model)
        }
        .navigationTitle("Folio")
        .navigationSubtitle("\(model.totalMatches) 个字族")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Picker("浏览方式", selection: $model.viewMode) {
                    ForEach(LibraryViewMode.allCases) { mode in
                        Image(systemName: mode.symbolName)
                            .accessibilityLabel(mode.accessibilityTitle)
                            .tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 145)
            }
            ToolbarItem(placement: .primaryAction) {
                ToolbarSearchField(text: $model.searchText)
                    .frame(width: 130)
            }
            if #available(macOS 26.0, *) {
                ToolbarSpacer(.fixed, placement: .primaryAction)
            }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("导入字体", systemImage: "plus") { model.importFiles() }
                    Button("添加文件夹", systemImage: "folder.badge.plus") { model.addFolder() }
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("添加字体")
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    withAnimation(.default) {
                        model.filterExpanded.toggle()
                    }
                } label: {
                    Image(systemName: "line.3.horizontal.decrease")
                }
                .accessibilityLabel("筛选")
                .help("显示或隐藏筛选")
            }
            if #available(macOS 26.0, *) {
                ToolbarSpacer(.fixed, placement: .primaryAction)
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    model.inspectorPresented.toggle()
                } label: {
                    Image(systemName: "sidebar.right")
                }
                .accessibilityLabel("检查器")
                .help("显示或隐藏检查器")
            }
        }
        .overlay(alignment: .top) {
            if model.isRefreshing {
                ProgressView()
                    .controlSize(.small)
                    .padding(8)
            }
        }
    }

    private var gridContent: some View {
        ScrollView {
            VStack(spacing: 0) {
                libraryHeader
                if model.families.isEmpty, !model.isLoading {
                    noResults
                        .frame(minHeight: 260)
                } else {
                    FontGridView(model: model)
                }
            }
        }
    }

    private var libraryHeader: some View {
        VStack(spacing: 18) {
            if model.selectedDestination == .allFonts {
                LibraryHeroView(presentation: model.hero)
            }
            FacetFilterView(model: model)
        }
        .padding(.horizontal, 48)
        .padding(.top, 42)
        .padding(.bottom, 32)
        .frame(maxWidth: LibraryLayout.titleMaxWidth)
        .frame(maxWidth: .infinity)
    }

    private var emptyLibrary: some View {
        ContentUnavailableView {
            Label("Folio", systemImage: "textformat")
        } description: {
            Text("添加你的第一个字体文件夹")
        } actions: {
            Button("导入字体", systemImage: "plus", action: model.importFiles)
                .buttonStyle(.borderedProminent)
            Button("添加文件夹", systemImage: "folder.badge.plus", action: model.addFolder)
        }
    }

    private var noResults: some View {
        ContentUnavailableView(
            "没有匹配的字体",
            systemImage: "text.magnifyingglass",
            description: Text("尝试更改搜索内容或筛选条件")
        )
    }
}

private struct ToolbarSearchField: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("搜索", text: $text)
                .textFieldStyle(.plain)
            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("清除搜索")
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 28)
        .background(.regularMaterial, in: Capsule())
        .overlay {
            Capsule()
                .stroke(Color.primary.opacity(0.1), lineWidth: 0.5)
        }
    }
}

#if DEBUG
#Preview("1200 × 800") {
    RootView()
        .frame(width: 1200, height: 800)
}

#Preview("900 × 650") {
    RootView()
        .frame(width: 900, height: 650)
}

#Preview("512 × 468") {
    RootView()
        .frame(width: 512, height: 468)
}
#endif
