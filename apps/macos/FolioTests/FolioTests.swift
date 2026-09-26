import XCTest
@testable import Folio

@MainActor
final class FolioTests: XCTestCase {
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

    func testHeroPreviewSymbolsMatchFigma() {
        XCTAssertEqual(HeroKind.normal.symbol, "lasso.badge.sparkles")
        XCTAssertEqual(HeroKind.damaged.symbol, "stethoscope")
        XCTAssertEqual(HeroKind.update.symbol, "tray.and.arrow.up")
        XCTAssertEqual(HeroKind.cloudAhead.symbol, "icloud.and.arrow.down")
        XCTAssertEqual(HeroKind.localUnsynced.symbol, "icloud.and.arrow.up")
        XCTAssertEqual(HeroKind.cloudStorageLow.symbol, "externaldrive.badge.icloud")
        XCTAssertEqual(HeroKind.conflict.symbol, "bookmark")
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
