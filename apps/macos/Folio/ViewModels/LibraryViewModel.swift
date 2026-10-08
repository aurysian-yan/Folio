import AppKit
import Observation
import SwiftUI
import UniformTypeIdentifiers

@MainActor
@Observable
private final class FontPreviewSession {
    static let shared = FontPreviewSession()

    var axisValuesByFace: [FaceID: [String: Double]] = [:]
    var inspectorPreviewSize = 16.0
    var inspectorPreviewHeight: CGFloat = 96
    var inspectorPreviewText = "ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789\nThe quick brown fox jumps over the lazy dog.\nPack my box with five dozen liquor jugs."
}

@MainActor
@Observable
final class LibraryViewModel {
    var snapshot: LibrarySnapshot = .empty
    var families: [FamilyCard] = []
    var cloudOnlyFonts: [CloudFontDto] = []
    var carouselTailFamilies: [FamilyCard] = []
    var facetOptions: [FacetOption] = []
    var selectedFacets: Set<FacetOption> = []
    var selectedDestination: SidebarDestination = .allFonts {
        didSet {
            fileFingerprint = nil
            if selectedDestination != .fontState(.installed) { endInstalledCloudSelection() }
            scheduleQuery(immediate: true)
        }
    }
    var isSelectingInstalledForCloud = false
    var selectedInstalledFamilyIDs: Set<FamilyID> = []
    var isAddingInstalledToCloud = false
    var isCloudImportReport = false
    var selectedFamilyID: FamilyID?
    var selectedFaceID: FaceID?
    var selectedSourcePath: String?
    var sourceStatuses: [String: FontSourceStatus] = [:]
    var fontStateCounts: [FontOperationState: UInt64] = [:]
    var importOutcomes: [FontOperationOutcome] = []
    var batchOutcomes: [FontOperationOutcome] = []
    var isImportReportPresented = false
    var isImportChoicePresented = false
    var viewMode: LibraryViewMode {
        didSet {
            UserDefaults.standard.set(
                viewMode.rawValue,
                forKey: AppPreferences.libraryViewMode
            )
        }
    }
    var searchText = "" {
        didSet {
            selectedInstalledFamilyIDs.removeAll()
            scheduleQuery(immediate: false)
        }
    }
    var locationFilter = "all" { didSet { fileFingerprint = nil; scheduleQuery(immediate:true) } }
    private var fileFingerprint: String?

    func openCloudFont(_ font: CloudFontDto) {
        selectedDestination = .allFonts
        searchText = ""
        selectedFacets = []
        locationFilter = "all"
        fileFingerprint = font.fingerprint
        Task {
            do { try await performQuery(reset:true); if let family = families.first { selectFamily(family) } }
            catch { present(error) }
        }
    }

    var previewMode: PreviewTextMode = .pangram
    var customPreviewText = "Sphinx of black quartz, judge my vow."
    var previewSize: Double
    private(set) var committedPreviewSize: Double
    private(set) var isPreviewSizeEditing = false
    private(set) var previewSizeEditingFamilyID: FamilyID?
    private(set) var previewSizeCommitGeneration = 0
    var previewColor = Color.primary
    var cardBackgroundColor: Color?
    var inspectorPresented = true
    var isLoading = true
    var isRefreshing = false
    var errorMessage: String?
    var totalMatches: UInt64 = 0
    var axisValues: [String: Double] = [:] {
        didSet {
            if let selectedFaceID {
                previewSession.axisValuesByFace[selectedFaceID] = axisValues
            }
        }
    }
    var inspectorPreviewSize: Double {
        get { previewSession.inspectorPreviewSize }
        set { previewSession.inspectorPreviewSize = newValue }
    }
    var inspectorPreviewHeight: CGFloat {
        get { previewSession.inspectorPreviewHeight }
        set { previewSession.inspectorPreviewHeight = newValue }
    }
    var inspectorPreviewText: String {
        get { previewSession.inspectorPreviewText }
        set { previewSession.inspectorPreviewText = newValue }
    }
    var favoriteFolderEditor: FavoriteFolderEditorIntent?
    var favoriteFolderSeedText = ""
    var favoriteFolderSeedFacets: Set<FacetOption> = []

    private let pageSize = 120
    @ObservationIgnored private let previewSession = FontPreviewSession.shared
    private var repository: FolioRepository?
    private var operations: FontOperations?
    private var libraryFaceSources: [LibraryFaceSources] = []
    private var faceIDsByState: [FontOperationState: Set<FaceID>] = [:]
    private var sourcePathsByState: [FontOperationState: Set<String>] = [:]
    private var pendingImportURLs: [URL] = []
    private var lastImportURLs: [URL] = []
    private var lastImportMode: FontImportMode = .copy
    private var lastBatchAction: FontAction?
    private var incomingURLs: [URL] = []
    private var incomingTask: Task<Void, Never>?
    private var startupTask: Task<Void, Never>?
    private var queryTask: Task<Void, Never>?
    private var paginationTask: Task<Void, Never>?
    private var carouselTailTask: Task<Void, Never>?
    private var previousCarouselPageTask: Task<Void, Never>?
    private var carouselQueryRevision = 0
    private var requestedFamilyIndex = 0
    private var hasStarted = false

    init() {
        let defaults = UserDefaults.standard
        viewMode = defaults.string(forKey: AppPreferences.libraryViewMode)
            .flatMap(LibraryViewMode.init(rawValue:)) ?? .compactGrid
        let storedPreviewSize = defaults.object(forKey: AppPreferences.previewSize)
            .flatMap { ($0 as? NSNumber)?.doubleValue } ?? 48
        let normalizedPreviewSize = min(max(storedPreviewSize.rounded(), 18), 106)
        previewSize = normalizedPreviewSize
        committedPreviewSize = normalizedPreviewSize
    }

    var previewText: String {
        previewMode.text ?? customPreviewText
    }

    var lastReportedBatchAction: FontAction? {
        lastBatchAction
    }

    func beginPreviewSizeEditing() {
        guard !isPreviewSizeEditing else { return }
        previewSizeEditingFamilyID = selectedFamilyID.flatMap { selectedID in
            families.contains(where: { $0.id == selectedID }) ? selectedID : nil
        } ?? families.first?.id
        isPreviewSizeEditing = true
    }

    func updatePreviewSize(_ size: Double) {
        if !isPreviewSizeEditing {
            beginPreviewSizeEditing()
        }
        previewSize = min(max(size.rounded(), 18), 106)
    }

    func endPreviewSizeEditing() {
        guard isPreviewSizeEditing else { return }
        isPreviewSizeEditing = false
        commitPreviewSize()
    }

    func applyPreferredPreviewSize(_ size: Double) {
        let normalizedSize = min(max(size.rounded(), 18), 106)
        guard normalizedSize != committedPreviewSize || isPreviewSizeEditing else { return }
        isPreviewSizeEditing = false
        previewSizeEditingFamilyID = selectedFamilyID ?? families.first?.id
        previewSize = normalizedSize
        commitPreviewSize()
    }

    func applyPreferredViewMode(_ rawValue: String) {
        guard let mode = LibraryViewMode(rawValue: rawValue), mode != viewMode else { return }
        viewMode = mode
    }

    private func commitPreviewSize() {
        committedPreviewSize = previewSize
        UserDefaults.standard.set(previewSize, forKey: AppPreferences.previewSize)
        previewSizeCommitGeneration &+= 1
    }

    var selectedFamily: FamilyCard? {
        families.first(where: { $0.id == selectedFamilyID })
            ?? carouselTailFamilies.first(where: { $0.id == selectedFamilyID })
    }

    var selectedFace: FaceSummary? {
        guard let family = selectedFamily else { return nil }
        return family.faces.first(where: { $0.id == selectedFaceID }) ?? family.defaultFace
    }

    var selectedSource: FontSource? {
        guard let face = selectedFace else { return nil }
        return face.sources.first(where: { $0.path == selectedSourcePath })
            ?? (face.sources.count == 1 ? face.sources.first : nil)
    }

    var hero: HeroPresentation {
        Self.hero(for: snapshot, profile: CloudSyncModel.shared.profile, status: CloudSyncModel.shared.status,
            fonts: CloudSyncModel.shared.fonts, conflicts: CloudSyncModel.shared.conflicts,
            cloudLoaded: CloudSyncModel.shared.stateLoaded, readError: CloudSyncModel.shared.stateReadError,
            connectionName: CloudSyncModel.shared.connectionName)
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
                self.operations = try FontOperations(repository: repository)
                if !self.pendingImportURLs.isEmpty {
                    self.queueImport(self.pendingImportURLs)
                }
                self.snapshot = try await repository.loadCachedLibrary()
                try await repository.migrateLegacyUserFontRoot(self.snapshot.roots)
                try await self.reloadLibrarySources()
                var refreshedDuringSetup = false
                if self.snapshot.roots.isEmpty,
                   try await repository.addDefaultLibraryRoots() {
                    self.isRefreshing = true
                    self.snapshot = try await repository.refreshLibrary()
                    try await self.reloadLibrarySources()
                    self.isRefreshing = false
                    refreshedDuringSetup = true
                }
                try await self.performQuery(reset: true)
                self.isLoading = false
                if !refreshedDuringSetup {
                    self.isRefreshing = true
                    self.snapshot = try await repository.refreshLibrary()
                    try await self.reloadLibrarySources()
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

    func reloadAfterSync() {
        guard let repository else { return }
        let retainedCount = families.count
        Task {
            do {
                isRefreshing = true
                snapshot = try await repository.refreshLibrary()
                try await reloadLibrarySources()
                try await performQuery(reset: true, retainingCount: retainedCount)
                isRefreshing = false
            } catch {
                isRefreshing = false
                present(error)
            }
        }
    }

    func toggleFacet(_ facet: FacetOption) {
        selectedInstalledFamilyIDs.removeAll()
        if selectedFacets.contains(facet) {
            selectedFacets.remove(facet)
        } else {
            selectedFacets.insert(facet)
        }
        scheduleQuery(immediate: true)
    }

    func beginInstalledCloudSelection() {
        guard selectedDestination == .fontState(.installed) else { return }
        selectedInstalledFamilyIDs.removeAll()
        isSelectingInstalledForCloud = true
    }

    func endInstalledCloudSelection() {
        isSelectingInstalledForCloud = false
        selectedInstalledFamilyIDs.removeAll()
    }

    func toggleInstalledCloudSelection(_ family: FamilyCard) {
        guard isSelectingInstalledForCloud else { return }
        if !selectedInstalledFamilyIDs.insert(family.id).inserted {
            selectedInstalledFamilyIDs.remove(family.id)
        }
    }

    func addSelectedInstalledFontsToCloud() {
        guard let operations, let repository,
              CloudSyncModel.shared.isConnected,
              !selectedInstalledFamilyIDs.isEmpty,
              !isAddingInstalledToCloud else { return }
        let paths = Set(families
            .filter { selectedInstalledFamilyIDs.contains($0.id) }
            .flatMap(\.faces)
            .flatMap(\.sources)
            .filter { status(for: $0).state == .installed }
            .map(\.path))
            .sorted()
        guard !paths.isEmpty else {
            errorMessage = L.text("macos.selectedFileUnavailable")
            return
        }
        let urls = paths.map { URL(fileURLWithPath: $0) }
        lastImportURLs = urls
        lastImportMode = .copy
        lastBatchAction = nil
        batchOutcomes = []
        isAddingInstalledToCloud = true
        Task {
            importOutcomes = await operations.importFiles(urls, mode: .copy)
            do {
                isRefreshing = true
                snapshot = try await repository.refreshLibrary()
                try await reloadLibrarySources()
                try await performQuery(reset: true)
                isRefreshing = false
            } catch {
                isRefreshing = false
                present(error)
            }
            isAddingInstalledToCloud = false
            endInstalledCloudSelection()
            isCloudImportReport = true
            isImportReportPresented = true
            if importOutcomes.contains(where: { $0.error == nil }) {
                CloudSyncModel.shared.syncNow()
            }
        }
    }

    func addSourceToCloud(_ source: FontSource) {
        guard let operations, let repository, CloudSyncModel.shared.isConnected, !CloudSyncModel.shared.isRunning else { return }
        let urls = [URL(fileURLWithPath: source.path)]
        lastImportURLs = urls
        lastImportMode = .copy
        Task {
            importOutcomes = await operations.importFiles(urls, mode: .copy)
            do {
                snapshot = try await repository.refreshLibrary()
                try await reloadLibrarySources()
                try await performQuery(reset: true, retainingCount: families.count)
            } catch { present(error) }
            isCloudImportReport = true
            isImportReportPresented = true
            if importOutcomes.contains(where: { $0.error == nil }) { CloudSyncModel.shared.syncNow() }
        }
    }

    func selectFamily(_ family: FamilyCard) {
        selectedFamilyID = family.id
        let face = family.defaultFace
        selectedFaceID = face?.id
        selectedSourcePath = face?.sources.first?.path
        axisValues = face.map { previewSession.axisValuesByFace[$0.id] ?? defaultAxisValues(for: $0) } ?? [:]
        inspectorPresented = true
        guard let repository, let identityID = face?.identityID else { return }
        Task {
            do {
                try await repository.recordRecent(identityID)
                snapshot = try await repository.loadCachedLibrary()
                CloudSyncModel.shared.requestAutomaticSync()
            } catch {
                present(error)
            }
        }
    }

    func selectFace(_ face: FaceSummary) {
        selectedFaceID = face.id
        selectedSourcePath = face.sources.first?.path
        axisValues = previewSession.axisValuesByFace[face.id] ?? defaultAxisValues(for: face)
        guard let repository else { return }
        Task {
            do {
                try await repository.recordRecent(face.identityID)
                snapshot = try await repository.loadCachedLibrary()
                CloudSyncModel.shared.requestAutomaticSync()
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

    private func defaultAxisValues(for face: FaceSummary) -> [String: Double] {
        Dictionary(uniqueKeysWithValues: face.axes.map { ($0.tag, $0.defaultValue) })
    }

    func toggleFavorite(_ family: FamilyCard) {
        guard let repository else { return }
        let favorite = !family.isFavorite
        Task {
            do {
                try await repository.setFavorite(family, favorite: favorite)
                snapshot = try await repository.loadCachedLibrary()
                try await performQuery(reset: true)
                CloudSyncModel.shared.requestAutomaticSync()
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
                CloudSyncModel.shared.requestAutomaticSync()
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
                CloudSyncModel.shared.requestAutomaticSync()
            } catch {
                present(error)
            }
        }
    }

    func beginFavoriteFolderCreation() {
        favoriteFolderSeedText = searchText
        favoriteFolderSeedFacets = selectedFacets
        guard let repository else {
            favoriteFolderEditor = .create
            return
        }
        if case let .smartFolder(id) = selectedDestination {
            Task {
                do {
                    let options = try await repository.allFacetOptions()
                    let details = try await repository.smartFolder(id, options: options)
                    favoriteFolderSeedText = [details.text, searchText]
                        .filter { !$0.isEmpty }
                        .joined(separator: " ")
                    favoriteFolderSeedFacets.formUnion(details.selectedFacets)
                    favoriteFolderEditor = .create
                } catch {
                    present(error)
                }
            }
        } else {
            favoriteFolderEditor = .create
        }
    }

    func loadSmartFolderFacetOptions() async throws -> [FacetOption] {
        guard let repository else { return [] }
        return try await repository.allFacetOptions()
    }

    func loadSmartFolderDetails(
        _ id: SmartFolderID,
        options: [FacetOption]
    ) async throws -> SmartFolderDetails? {
        guard let repository else { return nil }
        return try await repository.smartFolder(id, options: options)
    }

    func saveFavoriteFolder(
        _ intent: FavoriteFolderEditorIntent,
        name: String,
        text: String,
        facets: Set<FacetOption>,
        icon: CollectionIcon,
        color: CollectionColor
    ) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, let repository else { return }
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasRules = !text.isEmpty || !facets.isEmpty
        Task {
            do {
                switch intent {
                case .create:
                    if hasRules {
                        let id = try await repository.createSmartFolder(
                            name: name,
                            text: text,
                            facets: facets,
                            icon: icon,
                            color: color
                        )
                        selectedDestination = .smartFolder(id)
                    } else {
                        let id = try await repository.createCollection(
                            name: name,
                            icon: icon,
                            color: color
                        )
                        selectedDestination = .collection(id)
                    }
                case let .editCollection(folder):
                    if hasRules {
                        let id = try await repository.convertCollectionToSmartFolder(
                            folder.id,
                            name: name,
                            text: text,
                            facets: facets,
                            icon: icon,
                            color: color
                        )
                        selectedDestination = .smartFolder(id)
                    } else {
                        try await repository.updateCollection(
                            folder.id,
                            name: name,
                            icon: icon,
                            color: color
                        )
                    }
                case let .editSmartFolder(folder):
                    if hasRules {
                        try await repository.updateSmartFolder(
                            folder.id,
                            name: name,
                            text: text,
                            facets: facets,
                            icon: icon,
                            color: color
                        )
                    } else {
                        let id = try await repository.convertSmartFolderToCollection(
                            folder.id,
                            name: name,
                            icon: icon,
                            color: color
                        )
                        selectedDestination = .collection(id)
                    }
                }
                snapshot = try await repository.loadCachedLibrary()
                favoriteFolderEditor = nil
                try await performQuery(reset: true)
                CloudSyncModel.shared.requestAutomaticSync()
            } catch {
                present(error)
            }
        }
    }

    func deleteSmartFolder(_ folder: SmartFolderSummary) {
        guard let repository else { return }
        if selectedDestination == .smartFolder(folder.id) {
            selectedDestination = .allFonts
        }
        Task {
            do {
                try await repository.deleteSmartFolder(folder.id)
                snapshot = try await repository.loadCachedLibrary()
                try await performQuery(reset: true)
                CloudSyncModel.shared.requestAutomaticSync()
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
        panel.prompt = L.text("import.addFontFolder")
        guard panel.runModal() == .OK, let url = panel.url, let repository else { return }

        Task {
            do {
                try BookmarkStore.shared.persistAccess(to: url)
                try await repository.addLibraryRoot(url)
                isRefreshing = true
                snapshot = try await repository.refreshLibrary()
                try await reloadLibrarySources()
                try await performQuery(reset: true)
                isRefreshing = false
            } catch {
                isRefreshing = false
                present(error)
            }
        }
    }

    func importFiles() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = [.font]
        panel.prompt = L.text("import.importFonts")
        guard panel.runModal() == .OK else { return }
        queueImport(panel.urls)
    }

    func receiveOpenURL(_ url: URL) {
        incomingURLs.append(url)
        incomingTask?.cancel()
        incomingTask = Task {
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            let urls = incomingURLs
            incomingURLs.removeAll()
            queueImport(urls)
        }
    }

    private func queueImport(_ urls: [URL]) {
        guard !urls.isEmpty else { return }
        pendingImportURLs = urls
        guard operations != nil else { return }
        if UserDefaults.standard.bool(forKey: AppPreferences.askImportMode) {
            isImportChoicePresented = true
        } else {
            let raw = UserDefaults.standard.string(forKey: AppPreferences.defaultImportMode)
            importPending(as: FontImportMode(rawValue: raw ?? "copy") ?? .copy)
        }
    }

    func importPending(as mode: FontImportMode) {
        guard let operations, let repository else { return }
        let urls = pendingImportURLs
        pendingImportURLs.removeAll()
        guard !urls.isEmpty else { return }
        lastImportURLs = urls
        isCloudImportReport = false
        lastImportMode = mode
        lastBatchAction = nil
        batchOutcomes = []
        Task {
            importOutcomes = await operations.importFiles(urls, mode: mode)
            do {
                isRefreshing = true
                snapshot = try await repository.refreshLibrary()
                try await reloadLibrarySources()
                try await performQuery(reset: true)
                isRefreshing = false
            } catch {
                isRefreshing = false
                present(error)
            }
            isImportReportPresented = true
            if mode == .copy { CloudSyncModel.shared.requestAutomaticSync() }
        }
    }

    func onlineLocalPaths() -> [String] {
        let managedDirectory = FileManager.default.urls(for: .applicationSupportDirectory,
                                                        in: .userDomainMask)[0]
            .appendingPathComponent("Folio/ManagedFonts", isDirectory: true).standardizedFileURL
        return Array(Set(libraryFaceSources.flatMap(\.paths))).filter {
            URL(fileURLWithPath: $0).standardizedFileURL.deletingLastPathComponent() == managedDirectory
        }
    }

    func importOnlineFiles(_ urls: [URL], origin: OnlineFontOrigin) async -> [FontOperationOutcome] {
        guard let operations, let repository, !urls.isEmpty else { return [] }
        var outcomes = await operations.importFiles(urls, mode: .copy)
        for index in outcomes.indices {
            guard let path = outcomes[index].path, outcomes[index].error == nil else { continue }
            do {
                try await operations.recordOnlineOrigin(path: path, origin: origin)
            } catch {
                outcomes[index] = .init(name: outcomes[index].name,
                                        error: error.localizedDescription, path: path)
            }
        }
        do {
            isRefreshing = true
            snapshot = try await repository.refreshLibrary()
            try await reloadLibrarySources()
            if selectedDestination != .onlineFonts {
                try await performQuery(reset: true)
            }
            isRefreshing = false
        } catch {
            isRefreshing = false
            present(error)
        }
        if outcomes.contains(where: { $0.error == nil }) {
            CloudSyncModel.shared.requestAutomaticSync()
        }
        return outcomes
    }

    func performImportedBatch(_ action: FontAction) {
        guard let operations else { return }
        let paths = importOutcomes.compactMap { $0.error == nil ? $0.path : nil }
        guard !paths.isEmpty else { return }
        lastBatchAction = action
        Task {
            let names = Dictionary(importOutcomes.compactMap { outcome in
                outcome.path.map { ($0, outcome.name) }
            }, uniquingKeysWith: { first, _ in first })
            batchOutcomes = await operations.performBatch(action, paths: paths).map { outcome in
                FontOperationOutcome(
                    name: outcome.path.flatMap { names[$0] } ?? outcome.name,
                    error: outcome.error,
                    path: outcome.path
                )
            }
            await refreshAllStatuses()
            if case .fontState = selectedDestination {
                do { try await performQuery(reset: true) }
                catch { present(error) }
            }
            isImportReportPresented = true
        }
    }

    func retryFailedOutcomes() {
        guard let operations else { return }
        let failures = importOutcomes.indices.filter { importOutcomes[$0].error != nil }
        let urls = failures.compactMap { $0 < lastImportURLs.count ? lastImportURLs[$0] : nil }
        let paths = batchOutcomes.compactMap { $0.error != nil ? $0.path : nil }
        guard !urls.isEmpty || !paths.isEmpty else { return }
        Task {
            if !urls.isEmpty {
                let retried = await operations.importFiles(urls, mode: lastImportMode)
                for (index, outcome) in zip(failures, retried) {
                    importOutcomes[index] = outcome
                }
                if isCloudImportReport, retried.contains(where: { $0.error == nil }) {
                    CloudSyncModel.shared.syncNow()
                }
                if let repository {
                    do {
                        snapshot = try await repository.refreshLibrary()
                        try await reloadLibrarySources()
                        try await performQuery(reset: true)
                    } catch { present(error) }
                }
            }
            if let action = lastBatchAction, !paths.isEmpty {
                let names = Dictionary(batchOutcomes.compactMap { outcome in
                    outcome.path.map { ($0, outcome.name) }
                }, uniquingKeysWith: { first, _ in first })
                let retried = await operations.performBatch(action, paths: paths).map { outcome in
                    FontOperationOutcome(
                        name: outcome.path.flatMap { names[$0] } ?? outcome.name,
                        error: outcome.error,
                        path: outcome.path
                    )
                }
                for outcome in retried {
                    if let index = batchOutcomes.firstIndex(where: { $0.path == outcome.path }) {
                        batchOutcomes[index] = outcome
                    }
                }
                await refreshAllStatuses()
                if case .fontState = selectedDestination {
                    do { try await performQuery(reset: true) }
                    catch { present(error) }
                }
            }
        }
    }

    func status(for source: FontSource) -> FontSourceStatus {
        sourceStatuses[source.path] ?? .init(state: .unavailable, isManagedCopy: false,
                                            canDeactivate: false, canUninstall: false)
    }

    func availableActions(for source: FontSource) -> [FontAction] {
        let status = status(for: source)
        var actions: [FontAction]
        switch status.state {
        case .available: actions = [.activate, .install]
        case .active: actions = status.canDeactivate ? [.deactivate, .install] : [.install]
        case .installed: actions = status.canUninstall ? [.uninstall] : []
        case .external: actions = [.activate, .install]
        case .system, .unavailable: actions = []
        }
        if status.isManagedCopy && status.state != .unavailable { actions.append(.remove) }
        return actions
    }

    func perform(_ action: FontAction, on source: FontSource) {
        guard let operations, let repository else { return }
        Task {
            do {
                try await operations.perform(action, path: source.path)
                if action == .remove {
                    CloudSyncModel.shared.markLocalRemoval(at: source.path)
                    isRefreshing = true
                    snapshot = try await repository.refreshLibrary()
                    try await reloadLibrarySources()
                    try await performQuery(reset: true)
                    isRefreshing = false
                    CloudSyncModel.shared.requestAutomaticSync()
                } else {
                    await refreshAllStatuses()
                    if case .fontState = selectedDestination {
                        try await performQuery(reset: true)
                    }
                }
            } catch {
                isRefreshing = false
                present(error)
            }
        }
    }

    func revealSelectedFace() {
        guard let path = selectedSource?.path else { return }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
    }

    func trashSelectedFace() {
        guard let source = selectedSource, status(for: source).isManagedCopy else { return }
        perform(.remove, on: source)
    }

    func removeCloudFont(_ font: CloudFontDto) {
        Task {
            do {
                if let path = font.localPath, let operations,
                   await operations.status(for: path).isManagedCopy {
                    try await operations.perform(.remove, path: path)
                    CloudSyncModel.shared.markLocalRemoval(at: path)
                } else {
                    if let path = font.localPath, let operations {
                        try await operations.prepareSyncedRemoval(path)
                    }
                    CloudSyncModel.shared.removeLocalCopy(font)
                }
                reloadAfterSync()
            } catch {
                present(error)
            }
        }
    }

    func deleteCloudFontEverywhere(_ font: CloudFontDto) {
        Task {
            do {
                if let path = font.localPath, let operations,
                   await operations.status(for: path).isManagedCopy {
                    try await operations.perform(.remove, path: path)
                } else if let path = font.localPath, let operations {
                    try await operations.prepareSyncedRemoval(path)
                }
                CloudSyncModel.shared.deleteEverywhere(font)
                reloadAfterSync()
            } catch {
                present(error)
            }
        }
    }

    func copy(_ value: String?) {
        guard let value, !value.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
    }

    func copyForFigma(_ family: FamilyCard, face: FaceSummary) {
        copyRichFontStyle(family, face: face, prefersHTML: true)
    }

    func copyForSketch(_ family: FamilyCard, face: FaceSummary) {
        copyRichFontStyle(family, face: face, prefersHTML: false)
    }

    func loadMoreIfNeeded(current family: FamilyCard) {
        guard family.id == families.last?.id,
              UInt64(families.count) < totalMatches,
              !isLoading else { return }
        Task {
            await loadFamilies(through: families.count)
        }
    }

    func loadFamilies(through index: Int) async {
        guard index >= families.count, UInt64(families.count) < totalMatches else { return }
        requestedFamilyIndex = max(
            requestedFamilyIndex,
            min(index, max(Int(clamping: totalMatches) - 1, 0))
        )
        if let paginationTask {
            await paginationTask.value
            return
        }

        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            while self.families.count <= self.requestedFamilyIndex,
                  UInt64(self.families.count) < self.totalMatches {
                let previousCount = self.families.count
                do {
                    try await self.performQuery(reset: false)
                } catch {
                    self.present(error)
                    return
                }
                guard self.families.count > previousCount else { return }
            }
        }
        paginationTask = task
        await task.value
        paginationTask = nil
    }

    func loadPreviousCarouselPage() async {
        if let carouselTailTask {
            await carouselTailTask.value
        }
        if let previousCarouselPageTask {
            await previousCarouselPageTask.value
            return
        }

        let totalCount = Int(clamping: totalMatches)
        let tailStartIndex = totalCount - carouselTailFamilies.count
        guard !carouselTailFamilies.isEmpty,
              tailStartIndex > families.count,
              let repository else { return }

        let offset = max(tailStartIndex - pageSize, families.count)
        let limit = tailStartIndex - offset
        let revision = carouselQueryRevision
        let text = searchText
        let destination = selectedDestination
        let facets = selectedFacets
        let allowedFaceIDs: Set<FaceID>?
        let allowedSourcePaths: Set<String>?
        if case let .fontState(state) = destination {
            allowedFaceIDs = faceIDsByState[state] ?? []
            allowedSourcePaths = sourcePathsByState[state] ?? []
        } else {
            allowedFaceIDs = nil
            allowedSourcePaths = nil
        }

        let task = Task { @MainActor [weak self] in
            do {
                let page = try await repository.query(
                    text: text,
                    destination: destination,
                    facets: facets,
                    allowedFaceIDs: allowedFaceIDs,
                    allowedSourcePaths: allowedSourcePaths,
                    locationFilter: self?.locationFilter ?? "all",fileFingerprint:self?.fileFingerprint,
                    offset: offset,
                    limit: limit
                )
                guard let self,
                      !Task.isCancelled,
                      self.carouselQueryRevision == revision,
                      self.totalMatches == UInt64(totalCount),
                      self.carouselTailFamilies.count == totalCount - tailStartIndex,
                      page.families.count == limit else { return }
                self.carouselTailFamilies.insert(contentsOf: page.families, at: 0)
            } catch is CancellationError {
            } catch {
                guard let self,
                      !Task.isCancelled,
                      self.carouselQueryRevision == revision else { return }
                self.present(error)
            }
        }
        previousCarouselPageTask = task
        await task.value
        if carouselQueryRevision == revision {
            previousCarouselPageTask = nil
        }
    }

    private func scheduleQuery(immediate: Bool) {
        guard hasStarted else { return }
        queryTask?.cancel()
        guard selectedDestination != .onlineFonts else { return }
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

    private func copyRichFontStyle(
        _ family: FamilyCard,
        face: FaceSummary,
        prefersHTML: Bool
    ) {
        let font = localFont(for: face, size: 16, axes: axisValues)
        let familyName = font.familyName ?? family.displayName
        let attributedString = NSAttributedString(
            string: familyName,
            attributes: [.font: font]
        )
        let range = NSRange(location: 0, length: attributedString.length)
        let rtf = try? attributedString.data(
            from: range,
            documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]
        )
        let html = fontStyleHTML(familyName: familyName, face: face)
            .data(using: .utf8)

        let pasteboard = NSPasteboard.general
        let richTypes: [NSPasteboard.PasteboardType] = prefersHTML
            ? [.html, .rtf, .string]
            : [.rtf, .html, .string]
        pasteboard.declareTypes(richTypes, owner: nil)
        if let html {
            pasteboard.setData(html, forType: .html)
        }
        if let rtf {
            pasteboard.setData(rtf, forType: .rtf)
        }
        pasteboard.setString(familyName, forType: .string)
    }

    private func fontStyleHTML(familyName: String, face: FaceSummary) -> String {
        let weight = axisValues["wght"] ?? face.weight ?? 400
        let styleName = face.styleName.lowercased()
        let isItalic = styleName.contains("italic")
            || styleName.contains("oblique")
            || axisValues["ital", default: 0] > 0
            || axisValues["slnt", default: 0] < 0
        let variations = axisValues
            .sorted { $0.key < $1.key }
            .map { "'\(htmlEscaped($0.key))' \($0.value.formatted(.number.precision(.fractionLength(0...2))))" }
            .joined(separator: ", ")
        let variationStyle = variations.isEmpty
            ? ""
            : " font-variation-settings: \(variations);"

        return """
        <meta charset="utf-8">
        <span style="font-family: &quot;\(htmlEscaped(familyName))&quot;; font-size: 16px; font-weight: \(weight.formatted(.number.precision(.fractionLength(0...2)))); font-style: \(isItalic ? "italic" : "normal");\(variationStyle)">\(htmlEscaped(familyName))</span>
        """
    }

    private func htmlEscaped(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }

    private func performQuery(reset: Bool, retainingCount: Int = 0) async throws {
        guard let repository else { return }
        isLoading = reset && families.isEmpty
        let previousFace = selectedFace
        let offset = reset ? 0 : families.count
        let destination = selectedDestination
        let allowedFaceIDs: Set<FaceID>?
        let allowedSourcePaths: Set<String>?
        if case let .fontState(state) = destination {
            allowedFaceIDs = faceIDsByState[state] ?? []
            allowedSourcePaths = sourcePathsByState[state] ?? []
        } else {
            allowedFaceIDs = nil
            allowedSourcePaths = nil
        }
        let page = try await repository.query(
            text: searchText,
            destination: destination,
            facets: selectedFacets,
            allowedFaceIDs: allowedFaceIDs,
            allowedSourcePaths: allowedSourcePaths,
            locationFilter: locationFilter,fileFingerprint:fileFingerprint,
            offset: offset,
            limit: pageSize
        )
        var visibleFamilies = page.families
        while reset && visibleFamilies.count < retainingCount && visibleFamilies.count < page.totalMatches {
            let next = try await repository.query(text: searchText, destination: destination, facets: selectedFacets,
                allowedFaceIDs: allowedFaceIDs, allowedSourcePaths: allowedSourcePaths,
                locationFilter: locationFilter, fileFingerprint: fileFingerprint, offset: visibleFamilies.count, limit: pageSize)
            guard !next.families.isEmpty else { break }
            visibleFamilies.append(contentsOf: next.families)
        }
        guard destination == selectedDestination else { return }
        if reset {
            families = visibleFamilies
            facetOptions = page.facets
            cloudOnlyFonts = page.cloudOnlyFonts
        } else {
            let existing = Set(families.map(\.id))
            families.append(contentsOf: page.families.filter { !existing.contains($0.id) })
        }
        totalMatches = page.totalMatches
        if reset {
            loadCarouselTail()
        }
        if let previousFace, let family = families.first(where: { $0.faces.contains(where: { $0.id == previousFace.id }) }),
           let face = family.faces.first(where: { $0.id == previousFace.id }) {
            selectedFamilyID = family.id
            selectedFaceID = face.id
            if !face.sources.contains(where: { $0.path == selectedSourcePath }) { selectedSourcePath = face.sources.first?.path }
        }
        if let selectedFamilyID,
           !families.contains(where: { $0.id == selectedFamilyID }),
           !carouselTailFamilies.contains(where: { $0.id == selectedFamilyID }) {
            self.selectedFamilyID = nil
            selectedFaceID = nil
        }
        isLoading = false
    }

    private func reloadLibrarySources() async throws {
        guard let repository else { return }
        libraryFaceSources = try await repository.libraryFaceSources()
        await refreshAllStatuses()
    }

    private func refreshAllStatuses() async {
        guard let operations else { return }
        let paths = libraryFaceSources.flatMap(\.paths)
        let statuses = await operations.statuses(for: paths)
        var familiesByState: [FontOperationState: Set<FamilyID>] = [:]
        var facesByState: [FontOperationState: Set<FaceID>] = [:]
        var pathsByState: [FontOperationState: Set<String>] = [:]
        for entry in libraryFaceSources {
            for path in entry.paths {
                guard let state = statuses[path]?.state else { continue }
                familiesByState[state, default: []].insert(entry.familyID)
                facesByState[state, default: []].insert(entry.faceID)
                pathsByState[state, default: []].insert(path)
            }
        }
        sourceStatuses = statuses
        fontStateCounts = familiesByState.mapValues { UInt64($0.count) }
        faceIDsByState = facesByState
        sourcePathsByState = pathsByState
    }

    private func loadCarouselTail() {
        carouselTailTask?.cancel()
        previousCarouselPageTask?.cancel()
        previousCarouselPageTask = nil
        carouselQueryRevision &+= 1
        let revision = carouselQueryRevision
        let totalCount = Int(clamping: totalMatches)
        guard totalCount > 1 else {
            carouselTailFamilies = []
            return
        }
        if totalCount <= families.count {
            carouselTailFamilies = Array(families.suffix(min(2, totalCount - 1)))
            return
        }
        guard let repository else {
            carouselTailFamilies = []
            return
        }

        carouselTailFamilies = []

        let text = searchText
        let destination = selectedDestination
        let facets = selectedFacets
        let allowedFaceIDs: Set<FaceID>?
        let allowedSourcePaths: Set<String>?
        if case let .fontState(state) = destination {
            allowedFaceIDs = faceIDsByState[state] ?? []
            allowedSourcePaths = sourcePathsByState[state] ?? []
        } else {
            allowedFaceIDs = nil
            allowedSourcePaths = nil
        }
        let offset = max(totalCount - 2, 0)
        carouselTailTask = Task { @MainActor [weak self] in
            do {
                let page = try await repository.query(
                    text: text,
                    destination: destination,
                    facets: facets,
                    allowedFaceIDs: allowedFaceIDs,
                    allowedSourcePaths: allowedSourcePaths,
                    locationFilter: self?.locationFilter ?? "all",fileFingerprint:self?.fileFingerprint,
                    offset: offset,
                    limit: 2
                )
                guard let self,
                      !Task.isCancelled,
                      self.carouselQueryRevision == revision,
                      self.totalMatches == UInt64(totalCount) else { return }
                self.carouselTailFamilies = page.families
            } catch is CancellationError {
            } catch {
                guard let self, self.carouselQueryRevision == revision else { return }
                self.carouselTailFamilies = []
            }
        }
    }

    private func present(_ error: Error) {
        errorMessage = error.localizedDescription
    }

    static func hero(
        for snapshot: LibrarySnapshot, profile: SyncProfileDto? = nil, status: SyncStatusDto? = nil,
        fonts: [CloudFontDto] = [], conflicts: [SyncConflictDto] = [], cloudLoaded: Bool = true,
        readError: Bool = false, connectionName: String = "WebDAV"
    ) -> HeroPresentation {
        let health = snapshot.health
        let summary = L.format("library.summary", String(snapshot.familyCount), String(snapshot.variableFamilyCount), String(snapshot.recentCount))
        let localSummary = L.format("library.localSummary", String(snapshot.familyCount), String(snapshot.variableFamilyCount), String(snapshot.recentCount))
        let uploads = Set((status?.items ?? []).filter { $0.action == "upload" && $0.status != "done" }.map(\.fingerprint))
        let downloads = Set((status?.items ?? []).filter { $0.action == "download" && $0.status != "done" }.map(\.fingerprint))
        let local = Set(snapshot.syncSummary.localOnlyFingerprints).union(uploads)
        let cloudOnly = Set(fonts.filter { $0.cloudOnly && !$0.deleted }.map(\.fingerprint))
        let remote = cloudOnly.union(downloads)
        let cloudOnlyCount = max(cloudOnly.count, Int(snapshot.syncSummary.cloudOnlyCount))
        let remoteCount = max(remote.count, cloudOnlyCount)
        let cloudReady = cloudLoaded && !readError && profile != nil
        let sync: HeroSyncPresentation
        if !cloudLoaded {
            sync = .init(state: .checking, text: L.text("common.loading"), action: nil)
        } else if readError {
            sync = .init(state: .error, text: L.text("cloud.readStatusError"), action: .cloudSettings)
        } else if profile == nil {
            sync = .init(state: .disconnected, text: L.text("cloud.notConnected"), action: .cloudSettings)
        } else if let status {
            if status.isRunning {
                sync = .init(state: .running, text: L.format("cloud.syncingCloud", connectionName, String(status.percent)), action: nil)
            } else if status.errorMessage != nil {
                sync = .init(state: .error, text: "\(connectionName) \(L.text("cloud.syncIncomplete"))", action: .cloudSettings)
            } else if !local.isEmpty && !downloads.isEmpty {
                sync = .init(state: .pending, text: L.format("cloud.bothUnsynced", connectionName, String(local.count), String(downloads.count)), action: .cloudSettings)
            } else if !local.isEmpty {
                sync = .init(state: .pending, text: L.plural("cloud.pendingUploads",local.count), action: .cloudSettings)
            } else if !downloads.isEmpty {
                sync = .init(state: .pending, text: L.plural("cloud.pendingDownloads",downloads.count), action: .cloudFonts)
            } else if !conflicts.isEmpty {
                sync = .init(state: .pending, text: L.format("cloud.conflictsPending", connectionName, String(conflicts.count)), action: .cloudSettings)
            } else if cloudOnlyCount > 0 {
                sync = .init(state: .connected, text: L.format("cloud.cloudOnlySummary", connectionName, String(cloudOnlyCount)), action: .cloudFonts)
            } else if status.percent == 100 && status.stage == "已同步" {
                sync = .init(state: .synced, text: L.format("cloud.librarySyncedTo", connectionName), action: nil)
            } else {
                sync = .init(state: .connected, text: L.format("cloud.connectedTo", connectionName), action: .cloudSettings)
            }
        } else {
            sync = .init(state: .checking, text: L.format("cloud.readingCloud", connectionName), action: nil)
        }
        if health.damagedFiles > 0 {
            return .init(kind: .damaged, title: L.plural("health.damagedCount", Int(health.damagedFiles)), subtitle: summary, detail: nil, action: .fontHealth, sync: sync)
        }
        if health.metadataConflicts > 0 {
            return .init(kind: .conflict, title: L.plural("health.conflictCountShort", Int(health.metadataConflicts)),
                subtitle: L.format("library.summaryConflict", String(health.multipleRevisions), String(health.metadataConflicts)),
                detail: localSummary, action: .fontHealth, sync: sync)
        }
        let fontConflicts = cloudReady ? conflicts.filter { $0.kind.hasPrefix("font_") } : []
        if !fontConflicts.isEmpty {
            let revisions = fontConflicts.filter { $0.kind == "font_revision" }.count
            let names = fontConflicts.filter { $0.kind == "font_name" }.count
            let other = fontConflicts.count - revisions - names
            let detail = [revisions > 0 ? L.plural("health.revisions", revisions) : "",
                names > 0 ? L.plural("health.names", names) : "",
                other > 0 ? L.plural("health.otherConflicts", other) : ""].filter { !$0.isEmpty }.joined(separator: " · ")
            return .init(kind: .conflict, title: L.plural("cloud.conflictCount", fontConflicts.count), subtitle: detail,
                detail: localSummary, action: .cloudSettings, sync: sync)
        }
        if cloudReady, let error = status?.errorMessage,
           error.range(of: "可用空间不足|状态码\\s*507|insufficient storage", options: [.regularExpression, .caseInsensitive]) != nil {
            return .init(kind: .cloudStorageLow, title: L.text("cloud.spaceLow"), subtitle: L.text("cloud.spaceLowHint"),
                detail: localSummary, action: .cloudSettings, sync: sync)
        }
        if cloudReady && remoteCount > 0 {
            let title = downloads.isEmpty ? L.plural("cloud.cloudOnlyAvailable", cloudOnlyCount) : L.plural("cloud.pendingDownloads", downloads.count)
            return .init(kind: .cloudAhead, title: title, subtitle: localSummary, detail: nil, action: .cloudFonts, sync: sync)
        }
        if cloudReady && !local.isEmpty {
            return .init(kind: .localUnsynced, title: L.plural("cloud.localUnsynced", local.count), subtitle: localSummary,
                detail: nil, action: .cloudSettings, sync: sync)
        }
        return .init(kind: .normal, title: snapshot.familyCount > 0 ? L.plural("library.availableNow", Int(snapshot.familyCount)) : L.text("library.emptyAddFonts"),
            subtitle: L.format("library.summaryDamaged", String(health.damagedFiles), String(snapshot.variableFamilyCount), String(snapshot.recentCount)), detail: nil, sync: sync)
    }

}

#if DEBUG
extension HeroPresentation {
    static var previewCases: [HeroPresentation] {
        let summary = L.format("library.summary", "670", "42", "12")
        let localSummary = L.format("library.localSummary", "670", "42", "12")
        let synced = HeroSyncPresentation(state: .synced, text: L.format("cloud.librarySyncedTo", "123PAN"), action: nil)
        return [
            .init(kind: .normal, title: L.plural("library.availableNow", 670), subtitle: L.format("library.summaryDamaged", "0", "42", "12"), detail: nil, sync: synced),
            .init(kind: .damaged, title: L.plural("health.damagedCount", 8), subtitle: summary, detail: nil, action: .fontHealth, sync: synced),
            .init(kind: .update, title: L.format("desktop.updatesAvailable", "3"), subtitle: summary, detail: nil, action: .fontHealth, sync: synced),
            .init(kind: .cloudAhead, title: L.plural("cloud.pendingDownloads", 12), subtitle: localSummary, detail: nil, action: .cloudFonts,
                sync: .init(state: .pending, text: L.format("cloud.remoteAhead", "123PAN"), action: .cloudFonts)),
            .init(kind: .localUnsynced, title: L.plural("cloud.localUnsynced", 32), subtitle: localSummary, detail: nil, action: .cloudSettings,
                sync: .init(state: .pending, text: L.format("cloud.localAhead", "123PAN"), action: .cloudSettings)),
            .init(kind: .cloudStorageLow, title: L.text("cloud.spaceAlmostFull"), subtitle: L.format("cloud.remainingSpace", "123PAN", "0.6 GB"), detail: localSummary, action: .cloudSettings, sync: synced),
            .init(kind: .conflict, title: L.plural("cloud.conflictCount", 4), subtitle: [L.plural("health.revisions", 2), L.plural("health.names", 2)].joined(separator: " · "),
                detail: localSummary, action: .cloudSettings, sync: .init(state: .pending, text: L.format("cloud.conflictsPending", "123PAN", "4"), action: .cloudSettings)),
        ]
    }
}
#endif
