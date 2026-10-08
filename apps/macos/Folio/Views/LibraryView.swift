import SwiftUI

enum LibraryLayout {
    static let titleMaxWidth: CGFloat = 960
    static let cardContainerMaxWidth = titleMaxWidth + 256
}

struct LibraryView: View {
    @Bindable var model: LibraryViewModel
    @State private var cloud = CloudSyncModel.shared
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        Group {
            if model.snapshot.roots.isEmpty, model.families.isEmpty, !model.isLoading {
                emptyLibrary
            } else {
                gridContent
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if model.isSelectingInstalledForCloud {
                installedCloudSelectionBar
            } else {
                PreviewBar(model: model)
            }
        }
        .navigationTitle("Folio")
        .navigationSubtitle(L.plural("library.familyCount", Int(model.totalMatches)))
        .searchable(text: $model.searchText, placement: .toolbar, prompt: L.text("common.search"))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Picker(L.text("fontLocation.title"),selection:$model.locationFilter) {
                    ForEach(["all","local","cloudOnly","both","pendingUpload","excluded"],id:\.self) { filter in Text(L.text("fontLocation.\(filter)")).tag(filter) }
                }
            }
            if model.selectedDestination == .fontState(.installed) {
                ToolbarItem(placement: .primaryAction) {
                    Button(model.isSelectingInstalledForCloud ? L.text("macos.cancelSelection") : L.text("library.multiSelect")) {
                        if model.isSelectingInstalledForCloud {
                            model.endInstalledCloudSelection()
                        } else {
                            model.beginInstalledCloudSelection()
                        }
                    }
                    .disabled(model.isAddingInstalledToCloud)
                }
            }
            ToolbarItem(placement: .navigation) {
                Picker(L.text("libraryView.browseMode"), selection: $model.viewMode) {
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
                            Text(L.text("import.importFonts"))
                        } icon: {
                            Image.englishSystemName("plus")
                        }
                    }
                    Button {
                        model.addFolder()
                    } label: {
                        Label {
                            Text(L.text("import.addFolder"))
                        } icon: {
                            Image.englishSystemName("folder.badge.plus")
                        }
                    }
                } label: {
                    Image.englishSystemName("plus")
                }
                .accessibilityLabel(L.text("import.addFonts"))
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
                .accessibilityLabel(L.text("inspector.panel"))
                .help(L.text("inspector.showOrHide"))
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

    private var installedCloudSelectionBar: some View {
        HStack {
            Text(L.format("macos.selectedFamilies", String(model.selectedInstalledFamilyIDs.count)))
            Spacer()
            if model.isAddingInstalledToCloud {
                ProgressView()
                    .controlSize(.small)
            }
            Button(L.text("common.cancel")) { model.endInstalledCloudSelection() }
                .disabled(model.isAddingInstalledToCloud)
            Button(L.text("import.addToCloud")) { model.addSelectedInstalledFontsToCloud() }
                .buttonStyle(.borderedProminent)
                .disabled(
                    model.selectedInstalledFamilyIDs.isEmpty
                        || !cloud.isConnected
                        || model.isAddingInstalledToCloud
                )
                .help(cloud.isConnected ? L.text("import.addToCloudSync") : L.text("cloud.connectCloudFirst"))
        }
        .padding()
        .background(.bar)
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

    @ViewBuilder
    private var libraryHeader: some View {
        if model.selectedDestination == .allFonts {
            LibraryHeroView(presentation: model.hero) { action in
                switch action {
                case .fontHealth: model.selectedDestination = .fontHealth
                case .cloudFonts: model.selectedDestination = .cloudFonts
                case .cloudSettings: openSettings()
                }
            }
                .padding(.horizontal, 48)
                .padding(.top, 42)
                .padding(.bottom, 32)
                .frame(maxWidth: LibraryLayout.titleMaxWidth)
                .frame(maxWidth: .infinity)
        }
    }

    private var emptyLibrary: some View {
        ContentUnavailableView {
            Label {
                Text("Folio")
            } icon: {
                Image.englishSystemName("textformat")
            }
        } description: {
            Text(L.text("import.addFirstFolder"))
        } actions: {
            Button(action: model.importFiles) {
                Label {
                    Text(L.text("import.importFonts"))
                } icon: {
                    Image.englishSystemName("plus")
                }
            }
                .buttonStyle(.borderedProminent)
            Button(action: model.addFolder) {
                Label {
                    Text(L.text("import.addFolder"))
                } icon: {
                    Image.englishSystemName("folder.badge.plus")
                }
            }
        }
    }

    private var noResults: some View {
        ContentUnavailableView {
            Label {
                Text(L.text("common.noMatch"))
            } icon: {
                Image.englishSystemName("text.magnifyingglass")
            }
        } description: {
            Text(L.text("library.emptySearchHintShort"))
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
