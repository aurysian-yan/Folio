import Foundation

enum AppPreferences {
    static let selectCardsOnHover = "selectCardsOnHover"
    static let hoverSelectionHaptics = "hoverSelectionHaptics"
    static let sliderHaptics = "sliderHaptics"
    static let libraryViewMode = "libraryViewMode"
    static let previewSize = "previewSize"
    static let expandedCardHeightRatio = "expandedCardHeightRatio"
    static let askImportMode = "askImportMode"
    static let defaultImportMode = "defaultImportMode"
}

enum FontImportMode: String, CaseIterable, Identifiable, Sendable {
    case copy
    case reference

    var id: String { rawValue }
    var title: String {
        switch self {
        case .copy: "复制到 Folio 字体库"
        case .reference: "引用原文件"
        }
    }
}

enum FontAction: String, CaseIterable, Sendable {
    case activate
    case deactivate
    case install
    case uninstall
    case remove

    var title: String {
        switch self {
        case .activate: "激活"
        case .deactivate: "停用"
        case .install: "安装"
        case .uninstall: "卸载"
        case .remove: "移除"
        }
    }
}

enum FontOperationState: Hashable, Sendable {
    case available
    case active
    case installed
    case external
    case system
    case unavailable
}

struct LibraryFaceSources: Sendable {
    let familyID: FamilyID
    let faceID: FaceID
    let paths: [String]
}

struct FontOperationOutcome: Sendable {
    let name: String
    let error: String?
    let path: String?
}

struct FontSource: Hashable, Identifiable, Sendable {
    let path: String
    let faceIndex: UInt32
    let rootIDs: [RootID]
    var id: String { "\(path):\(faceIndex)" }
    var filename: String { URL(fileURLWithPath: path).lastPathComponent }
}

struct FamilyID: Hashable, Identifiable, Sendable {
    let rawValue: String
    var id: String { rawValue }
}

struct FaceID: Hashable, Identifiable, Sendable {
    let rawValue: String
    var id: String { rawValue }
}

struct IdentityID: Hashable, Identifiable, Sendable {
    let rawValue: String
    var id: String { rawValue }
}

struct CollectionID: Hashable, Identifiable, Sendable {
    let rawValue: String
    var id: String { rawValue }
}

struct RootID: Hashable, Identifiable, Sendable {
    let rawValue: String
    var id: String { rawValue }
}

struct VariableAxisModel: Hashable, Identifiable, Sendable {
    let tag: String
    let name: String
    let minimum: Double
    let defaultValue: Double
    let maximum: Double
    let hidden: Bool
    var id: String { tag }
}

struct FaceSummary: Hashable, Identifiable, Sendable {
    let id: FaceID
    let identityID: IdentityID
    let revisionID: String
    let styleName: String
    let postScriptName: String?
    let fullName: String?
    let format: String
    let isVariable: Bool
    let weight: Double?
    let width: Double?
    let sourcePath: String?
    let sources: [FontSource]
    let faceIndex: UInt32
    let fileSize: UInt64
    let version: String?
    let manufacturer: String?
    let designer: String?
    let copyright: String?
    let category: String
    let license: String
    let scripts: [String]
    let axes: [VariableAxisModel]
}

struct FamilyCard: Hashable, Identifiable, Sendable {
    let id: FamilyID
    let displayName: String
    let faces: [FaceSummary]
    let identityIDs: [IdentityID]
    let matchedFaceIDs: [FaceID]
    var isFavorite: Bool
    let isVariable: Bool
    let manufacturer: String?

    var defaultFace: FaceSummary? {
        faces.first(where: { matchedFaceIDs.contains($0.id) }) ?? faces.first
    }
}

enum FacetKind: String, Hashable, CaseIterable, Sendable {
    case category
    case script
    case foundry
    case license

    var title: String {
        switch self {
        case .category: "类型"
        case .script: "文字系统"
        case .foundry: "厂牌"
        case .license: "许可"
        }
    }
}

struct FacetOption: Hashable, Identifiable, Sendable {
    let kind: FacetKind
    let value: String
    let label: String
    let familyCount: UInt64
    var id: String { "\(kind.rawValue):\(value)" }
}

struct CollectionSummary: Hashable, Identifiable, Sendable {
    let id: CollectionID
    var name: String
    let memberCount: UInt64
}

struct RootSummary: Hashable, Identifiable, Sendable {
    let id: RootID
    let displayPath: String
    let recursive: Bool
    let kind: String
    let pathIsLossless: Bool
}

struct HealthSummary: Hashable, Sendable {
    let damagedFiles: UInt64
    let duplicateSources: UInt64
    let multipleRevisions: UInt64
    let metadataConflicts: UInt64

    static let empty = HealthSummary(
        damagedFiles: 0,
        duplicateSources: 0,
        multipleRevisions: 0,
        metadataConflicts: 0
    )
}

struct LibrarySnapshot: Hashable, Sendable {
    let familyCount: UInt64
    let faceCount: UInt64
    let variableFamilyCount: UInt64
    let recentCount: UInt64
    let collections: [CollectionSummary]
    let roots: [RootSummary]
    let health: HealthSummary

    static let empty = LibrarySnapshot(
        familyCount: 0,
        faceCount: 0,
        variableFamilyCount: 0,
        recentCount: 0,
        collections: [],
        roots: [],
        health: .empty
    )
}

struct LibraryPage: Sendable {
    let totalMatches: UInt64
    let families: [FamilyCard]
    let facets: [FacetOption]
}

enum SidebarDestination: Hashable, Sendable {
    case allFonts
    case fontState(FontOperationState)
    case recent
    case favorites
    case onlineFonts
    case fontHealth
    case collection(CollectionID)
}

enum LibraryViewMode: String, CaseIterable, Identifiable, Sendable {
    case compactGrid
    case largeGrid
    case list
    case stack

    var id: String { rawValue }

    var symbolName: String {
        switch self {
        case .compactGrid: "square.grid.3x3"
        case .largeGrid: "square.grid.2x2"
        case .list: "list.dash"
        case .stack: "square.stack.3d.forward.dottedline"
        }
    }

    var accessibilityTitle: String {
        switch self {
        case .compactGrid: "紧凑网格"
        case .largeGrid: "大网格"
        case .list: "长条列表"
        case .stack: "展开卡片"
        }
    }
}

enum PreviewTextMode: String, CaseIterable, Identifiable, Sendable {
    case pangram
    case alphabet
    case numbers
    case loremIpsum
    case custom

    var id: String { rawValue }

    var title: String {
        switch self {
        case .pangram: "Pangram"
        case .alphabet: "Alphabet"
        case .numbers: "Numbers"
        case .loremIpsum: "Lorem Ipsum"
        case .custom: "Custom"
        }
    }

    var text: String? {
        switch self {
        case .pangram: "Sphinx of black quartz, judge my vow."
        case .alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz"
        case .numbers: "0123456789"
        case .loremIpsum: "Lorem ipsum dolor sit amet, consectetur adipiscing elit."
        case .custom: nil
        }
    }
}

enum HeroKind: String, CaseIterable, Sendable {
    case normal
    case damaged
    case update
    case cloudAhead
    case localUnsynced
    case cloudStorageLow
    case conflict

    var symbol: String {
        switch self {
        case .normal: "lasso.badge.sparkles"
        case .damaged: "stethoscope"
        case .update: "tray.and.arrow.up"
        case .cloudAhead: "icloud.and.arrow.down"
        case .localUnsynced: "icloud.and.arrow.up"
        case .cloudStorageLow: "externaldrive.badge.icloud"
        case .conflict: "bookmark"
        }
    }
}

struct HeroPresentation: Hashable, Identifiable, Sendable {
    let kind: HeroKind
    let title: String
    let subtitle: String
    let detail: String?
    var id: String { kind.rawValue }
    var symbol: String { kind.symbol }
}
