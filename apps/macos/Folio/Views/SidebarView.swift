import SwiftUI

struct SidebarView: View {
    @Bindable var model: LibraryViewModel

    var body: some View {
        List(selection: $model.selectedDestination) {
            Section("本地") {
                sidebarRow("全部字体", symbol: "textformat.alt", count: model.snapshot.familyCount, destination: .allFonts)
                    .tag(SidebarDestination.allFonts)
                sidebarRow("最近", symbol: "clock", count: model.snapshot.recentCount, destination: .recent)
                    .tag(SidebarDestination.recent)
                sidebarRow("收藏", symbol: "star", count: nil, destination: .favorites)
                    .tag(SidebarDestination.favorites)
            }

            Section("字体状态") {
                sidebarRow("已挂载", symbol: "checkmark.diamond", count: model.fontStateCounts[.active] ?? 0, destination: .fontState(.active))
                    .tag(SidebarDestination.fontState(.active))
                    .help("当前登录会话已激活")
                sidebarRow("已安装", symbol: "square.and.arrow.down", count: model.fontStateCounts[.installed] ?? 0, destination: .fontState(.installed), speed: 1.29)
                    .tag(SidebarDestination.fontState(.installed))
                    .help("包含手动安装和 Folio 安装的字体")
                sidebarRow("仅在字体库", symbol: "book.closed", count: model.fontStateCounts[.available] ?? 0, destination: .fontState(.available))
                    .tag(SidebarDestination.fontState(.available))
                    .help("Folio 字体库中尚未挂载或安装的副本")
                sidebarRow("外部文件", symbol: "doc", count: model.fontStateCounts[.external] ?? 0, destination: .fontState(.external))
                    .tag(SidebarDestination.fontState(.external))
                    .help("引用的文件和已添加文件夹中的字体")
                sidebarRow("系统字体", symbol: "laptopcomputer.and.arrow.down", count: model.fontStateCounts[.system] ?? 0, destination: .fontState(.system))
                    .tag(SidebarDestination.fontState(.system))
                sidebarRow("文件不可用", symbol: "exclamationmark.triangle", count: model.fontStateCounts[.unavailable] ?? 0, destination: .fontState(.unavailable))
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
                    SidebarSymbolIcon(symbol: "stethoscope", isSelected: model.selectedDestination == .fontHealth)
                }
                    .badge(healthCount)
                    .tag(SidebarDestination.fontHealth)
            }

            Section {
                ForEach(model.snapshot.collections) { collection in
                    sidebarRow(
                        collection.name,
                        symbol: collection.icon.symbolName,
                        count: collection.memberCount,
                        destination: .collection(collection.id),
                        symbolColor: collection.color.color
                    )
                        .tag(SidebarDestination.collection(collection.id))
                        .contextMenu {
                            Button("编辑收藏夹…") {
                                model.collectionEditor = .edit(collection)
                            }
                            Button("删除收藏夹", role: .destructive) {
                                model.deleteCollection(collection)
                            }
                        }
                }
                Button {
                    model.collectionEditor = .create
                } label: {
                    HStack(spacing: 8) {
                        Image.englishSystemName("plus")
                            .foregroundStyle(Color.secondary)
                        Text("新收藏夹")
                            .foregroundStyle(Color.secondary)
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

    private func sidebarRow(
        _ title: String,
        symbol: String,
        count: UInt64?,
        destination: SidebarDestination,
        speed: Double = 0.76,
        symbolColor: Color? = nil
    ) -> some View {
        let isSelected = model.selectedDestination == destination
        return HStack {
            Label {
                Text(title)
                    .foregroundStyle(isSelected && symbolColor != nil ? Color.white : Color.primary)
            } icon: {
                if let symbolColor {
                    SidebarSymbolIcon(
                        symbol: symbol,
                        isSelected: isSelected,
                        speed: speed
                    )
                    .foregroundStyle(isSelected ? .white : symbolColor)
                } else {
                    SidebarSymbolIcon(
                        symbol: symbol,
                        isSelected: isSelected,
                        speed: speed
                    )
                }
            }
            Spacer()
            if let count {
                Text(count, format: .number)
                    .foregroundStyle(isSelected && symbolColor != nil ? Color.white.opacity(0.88) : Color.secondary)
                    .monospacedDigit()
            }
        }
    }

}

/// 侧栏图标：切换到该项时先播消失动画，再紧接着用绘制动画出现。
/// 绘制效果需要 macOS 26，旧系统与减弱动态效果下直接显示静态图标。
private struct SidebarSymbolIcon: View {
    let symbol: String
    let isSelected: Bool
    var speed: Double = 0.63

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isVisible = true

    var body: some View {
        ZStack {
            Image.englishSystemName(symbol)
                .opacity(0)
            icon
        }
        .onChange(of: isSelected) { _, selected in
            guard selected else { return }
            replay()
        }
    }

    @ViewBuilder
    private var icon: some View {
        if #available(macOS 26.0, *) {
            if isVisible {
                Image.englishSystemName(symbol)
                    .transition(AnyTransition.asymmetric(
                        insertion: AnyTransition(.symbolEffect(.drawOn, options: .speed(speed))),
                        removal: AnyTransition(.symbolEffect(.disappear, options: .speed(speed)))
                    ))
            }
        } else {
            Image.englishSystemName(symbol)
        }
    }

    private func replay() {
        guard #available(macOS 26.0, *), !reduceMotion else { return }
        withAnimation(.easeOut(duration: 0.33), completionCriteria: .removed) {
            isVisible = false
        } completion: {
            withAnimation(.easeIn(duration: 0.48)) {
                isVisible = true
            }
        }
    }
}

#if DEBUG
#Preview("侧边栏") {
    @Previewable @State var model = SidebarPreviewModel.make()
    SidebarView(model: model)
        .frame(width: 240, height: 720)
}

@MainActor
private enum SidebarPreviewModel {
    static func make() -> LibraryViewModel {
        let model = LibraryViewModel()
        model.snapshot = LibrarySnapshot(
            familyCount: 463,
            faceCount: 812,
            variableFamilyCount: 96,
            recentCount: 12,
            collections: [
                CollectionSummary(id: CollectionID(rawValue: "sans"), name: "无衬线", icon: .type, color: .blue, memberCount: 24),
                CollectionSummary(id: CollectionID(rawValue: "serif"), name: "衬线", icon: .books, color: .purple, memberCount: 18)
            ],
            roots: [],
            health: HealthSummary(
                damagedFiles: 1,
                duplicateSources: 0,
                multipleRevisions: 2,
                metadataConflicts: 0
            )
        )
        model.fontStateCounts = [
            .active: 128,
            .installed: 210,
            .available: 96,
            .external: 18,
            .system: 11,
            .unavailable: 2
        ]
        return model
    }
}
#endif
