import SwiftUI

struct SidebarView: View {
    @Bindable var model: LibraryViewModel

    var body: some View {
        List(selection: $model.selectedDestination) {
            Section("本地") {
                sidebarRow("全部字体", symbol: "textformat", count: model.snapshot.familyCount)
                    .tag(SidebarDestination.allFonts)
                sidebarRow("最近", symbol: "clock", count: model.snapshot.recentCount)
                    .tag(SidebarDestination.recent)
                sidebarRow("收藏", symbol: "star", count: nil)
                    .tag(SidebarDestination.favorites)
            }

            Section("工具") {
                Label("在线字体", systemImage: "globe")
                    .foregroundStyle(.tertiary)
                    .help("在线字体将在后续版本提供")
                Label("字体健康", systemImage: "stethoscope")
                    .badge(healthCount)
                    .tag(SidebarDestination.fontHealth)
            }

            Section {
                ForEach(model.snapshot.collections) { collection in
                    sidebarRow(collection.name, symbol: "folder", count: collection.memberCount)
                        .tag(SidebarDestination.collection(collection.id))
                        .contextMenu {
                            Button("删除收藏夹", role: .destructive) {
                                model.deleteCollection(collection)
                            }
                        }
                }
                Button {
                    model.isCreatingCollection = true
                } label: {
                    Label("新收藏夹", systemImage: "plus")
                }
                .buttonStyle(.plain)
            } header: {
                Text("收藏夹")
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Folio")
    }

    private var healthCount: Int {
        let health = model.snapshot.health
        return Int(health.damagedFiles + health.multipleRevisions + health.metadataConflicts)
    }

    private func sidebarRow(_ title: String, symbol: String, count: UInt64?) -> some View {
        HStack {
            Label(title, systemImage: symbol)
            Spacer()
            if let count {
                Text(count, format: .number)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
    }

}
