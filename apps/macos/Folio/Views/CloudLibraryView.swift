import SwiftUI

struct CloudLibraryView: View {
    @Bindable var model: LibraryViewModel
    @State private var cloud = CloudSyncModel.shared
    @State private var searchText = ""
    @State private var pendingDeletion: CloudFontDto?

    private var visibleFonts: [CloudFontDto] {
        let active = cloud.fonts.filter { !$0.deleted }
        guard !searchText.isEmpty else { return active }
        return active.filter {
            $0.displayName.localizedStandardContains(searchText)
                || $0.filename.localizedStandardContains(searchText)
        }
    }

    private func syncItemLabel(_ item: SyncItemDto) -> String {
        let action = item.action == "download" ? "下载" : "上传"
        switch item.status {
        case "running": return "\(action)中"
        case "done": return "\(action)完成"
        default: return "等待\(action)"
        }
    }

    private func syncItemSymbol(_ item: SyncItemDto) -> String {
        if item.action == "download" {
            return item.status == "done" ? "checkmark.circle.fill" : "arrow.down.circle"
        }
        return item.status == "done" ? "checkmark.circle.fill" : "arrow.up.circle"
    }

    private func syncItemTint(_ item: SyncItemDto) -> Color {
        switch item.status {
        case "running": return .accentColor
        case "done": return .green
        default: return .secondary
        }
    }

    var body: some View {
        List {
            if !cloud.conflicts.isEmpty {
                Section("同步冲突") {
                    ForEach(cloud.conflicts, id: \.id) { conflict in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(conflict.title)
                            Text(conflict.detail)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            HStack {
                                Button("保留两版") { cloud.resolve(conflict, using: .keepBoth) }
                                Button("采用本地版") { cloud.resolve(conflict, using: .useLocal) }
                                Button("采用云端版") { cloud.resolve(conflict, using: .useRemote) }
                            }
                            .controlSize(.small)
                        }
                    }
                }
            }
            Section("云字体库") {
                ForEach(visibleFonts, id: \.fingerprint) { font in
                    HStack {
                        Image.englishSystemName(font.cloudOnly ? "icloud" : "checkmark.icloud")
                        VStack(alignment: .leading) {
                            Text(font.displayName)
                            if let item = cloud.syncItem(for: font.fingerprint) {
                                Label {
                                    Text(syncItemLabel(item))
                                } icon: {
                                    Image.englishSystemName(syncItemSymbol(item))
                                }
                                .font(.caption)
                                .foregroundStyle(syncItemTint(item))
                            } else {
                                Text(font.cloudOnly ? "仅在云端" : "本机可用")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if font.cloudOnly {
                            Button("下载") { cloud.restore(font) }
                        } else {
                            Button("仅保留云端") { model.removeCloudFont(font) }
                        }
                        Menu {
                            Button("从所有设备删除", role: .destructive) {
                                pendingDeletion = font
                            }
                        } label: {
                            Image.englishSystemName("ellipsis")
                        }
                        .menuStyle(.borderlessButton)
                    }
                }
            }
            let deleted = cloud.fonts.filter { $0.deleted }
            if !deleted.isEmpty {
                Section("最近删除") {
                    ForEach(deleted, id: \.fingerprint) { font in
                        HStack {
                            Text(font.displayName)
                            Spacer()
                            Button("恢复") { cloud.restoreDeleted(font) }
                        }
                    }
                }
            }
        }
        .overlay {
            if !cloud.isConnected {
                ContentUnavailableView("连接云字体库", systemImage: "icloud", description: Text("在设置中连接 WebDAV 后，字体会显示在这里。"))
            } else if cloud.fonts.isEmpty && cloud.conflicts.isEmpty {
                ContentUnavailableView("云字体库为空", systemImage: "icloud")
            }
        }
        .searchable(text: $searchText, placement: .toolbar, prompt: "搜索云端字体")
        .navigationTitle(cloud.isConnected ? cloud.connectionName : "云字体库")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if cloud.isRunning {
                    Button("取消同步") { cloud.cancel() }
                } else {
                    Button("同步") { cloud.syncNow() }
                        .disabled(!cloud.isConnected)
                }
            }
        }
        .confirmationDialog(
            "从所有设备删除字体？",
            isPresented: Binding(
                get: { pendingDeletion != nil },
                set: { if !$0 { pendingDeletion = nil } }
            )
        ) {
            Button("从所有设备删除", role: .destructive) {
                if let pendingDeletion { model.deleteCloudFontEverywhere(pendingDeletion) }
                pendingDeletion = nil
            }
        } message: {
            Text("删除记录可恢复，但该字体将从所有已连接设备移除。")
        }
        .alert("云字体库", isPresented: Binding(
            get: { cloud.errorMessage != nil },
            set: { if !$0 { cloud.errorMessage = nil } }
        )) {
            Button("好") { cloud.errorMessage = nil }
        } message: {
            Text(cloud.errorMessage ?? "无法完成操作")
        }
    }
}
