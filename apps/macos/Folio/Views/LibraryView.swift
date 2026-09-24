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
        .searchable(text: $model.searchText, placement: .toolbar, prompt: "搜索")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Picker("浏览方式", selection: $model.viewMode) {
                    ForEach(LibraryViewMode.allCases) { mode in
                        Image.englishSystemName(mode.symbolName)
                            .accessibilityLabel(mode.accessibilityTitle)
                            .tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 145)
            }
            if #available(macOS 26.0, *) {
                ToolbarSpacer(.fixed, placement: .primaryAction)
            }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button {
                        model.importFiles()
                    } label: {
                        Label {
                            Text("导入字体")
                        } icon: {
                            Image.englishSystemName("plus")
                        }
                    }
                    Button {
                        model.addFolder()
                    } label: {
                        Label {
                            Text("添加文件夹")
                        } icon: {
                            Image.englishSystemName("folder.badge.plus")
                        }
                    }
                } label: {
                    Image.englishSystemName("plus")
                }
                .accessibilityLabel("添加字体")
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    withAnimation(.default) {
                        model.filterExpanded.toggle()
                    }
                } label: {
                    Image.englishSystemName("line.3.horizontal.decrease")
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
                    Image.englishSystemName("sidebar.right")
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
            Label {
                Text("Folio")
            } icon: {
                Image.englishSystemName("textformat")
            }
        } description: {
            Text("添加你的第一个字体文件夹")
        } actions: {
            Button(action: model.importFiles) {
                Label {
                    Text("导入字体")
                } icon: {
                    Image.englishSystemName("plus")
                }
            }
                .buttonStyle(.borderedProminent)
            Button(action: model.addFolder) {
                Label {
                    Text("添加文件夹")
                } icon: {
                    Image.englishSystemName("folder.badge.plus")
                }
            }
        }
    }

    private var noResults: some View {
        ContentUnavailableView {
            Label {
                Text("没有匹配的字体")
            } icon: {
                Image.englishSystemName("text.magnifyingglass")
            }
        } description: {
            Text("尝试更改搜索内容或筛选条件")
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
