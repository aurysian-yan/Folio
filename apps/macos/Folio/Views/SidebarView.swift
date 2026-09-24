import SwiftUI

struct SidebarView: View {
    @Bindable var model: LibraryViewModel

    var body: some View {
        List(selection: $model.selectedDestination) {
            Section("本地") {
                sidebarRow("全部字体", symbol: "textformat.alt", count: model.snapshot.familyCount)
                    .tag(SidebarDestination.allFonts)
                sidebarRow("最近", symbol: "clock", count: model.snapshot.recentCount)
                    .tag(SidebarDestination.recent)
                sidebarRow("收藏", symbol: "star", count: nil)
                    .tag(SidebarDestination.favorites)
            }

            Section("字体状态") {
                sidebarRow("已挂载", symbol: "checkmark.diamond", count: model.fontStateCounts[.active] ?? 0)
                    .tag(SidebarDestination.fontState(.active))
                    .help("当前登录会话已激活")
                sidebarRow("已安装", symbol: "minus.diamond", count: model.fontStateCounts[.installed] ?? 0)
                    .tag(SidebarDestination.fontState(.installed))
                    .help("包含手动安装和 Folio 安装的字体")
                sidebarRow("仅在字体库", symbol: "plus.diamond", count: model.fontStateCounts[.available] ?? 0)
                    .tag(SidebarDestination.fontState(.available))
                    .help("Folio 字体库中尚未挂载或安装的副本")
                sidebarRow("外部文件", symbol: "doc", count: model.fontStateCounts[.external] ?? 0)
                    .tag(SidebarDestination.fontState(.external))
                    .help("引用的文件和已添加文件夹中的字体")
                sidebarRow("系统字体", symbol: "laptopcomputer.and.arrow.down", count: model.fontStateCounts[.system] ?? 0)
                    .tag(SidebarDestination.fontState(.system))
                sidebarRow("文件不可用", symbol: "exclamationmark.triangle", count: model.fontStateCounts[.unavailable] ?? 0)
                    .tag(SidebarDestination.fontState(.unavailable))
            }

            Section("工具") {
                Label {
                    Text("在线字体")
                } icon: {
                    Image.englishSystemName("globe")
                }
                    .foregroundStyle(.tertiary)
                    .help("在线字体将在后续版本提供")
                Label {
                    Text("字体健康")
                } icon: {
                    Image.englishSystemName("stethoscope")
                }
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
                    Label {
                        Text("新收藏夹")
                    } icon: {
                        Image.englishSystemName("plus")
                    }
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
            Label {
                Text(title)
            } icon: {
                Image.englishSystemName(symbol)
            }
            Spacer()
            if let count {
                Text(count, format: .number)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
    }

}
