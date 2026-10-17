import XCTest
@testable import Folio

@MainActor
final class FolioTests: XCTestCase {
    func testCharacterMapLocksFamilyAndRestoresParentSelection() {
        func family(_ id: String) -> FamilyCard {
            let face = FaceSummary(id: FaceID(rawValue: id), identityID: IdentityID(rawValue: id), revisionID: "revision",
                styleName: "Regular", postScriptName: nil, fullName: nil, format: "TrueType", isVariable: false,
                weight: 400, width: 1, sourcePath: "/fonts/\(id).ttf", sources: [], faceIndex: 0, fileSize: 0,
                version: nil, manufacturer: nil, designer: nil, copyright: nil, category: "", license: "", scripts: [], axes: [])
            return FamilyCard(id: FamilyID(rawValue: id), displayName: id, faces: [face], identityIDs: [face.identityID],
                matchedFaceIDs: [face.id], isFavorite: false, isVariable: false, manufacturer: nil)
        }
        let first = family("character-map-first")
        let second = family("character-map-second")
        let model = LibraryViewModel()
        model.families = [first, second]
        model.selectFamily(first)
        model.selectedSourcePath = "/fonts/alternate.ttf"
        model.axisValues = ["wght": 500]
        model.inspectorPresented = false
        model.openCharacterMap()
        XCTAssertTrue(model.inspectorPresented)
        let state = model.characterMap
        model.openCharacterMap(second)
        model.selectFamily(second)
        XCTAssertTrue(state === model.characterMap)
        XCTAssertEqual(model.selectedFamilyID, first.id)
        model.axisValues = ["wght": 700]
        model.selectedSourcePath = "/fonts/changed.ttf"
        model.inspectorPresented = true
        model.closeCharacterMap()
        XCTAssertNil(model.characterMap)
        XCTAssertEqual(model.selectedFaceID, first.defaultFace?.id)
        XCTAssertEqual(model.selectedSourcePath, "/fonts/alternate.ttf")
        XCTAssertEqual(model.axisValues, ["wght": 500])
        XCTAssertFalse(model.inspectorPresented)
    }

    func testCharacterMapContinuousLoadingPreservesSelectionAndResetsFilters() {
        let family = FamilyCard(id: FamilyID(rawValue: "continuous"), displayName: "Continuous", faces: [], identityIDs: [],
            matchedFaceIDs: [], isFavorite: false, isVariable: false, manufacturer: nil)
        let model = LibraryViewModel()
        let state = CharacterMapState(model: model, family: family, inspectorPresented: false)
        state.opened = (state.selectionKey, CharacterInfo(handle: "continuous", count: 600, scripts: []))
        let entries = (0..<600).map { CharacterEntry(codepoint: UInt32($0 + 32), glyphId: UInt32($0 + 1), script: "Common") }
        state.result = (state.queryKey, CharacterPage(entries: Array(entries.prefix(256)), total: 600))
        state.selected = entries[1]
        state.loadMore()
        state.loadMore()
        XCTAssertEqual(state.offset, 256)
        XCTAssertEqual(state.page?.entries.count, 256)
        XCTAssertEqual(state.count, 600)
        XCTAssertEqual(state.selected, entries[1])
        state.queryFailure = (state.requestKey, "characterMap.error.sourceUnavailable")
        XCTAssertFalse(state.canLoadMore)
        state.queryRetry += 1
        XCTAssertFalse(state.canLoadMore)
        state.result = (state.queryKey, CharacterPage(entries: Array(entries.prefix(512)), total: 600))
        state.loadMore()
        XCTAssertEqual(state.offset, 512)
        state.result = (state.queryKey, CharacterPage(entries: entries, total: 600))
        XCTAssertFalse(state.canLoadMore)
        state.search = "😀"
        XCTAssertEqual(state.offset, 0)
        XCTAssertNil(state.page)
        state.result = (state.queryKey, CharacterPage(entries: [], total: 0))
        XCTAssertEqual(state.count, 0)
        XCTAssertFalse(state.canLoadMore)
        state.script = "Latin"
        XCTAssertNil(state.page)
    }

    func testCharacterAxisTransitionInterpolatesDefaultsAndEndsExactly() {
        XCTAssertEqual(characterAxisCoordinates(from: [:], to: ["wght": 800], defaults: ["wght": 400], progress: 0), ["wght": 400])
        XCTAssertEqual(characterAxisCoordinates(from: [:], to: ["wght": 800], defaults: ["wght": 400], progress: 0.5), ["wght": 750])
        XCTAssertEqual(characterAxisCoordinates(from: ["wght": 800], to: [:], defaults: ["wght": 400], progress: 1), ["wght": 400])
        XCTAssertEqual(characterAxisCoordinates(from: ["wght": 800, "wdth": 100], to: ["wght": 400, "wdth": 75], defaults: [:], progress: 1), ["wght": 400, "wdth": 75])
    }

    func testCharacterMapAxesCommitAfterEditingAndKeepSelection() {
        let family = FamilyCard(id: FamilyID(rawValue: "axes"), displayName: "Axes", faces: [], identityIDs: [],
            matchedFaceIDs: [], isFavorite: false, isVariable: true, manufacturer: nil)
        let model = LibraryViewModel()
        model.axisValues = ["wght": 400]
        let state = CharacterMapState(model: model, family: family, inspectorPresented: false)
        model.characterMap = state
        let entry = CharacterEntry(codepoint: 65, glyphId: 1, script: "Latin")
        state.select(entry)
        state.setAxisEditing(true)
        model.axisValues = ["wght": 500]
        model.axisValues = ["wght": 700]
        XCTAssertEqual(state.committedAxes, ["wght": 400])
        XCTAssertEqual(state.selected, entry)
        state.setAxisEditing(false)
        XCTAssertEqual(state.committedAxes, ["wght": 700])
        model.axisValues = ["wght": 600]
        XCTAssertEqual(state.committedAxes, ["wght": 600])
    }

    func testCharacterMapAutoSelectionUsesPixelsAndPreservesMatchingSelection() async {
        let preference = AppPreferences.characterMapAutoSelectFirstNonEmpty
        let previous = UserDefaults.standard.object(forKey: preference)
        defer { if let previous { UserDefaults.standard.set(previous, forKey: preference) } else { UserDefaults.standard.removeObject(forKey: preference) } }
        UserDefaults.standard.removeObject(forKey: preference)
        let family = FamilyCard(id: FamilyID(rawValue: "auto"), displayName: "Auto", faces: [], identityIDs: [],
            matchedFaceIDs: [], isFavorite: false, isVariable: false, manufacturer: nil)
        var calls = 0
        let renderer = CharacterGlyphRenderer { request in
            calls += 1
            return request.glyphIds.map { CharacterGlyph(glyphId: $0, status: $0 == 2 ? "ready" : "empty", dataUrl: $0 == 2 ? "glyph:2" : nil, error: nil) }
        }
        let model = LibraryViewModel()
        let state = CharacterMapState(model: model, family: family, inspectorPresented: false, renderer: renderer)
        XCTAssertTrue(state.autoSelectFirstNonEmpty)
        state.opened = (state.selectionKey, CharacterInfo(handle: "auto", count: 2, scripts: []))
        let entries = [CharacterEntry(codepoint: 32, glyphId: 1, script: "Common"), CharacterEntry(codepoint: 65, glyphId: 2, script: "Latin")]
        let page = CharacterPage(entries: entries, total: 2)
        state.initializeSelection(page, foreground: [0, 0, 0, 255])
        for _ in 0..<1000 { if state.selected != nil { break }; await Task.yield() }
        XCTAssertEqual(state.selected, entries[1])
        XCTAssertEqual(calls, 1)
        state.search = "U+0041"
        state.initializeSelection(CharacterPage(entries: [entries[1]], total: 1), foreground: [0, 0, 0, 255])
        XCTAssertEqual(state.selected, entries[1])
        XCTAssertEqual(calls, 1)
        UserDefaults.standard.set(false, forKey: preference)
        state.selected = nil
        state.initializeSelection(page, foreground: [0, 0, 0, 255])
        await Task.yield()
        XCTAssertNil(state.selected)
        XCTAssertEqual(calls, 1)
        renderer.dispose()
    }

    func testCharacterRendererPrioritizesPreviewAndDropsIntermediatePendingRequests() async throws {
        var requests: [CharacterRender] = []
        var finishes: [CheckedContinuation<[CharacterGlyph], Error>] = []
        let renderer = CharacterGlyphRenderer { request in
            requests.append(request)
            return try await withCheckedThrowingContinuation { finishes.append($0) }
        }
        func request(_ id: UInt32, _ weight: Double = 400) -> CharacterRender {
            CharacterRender(handle: "queue", glyphIds: [id], axes: ["wght": weight], size: 128, foreground: [0, 0, 0, 255])
        }
        let first = Task { try await renderer.render(request(1), channel: "grid:1", priority: 0) }
        for _ in 0..<1000 { if requests.count == 1 { break }; await Task.yield() }
        let grid = Task { try await renderer.render(request(2), channel: "grid:2", priority: 0) }
        let skipped = Task { try await renderer.render(request(3, 500), channel: "detail", priority: 3) }
        await Task.yield()
        let latest = Task { try await renderer.render(request(3, 700), channel: "detail", priority: 3) }
        for _ in 0..<20 { await Task.yield() }
        let skippedValues = try await skipped.value
        XCTAssertTrue(skippedValues.isEmpty)
        finishes[0].resume(returning: [CharacterGlyph(glyphId: 1, status: "ready", dataUrl: "first", error: nil)])
        _ = try await first.value
        for _ in 0..<1000 { if requests.count == 2 { break }; await Task.yield() }
        XCTAssertEqual(requests[1].glyphIds, [3])
        XCTAssertEqual(requests[1].axes, ["wght": 700])
        finishes[1].resume(returning: [CharacterGlyph(glyphId: 3, status: "ready", dataUrl: "latest", error: nil)])
        _ = try await latest.value
        for _ in 0..<1000 { if requests.count == 3 { break }; await Task.yield() }
        XCTAssertEqual(requests[2].glyphIds, [2])
        finishes[2].resume(returning: [CharacterGlyph(glyphId: 2, status: "empty", dataUrl: nil, error: nil)])
        _ = try await grid.value
        renderer.dispose()
    }

    func testCharacterRendererKeepsSelectedCellWhenPausingGrid() async throws {
        var finish: CheckedContinuation<[CharacterGlyph], Error>?
        let renderer = CharacterGlyphRenderer { _ in
            try await withCheckedThrowingContinuation { finish = $0 }
        }
        let request = CharacterRender(handle: "selected", glyphIds: [1], axes: [:], size: 128, foreground: [0, 0, 0, 255])
        let selected = Task { try await renderer.render(request, channel: "grid:65", priority: 3) }
        for _ in 0..<1000 { if finish != nil { break }; await Task.yield() }
        renderer.cancelGrid()
        finish?.resume(returning: [CharacterGlyph(glyphId: 1, status: "ready", dataUrl: "selected", error: nil)])
        let values = try await selected.value
        XCTAssertEqual(values.first?.dataUrl, "selected")
        renderer.dispose()
    }

    func testSyncPercentKeepsLiteralPercentSign() {
        XCTAssertTrue(L.format("cloud.syncingPercent", "34").contains("34%"))
        XCTAssertTrue(L.format("cloud.syncingCloud", "WebDAV", "34").contains("34%"))
    }

    func testDamagedHeroHasHighestPriority() {
        let snapshot = LibrarySnapshot(
            familyCount: 3,
            faceCount: 5,
            variableFamilyCount: 1,
            recentCount: 2,
            collections: [],
            smartFolders: [],
            roots: [],
            health: HealthSummary(
                damagedFiles: 1,
                duplicateSources: 2,
                multipleRevisions: 2,
                metadataConflicts: 2
            )
        )
        XCTAssertEqual(LibraryViewModel.hero(for: snapshot).kind, .damaged)
    }

    func testConflictHasPriorityOverOtherHealthSignals() {
        let snapshot = LibrarySnapshot(
            familyCount: 3,
            faceCount: 5,
            variableFamilyCount: 1,
            recentCount: 2,
            collections: [],
            smartFolders: [],
            roots: [],
            health: HealthSummary(
                damagedFiles: 0,
                duplicateSources: 0,
                multipleRevisions: 2,
                metadataConflicts: 1
            )
        )
        XCTAssertEqual(LibraryViewModel.hero(for: snapshot).kind, .conflict)
    }

    func testLocalMultipleRevisionsDoNotImplyAnAvailableUpdate() {
        let snapshot = LibrarySnapshot(
            familyCount: 3,
            faceCount: 5,
            variableFamilyCount: 1,
            recentCount: 2,
            collections: [],
            smartFolders: [],
            roots: [],
            health: HealthSummary(
                damagedFiles: 0,
                duplicateSources: 0,
                multipleRevisions: 2,
                metadataConflicts: 0
            )
        )
        XCTAssertEqual(LibraryViewModel.hero(for: snapshot).kind, .normal)
    }

    func testHeroWarningSymbolsUseFill() {
        XCTAssertEqual(HeroKind.normal.symbol, "lasso.badge.sparkles")
        XCTAssertEqual(HeroKind.damaged.symbol, "stethoscope.circle.fill")
        XCTAssertEqual(HeroKind.update.symbol, "tray.and.arrow.up")
        XCTAssertEqual(HeroKind.cloudAhead.symbol, "icloud.and.arrow.down.fill")
        XCTAssertEqual(HeroKind.localUnsynced.symbol, "icloud.and.arrow.up.fill")
        XCTAssertEqual(HeroKind.cloudStorageLow.symbol, "externaldrive.fill.badge.icloud")
        XCTAssertEqual(HeroKind.conflict.symbol, "bookmark.fill")
    }

    func testLocalUnsyncedHeroDoesNotNeedAnUploadQueue() {
        var snapshot = LibrarySnapshot.empty
        snapshot.syncSummary = .init(syncedCount: 2, cloudOnlyCount: 0, localOnlyFingerprints: ["local", "local"])
        let profile = SyncProfileDto(serverUrl: "https://webdav.123pan.com", remoteDirectory: "Folio", username: "", automatic: false)
        let hero = LibraryViewModel.hero(for: snapshot, profile: profile)
        XCTAssertEqual(hero.kind, .localUnsynced)
        XCTAssertEqual(hero.action, .cloudSettings)
        XCTAssertEqual(hero.sync.state, .checking)
    }

    func testHeroReadingFailureDoesNotReuseCloudDifferences() {
        var snapshot = LibrarySnapshot.empty
        snapshot.syncSummary = .init(syncedCount: 0, cloudOnlyCount: 0, localOnlyFingerprints: ["local"])
        let profile = SyncProfileDto(serverUrl: "https://webdav.123pan.com", remoteDirectory: "Folio", username: "", automatic: false)
        let hero = LibraryViewModel.hero(for: snapshot, profile: profile, readError: true)
        XCTAssertEqual(hero.kind, .normal)
        XCTAssertEqual(hero.sync.state, .error)
        XCTAssertEqual(LibraryViewModel.hero(for: snapshot, cloudLoaded: false).sync.state, .checking)
    }

    func testTypedIdentifiersDoNotCompareAcrossDomains() {
        XCTAssertEqual(FamilyID(rawValue: "a"), FamilyID(rawValue: "a"))
        XCTAssertNotEqual(FaceID(rawValue: "a").rawValue, FamilyID(rawValue: "b").rawValue)
    }

    func testCopiedImportKeepsOriginalAndDeduplicates() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let repository = try FolioRepository(databaseURL: directory.appendingPathComponent("folio.sqlite"))
        let operations = try FontOperations(repository: repository, supportDirectory: directory)
        let source = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Lato-Regular", withExtension: "ttf"))

        let first = await operations.importFiles([source], mode: .copy)
        XCTAssertNil(first[0].error)
        let copied = try XCTUnwrap(first[0].path)
        XCTAssertNotEqual(copied, source.path)
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: copied)), try Data(contentsOf: source))

        let second = await operations.importFiles([source], mode: .copy)
        XCTAssertEqual(second[0].path, copied)
        let snapshot = try await repository.refreshLibrary()
        XCTAssertEqual(snapshot.faceCount, 1)
    }

    func testImportKeepsSuccessfulFilesWhenAnotherFileFails() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let repository = try FolioRepository(databaseURL: directory.appendingPathComponent("folio.sqlite"))
        let operations = try FontOperations(repository: repository, supportDirectory: directory)
        let valid = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Lato-Regular", withExtension: "ttf"))
        let invalid = directory.appendingPathComponent("invalid.ttf")
        try Data("invalid".utf8).write(to: invalid)

        let outcomes = await operations.importFiles([valid, invalid], mode: .copy)
        XCTAssertNil(outcomes[0].error)
        XCTAssertNotNil(outcomes[0].path)
        XCTAssertNotNil(outcomes[1].error)
        XCTAssertNil(outcomes[1].path)
        let snapshot = try await repository.refreshLibrary()
        XCTAssertEqual(snapshot.faceCount, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: invalid.path))
    }

    func testBatchActivationReportsUnavailableFileSeparately() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let repository = try FolioRepository(databaseURL: directory.appendingPathComponent("folio.sqlite"))
        let operations = try FontOperations(repository: repository, supportDirectory: directory)
        let source = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Lato-Regular", withExtension: "ttf"))
        let imported = await operations.importFiles([source], mode: .copy)
        let copied = try XCTUnwrap(imported[0].path)
        let missing = directory.appendingPathComponent("missing.ttf").path

        let outcomes = await operations.performBatch(.activate, paths: [copied, missing])
        XCTAssertEqual(outcomes.count, 2)
        XCTAssertNil(outcomes.first(where: { $0.path == copied })?.error)
        XCTAssertNotNil(outcomes.first(where: { $0.path == missing })?.error)
        let status = await operations.status(for: copied)
        XCTAssertEqual(status.state, .active)
        try await operations.perform(.deactivate, path: copied)
    }

    func testSmartFolderRepositoryWorkflowTracksRefreshAndKeepsLocalScopesSeparate() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let fonts = directory.appendingPathComponent("fonts", isDirectory: true)
        try FileManager.default.createDirectory(at: fonts, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let bundle = Bundle(for: Self.self)
        let lato = try XCTUnwrap(bundle.url(forResource: "Lato-Regular", withExtension: "ttf"))
        let latoCopy = fonts.appendingPathComponent("Lato-Regular.ttf")
        try FileManager.default.copyItem(at: lato, to: latoCopy)

        let repository = try FolioRepository(databaseURL: directory.appendingPathComponent("folio.sqlite"))
        try await repository.addLibraryRoot(fonts)
        let initialSnapshot = try await repository.refreshLibrary()
        XCTAssertEqual(initialSnapshot.familyCount, 1)

        let allFonts = try await repository.query(
            text: "",
            destination: .allFonts,
            facets: [],
            offset: 0,
            limit: 20
        )
        let latoFamily = try XCTUnwrap(allFonts.families.first(where: { $0.displayName == "Lato" }))
        try await repository.setFavorite(latoFamily, favorite: true)

        let folderID = try await repository.createSmartFolder(
            name: "Lato 字体",
            text: "Lato",
            facets: []
        )
        let facetOptions = try await repository.allFacetOptions()
        XCTAssertTrue(facetOptions.contains(where: { $0.kind == .feature && $0.value == "variable" }))
        XCTAssertTrue(facetOptions.contains(where: { $0.kind == .multipleVariants }))
        let recentPage = try await repository.query(
            text: "",
            destination: .recent,
            facets: [],
            offset: 0,
            limit: 20
        )
        XCTAssertEqual(recentPage.totalMatches, 0)
        let smartPage = try await repository.query(
            text: "",
            destination: .smartFolder(folderID),
            facets: [],
            offset: 0,
            limit: 20
        )
        XCTAssertEqual(smartPage.totalMatches, 1)
        XCTAssertEqual(smartPage.families.first?.displayName, "Lato")

        try FileManager.default.removeItem(at: latoCopy)
        let removedSnapshot = try await repository.refreshLibrary()
        XCTAssertEqual(removedSnapshot.smartFolders.first?.matchCount, 0)
        try FileManager.default.copyItem(at: lato, to: latoCopy)
        let restoredSnapshot = try await repository.refreshLibrary()
        XCTAssertEqual(restoredSnapshot.smartFolders.first?.matchCount, 1)

        try await repository.updateSmartFolder(
            folderID,
            name: "Lato 字体已编辑",
            text: "Lato",
            facets: [],
            icon: .folder,
            color: .gray
        )
        let options = try await repository.allFacetOptions()
        let details = try await repository.smartFolder(folderID, options: options)
        XCTAssertEqual(details.summary.name, "Lato 字体已编辑")
        XCTAssertEqual(details.text, "Lato")
        XCTAssertEqual(details.summary.matchCount, 1)

        try await repository.deleteSmartFolder(folderID)
        let deletedSnapshot = try await repository.loadCachedLibrary()
        XCTAssertTrue(deletedSnapshot.smartFolders.isEmpty)
        let remainingFavorites = try await repository.query(
            text: "",
            destination: .favorites,
            facets: [],
            offset: 0,
            limit: 20
        )
        XCTAssertEqual(remainingFavorites.totalMatches, 1)
    }

    func testOnlineCatalogAndMirrorValidationThroughSwiftBridge() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let online = try FolioOnline.open(cacheDirectory: directory.path)
        let page = online.query(text: "Lato", category: nil, subset: nil, offset: 0, limit: 20)
        XCTAssertTrue(page.families.contains(where: { $0.name == "Lato" }))
        XCTAssertEqual(online.catalogCommit().count, 40)
        XCTAssertNoThrow(try online.validateMirror(template: "https://cdn.example.org/{commit}/{path}"))
        XCTAssertThrowsError(try online.validateMirror(template: "http://cdn.example.org/{commit}/{path}"))
    }
}
