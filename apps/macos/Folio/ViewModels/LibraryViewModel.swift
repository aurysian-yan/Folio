import AppKit
import Observation
import SwiftUI

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
    var axisValues: [String: Double] = [:]
    var isCreatingCollection = false
    var newCollectionName = ""

    private let pageSize = 120
    private var repository: FolioRepository?
    private var startupTask: Task<Void, Never>?
    private var queryTask: Task<Void, Never>?
    private var paginationTask: Task<Void, Never>?
    private var carouselTailTask: Task<Void, Never>?
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

    func trashSelectedFace() {
        guard let path = selectedFace?.sourcePath, let repository else { return }
        let url = URL(fileURLWithPath: path)
        Task {
            do {
                try await Task.detached(priority: .userInitiated) {
                    try FileManager.default.trashItem(at: url, resultingItemURL: nil)
                }.value
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
        if reset {
            loadCarouselTail()
        }
        if let selectedFamilyID, !families.contains(where: { $0.id == selectedFamilyID }) {
            self.selectedFamilyID = nil
            selectedFaceID = nil
        }
        isLoading = false
    }

    private func loadCarouselTail() {
        carouselTailTask?.cancel()
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

        let text = searchText
        let destination = selectedDestination
        let facets = selectedFacets
        let offset = max(totalCount - 2, 0)
        carouselTailTask = Task { @MainActor [weak self] in
            do {
                let page = try await repository.query(
                    text: text,
                    destination: destination,
                    facets: facets,
                    offset: offset,
                    limit: 2
                )
                guard !Task.isCancelled else { return }
                self?.carouselTailFamilies = page.families
            } catch is CancellationError {
            } catch {
                self?.carouselTailFamilies = []
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
