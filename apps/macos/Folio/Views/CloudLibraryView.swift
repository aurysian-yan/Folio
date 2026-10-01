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
        let action = item.action == "download" ? L.text("cloud.download") : L.text("cloud.upload")
        switch item.status {
        case "running": return L.format("cloud.running", action)
        case "done": return L.format("cloud.completed", action)
        default: return L.format("cloud.waiting", action)
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
                Section(L.text("cloud.conflicts")) {
                    ForEach(cloud.conflicts, id: \.id) { conflict in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(conflict.title)
                            Text(conflict.detail)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            HStack {
                                Button(L.text("cloud.keepBoth")) { cloud.resolve(conflict, using: .keepBoth) }
                                Button(L.text("cloud.useLocal")) { cloud.resolve(conflict, using: .useLocal) }
                                Button(L.text("cloud.useRemote")) { cloud.resolve(conflict, using: .useRemote) }
                            }
                            .controlSize(.small)
                        }
                    }
                }
            }
            Section(L.text("cloud.library")) {
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
                                Text(font.cloudOnly ? L.text("cloud.cloudOnly") : L.text("cloud.availableLocally"))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if font.cloudOnly {
                            Button(L.text("cloud.download")) { cloud.restore(font) }
                        } else {
                            Button(L.text("cloud.keepCloudOnly")) { model.removeCloudFont(font) }
                        }
                        Menu {
                            Button(L.text("cloud.deleteEverywhere"), role: .destructive) {
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
                Section(L.text("cloud.recentlyDeleted")) {
                    ForEach(deleted, id: \.fingerprint) { font in
                        HStack {
                            Text(font.displayName)
                            Spacer()
                            Button(L.text("cloud.restore")) { cloud.restoreDeleted(font) }
                        }
                    }
                }
            }
        }
        .overlay {
            if !cloud.isConnected {
                ContentUnavailableView(L.text("cloud.connectTitle"), systemImage: "icloud", description: Text(L.text("cloud.connectInSettingsHint")))
            } else if cloud.fonts.isEmpty && cloud.conflicts.isEmpty {
                ContentUnavailableView(L.text("cloud.empty"), systemImage: "icloud")
            }
        }
        .searchable(text: $searchText, placement: .toolbar, prompt: L.text("cloud.searchCloud"))
        .navigationTitle(cloud.isConnected ? cloud.connectionName : L.text("cloud.library"))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if cloud.isRunning {
                    Button(L.text("cloud.cancelSync")) { cloud.cancel() }
                } else {
                    Button(L.text("cloud.syncNow")) { cloud.syncNow() }
                        .disabled(!cloud.isConnected)
                }
            }
        }
        .confirmationDialog(
            L.text("cloud.deleteConfirmTitle"),
            isPresented: Binding(
                get: { pendingDeletion != nil },
                set: { if !$0 { pendingDeletion = nil } }
            )
        ) {
            Button(L.text("cloud.deleteEverywhere"), role: .destructive) {
                if let pendingDeletion { model.deleteCloudFontEverywhere(pendingDeletion) }
                pendingDeletion = nil
            }
        } message: {
            Text(L.text("cloud.deleteConfirmMessage"))
        }
        .alert(L.text("cloud.library"), isPresented: Binding(
            get: { cloud.errorMessage != nil },
            set: { if !$0 { cloud.errorMessage = nil } }
        )) {
            Button(L.text("common.ok")) { cloud.errorMessage = nil }
        } message: {
            Text(cloud.errorMessage ?? L.text("common.operationFailed"))
        }
    }
}
