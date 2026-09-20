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
}
