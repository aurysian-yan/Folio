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
}
