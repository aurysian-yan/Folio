import AppKit
import Observation
import SwiftUI

@MainActor
@Observable
final class LibraryViewModel {
    var snapshot: LibrarySnapshot = .empty
    var families: [FamilyCard] = []
    var facetOptions: [FacetOption] = []
    var selectedFacets: Set<FacetOption> = []
    var selectedDestination: SidebarDestination = .allFonts {
        didSet { scheduleQuery(immediate: true) }
    }
    var selectedFamilyID: FamilyID?
    var selectedFaceID: FaceID?
    var viewMode: LibraryViewMode = .compactGrid
    var searchText = "" {
        didSet { scheduleQuery(immediate: false) }
    }
    var previewMode: PreviewTextMode = .custom
    var customPreviewText = "Folio 字体预览"
    var previewSize = 48.0
    var previewColor = Color.primary
    var cardBackgroundColor: Color?
    var inspectorPresented = true
    var filterExpanded = false
    var isLoading = true
    var isRefreshing = false
    var errorMessage: String?
    var totalMatches: UInt64 = 0
    var axisValues: [String: Double] = [:]
    var isCreatingCollection = false
    var newCollectionName = ""

    private let pageSize = 120
    private var repository: FolioRepository?
    private var startupTask: Task<Void, Never>?
    private var queryTask: Task<Void, Never>?
    private var hasStarted = false

    var previewText: String {
        previewMode.text ?? customPreviewText
    }

    var selectedFamily: FamilyCard? {
        families.first(where: { $0.id == selectedFamilyID })
    }

    var selectedFace: FaceSummary? {
        guard let family = selectedFamily else { return nil }
        return family.faces.first(where: { $0.id == selectedFaceID }) ?? family.defaultFace
    }

    var hero: HeroPresentation {
        Self.hero(for: snapshot)
    }

    func start() {
        guard !hasStarted else { return }
        hasStarted = true
        isLoading = true
        startupTask = Task { [weak self] in
            guard let self else { return }
            do {
                BookmarkStore.shared.restoreAccess()
                let repository = try await Task.detached(priority: .userInitiated) {
                    try FolioRepository()
                }.value
                self.repository = repository
                self.snapshot = try await repository.loadCachedLibrary()
                var refreshedDuringSetup = false
                if self.snapshot.roots.isEmpty,
                   try await repository.addDefaultLibraryRoots() {
                    self.isRefreshing = true
                    self.snapshot = try await repository.refreshLibrary()
                    self.isRefreshing = false
                    refreshedDuringSetup = true
                }
                try await self.performQuery(reset: true)
                self.isLoading = false
                if !refreshedDuringSetup {
                    self.isRefreshing = true
                    self.snapshot = try await repository.refreshLibrary()
                    try await self.performQuery(reset: true)
                    self.isRefreshing = false
                }
            } catch is CancellationError {
                self.isLoading = false
                self.isRefreshing = false
            } catch {
                self.present(error)
                self.isLoading = false
                self.isRefreshing = false
            }
        }
    }

    func toggleFacet(_ facet: FacetOption) {
        if selectedFacets.contains(facet) {
            selectedFacets.remove(facet)
        } else {
            selectedFacets.insert(facet)
        }
        scheduleQuery(immediate: true)
    }

    func selectFamily(_ family: FamilyCard) {
        selectedFamilyID = family.id
        let face = family.defaultFace
        selectedFaceID = face?.id
        axisValues = Dictionary(uniqueKeysWithValues: (face?.axes ?? []).map {
            ($0.tag, $0.defaultValue)
        })
        inspectorPresented = true
        guard let repository, let identityID = face?.identityID else { return }
        Task {
            do {
                try await repository.recordRecent(identityID)
                snapshot = try await repository.loadCachedLibrary()
            } catch {
                present(error)
            }
        }
    }

    func selectFace(_ face: FaceSummary) {
        selectedFaceID = face.id
        axisValues = Dictionary(uniqueKeysWithValues: face.axes.map {
            ($0.tag, $0.defaultValue)
        })
        guard let repository else { return }
        Task {
            do {
                try await repository.recordRecent(face.identityID)
                snapshot = try await repository.loadCachedLibrary()
            } catch {
                present(error)
            }
        }
    }

    func moveFace(in family: FamilyCard, offset: Int) {
        guard !family.faces.isEmpty else { return }
        let current = family.faces.firstIndex(where: { $0.id == selectedFaceID }) ?? 0
        let next = (current + offset + family.faces.count) % family.faces.count
        selectFace(family.faces[next])
    }

    func toggleFavorite(_ family: FamilyCard) {
        guard let repository else { return }
        let favorite = !family.isFavorite
        Task {
            do {
                try await repository.setFavorite(family, favorite: favorite)
                snapshot = try await repository.loadCachedLibrary()
                try await performQuery(reset: true)
            } catch {
                present(error)
            }
        }
    }

    func setCollection(_ collection: CollectionSummary, family: FamilyCard, member: Bool) {
        guard let repository else { return }
        Task {
            do {
                try await repository.setCollection(collection.id, family: family, member: member)
                snapshot = try await repository.loadCachedLibrary()
                try await performQuery(reset: true)
            } catch {
                present(error)
            }
        }
    }

    func createCollection() {
        let name = newCollectionName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, let repository else { return }
        Task {
            do {
                try await repository.createCollection(name: name)
                snapshot = try await repository.loadCachedLibrary()
                newCollectionName = ""
                isCreatingCollection = false
            } catch {
                present(error)
            }
        }
    }

    func deleteCollection(_ collection: CollectionSummary) {
        guard let repository else { return }
        if selectedDestination == .collection(collection.id) {
            selectedDestination = .allFonts
        }
        Task {
            do {
                try await repository.deleteCollection(collection.id)
                snapshot = try await repository.loadCachedLibrary()
                try await performQuery(reset: true)
            } catch {
                present(error)
            }
        }
    }

    func addFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = "添加字体文件夹"
        guard panel.runModal() == .OK, let url = panel.url, let repository else { return }

        Task {
            do {
                try BookmarkStore.shared.persistAccess(to: url)
                try await repository.addLibraryRoot(url)
                isRefreshing = true
                snapshot = try await repository.refreshLibrary()
                try await performQuery(reset: true)
                isRefreshing = false
            } catch {
                isRefreshing = false
                present(error)
            }
        }
    }

    func revealSelectedFace() {
        guard let path = selectedFace?.sourcePath else { return }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
    }

    func copy(_ value: String?) {
        guard let value, !value.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
    }

    func loadMoreIfNeeded(current family: FamilyCard) {
        guard family.id == families.last?.id,
              UInt64(families.count) < totalMatches,
              !isLoading else { return }
        Task {
            do {
                try await performQuery(reset: false)
            } catch {
                present(error)
            }
        }
    }

    private func scheduleQuery(immediate: Bool) {
        guard hasStarted else { return }
        queryTask?.cancel()
        queryTask = Task { [weak self] in
            guard let self else { return }
            if !immediate {
                try? await Task.sleep(for: .milliseconds(150))
            }
            guard !Task.isCancelled else { return }
            do {
                try await self.performQuery(reset: true)
            } catch is CancellationError {
            } catch {
                self.present(error)
            }
        }
    }

    private func performQuery(reset: Bool) async throws {
        guard let repository else { return }
        isLoading = reset && families.isEmpty
        let offset = reset ? 0 : families.count
        let page = try await repository.query(
            text: searchText,
            destination: selectedDestination,
            facets: selectedFacets,
            offset: offset,
            limit: pageSize
        )
        if reset {
            families = page.families
            facetOptions = page.facets
        } else {
            let existing = Set(families.map(\.id))
            families.append(contentsOf: page.families.filter { !existing.contains($0.id) })
        }
        totalMatches = page.totalMatches
        if let selectedFamilyID, !families.contains(where: { $0.id == selectedFamilyID }) {
            self.selectedFamilyID = nil
            selectedFaceID = nil
        }
        isLoading = false
    }

    private func present(_ error: Error) {
        errorMessage = error.localizedDescription
    }

    static func hero(for snapshot: LibrarySnapshot) -> HeroPresentation {
        let health = snapshot.health
        let summary = "\(snapshot.familyCount) 个字族 · \(snapshot.variableFamilyCount) 个可变字族 · \(snapshot.recentCount) 个最近访问"
        if health.damagedFiles > 0 {
            return HeroPresentation(
                kind: .damaged,
                title: "发现 \(health.damagedFiles) 个损坏字体",
                subtitle: summary,
                detail: "可在字体健康中查看扫描问题"
            )
        }
        if health.metadataConflicts > 0 {
            return HeroPresentation(
                kind: .conflict,
                title: "发现 \(health.metadataConflicts) 个字体冲突",
                subtitle: "\(health.multipleRevisions) 个多版本 · \(health.metadataConflicts) 个元数据冲突",
                detail: summary
            )
        }
        return HeroPresentation(
            kind: .normal,
            title: "现有 \(snapshot.familyCount) 个字族，随时可用",
            subtitle: "\(health.damagedFiles) 个损坏字体 · \(snapshot.variableFamilyCount) 个可变字族 · \(snapshot.recentCount) 个最近访问",
            detail: nil
        )
    }
}

#if DEBUG
extension HeroPresentation {
    static let previewCases: [HeroPresentation] = [
        .init(kind: .normal, title: "现有 670 个字族，随时可用", subtitle: "0 个损坏字体 · 42 个可变字族 · 12 个最近访问", detail: nil),
        .init(kind: .damaged, title: "发现 8 个损坏字体", subtitle: "670 个字族 · 42 个可变字族 · 12 个最近访问", detail: "可在字体健康中查看扫描问题"),
        .init(kind: .update, title: "检测到 3 个字体更新", subtitle: "670 个字族 · 42 个可变字族 · 12 个最近访问", detail: "Google Fonts 中有可用的新版本"),
        .init(kind: .cloudAhead, title: "云端新增 16 个字体", subtitle: "123PAN 中有新的字体可供同步", detail: "预览状态"),
        .init(kind: .localUnsynced, title: "本地有 32 个字体未同步", subtitle: "连接云端后即可同步", detail: "预览状态"),
        .init(kind: .cloudStorageLow, title: "云端空间不足", subtitle: "请释放空间后再同步字体", detail: "预览状态"),
        .init(kind: .conflict, title: "发现 4 个字体冲突", subtitle: "2 个版本冲突 · 2 个命名冲突", detail: "预览状态"),
    ]
}
#endif
