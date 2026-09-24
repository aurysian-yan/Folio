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
    var carouselTailFamilies: [FamilyCard] = []
    var facetOptions: [FacetOption] = []
    var selectedFacets: Set<FacetOption> = []
    var selectedDestination: SidebarDestination = .allFonts {
        didSet { scheduleQuery(immediate: true) }
    }
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
        didSet { scheduleQuery(immediate: false) }
    }
    var previewMode: PreviewTextMode = .custom
    var customPreviewText = "Folio 字体预览"
    var previewSize: Double
    private(set) var committedPreviewSize: Double
    private(set) var isPreviewSizeEditing = false
    private(set) var previewSizeEditingFamilyID: FamilyID?
    private(set) var previewSizeCommitGeneration = 0
    var previewColor = Color.primary
    var cardBackgroundColor: Color?
    var inspectorPresented = true
    var filterExpanded = false
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
    var collectionEditor: CollectionEditorIntent?

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
        selectedSourcePath = face?.sources.count == 1 ? face?.sources.first?.path : nil
        axisValues = face.map { previewSession.axisValuesByFace[$0.id] ?? defaultAxisValues(for: $0) } ?? [:]
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
        selectedSourcePath = face.sources.count == 1 ? face.sources.first?.path : nil
        axisValues = previewSession.axisValuesByFace[face.id] ?? defaultAxisValues(for: face)
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

    func saveCollection(
        _ intent: CollectionEditorIntent,
        name: String,
        icon: CollectionIcon,
        color: CollectionColor
    ) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, let repository else { return }
        if case let .edit(collection) = intent,
           collection.name == name,
           collection.icon == icon,
           collection.color == color {
            collectionEditor = nil
            return
        }
        Task {
            do {
                switch intent {
                case .create:
                    try await repository.createCollection(name: name, icon: icon, color: color)
                case let .edit(collection):
                    try await repository.updateCollection(
                        collection.id,
                        name: name,
                        icon: icon,
                        color: color
                    )
                }
                snapshot = try await repository.loadCachedLibrary()
                collectionEditor = nil
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
        panel.prompt = "导入字体"
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
        }
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
                    isRefreshing = true
                    snapshot = try await repository.refreshLibrary()
                    try await reloadLibrarySources()
                    try await performQuery(reset: true)
                    isRefreshing = false
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

    private func performQuery(reset: Bool) async throws {
        guard let repository else { return }
        isLoading = reset && families.isEmpty
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
            offset: offset,
            limit: pageSize
        )
        guard destination == selectedDestination else { return }
        if reset {
            families = page.families
            facetOptions = page.facets
        } else {
            let existing = Set(families.map(\.id))
            families.append(contentsOf: page.families.filter { !existing.contains($0.id) })
        }
        totalMatches = page.totalMatches
        if reset {
            loadCarouselTail()
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
