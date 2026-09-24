import SwiftUI

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
    let icon: CollectionIcon
    let color: CollectionColor
    let memberCount: UInt64
}

enum CollectionIcon: String, CaseIterable, Hashable, Identifiable, Sendable {
    case folder
    case books
    case type
    case star
    case heart
    case bookmark
    case tag
    case briefcase
    case sparkles
    case slidersHorizontal = "sliders-horizontal"
    case signature
    case archive
    case book
    case paperclip
    case package
    case swatches
    case gift
    case stack
    case numberCircle0 = "number-circle-0"
    case numberCircle1 = "number-circle-1"
    case numberCircle2 = "number-circle-2"
    case numberCircle3 = "number-circle-3"
    case numberCircle4 = "number-circle-4"
    case numberCircle5 = "number-circle-5"
    case numberCircle6 = "number-circle-6"
    case numberCircle7 = "number-circle-7"
    case numberCircle8 = "number-circle-8"
    case numberCircle9 = "number-circle-9"
    case numberSquare0 = "number-square-0"
    case numberSquare1 = "number-square-1"
    case numberSquare2 = "number-square-2"
    case numberSquare3 = "number-square-3"
    case numberSquare4 = "number-square-4"
    case numberSquare5 = "number-square-5"
    case numberSquare6 = "number-square-6"
    case numberSquare7 = "number-square-7"
    case numberSquare8 = "number-square-8"
    case numberSquare9 = "number-square-9"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .folder: "文件夹"
        case .books: "书籍"
        case .type: "字体"
        case .star: "星标"
        case .heart: "爱心"
        case .bookmark: "书签"
        case .tag: "标签"
        case .briefcase: "工作"
        case .sparkles: "灵感"
        case .slidersHorizontal: "调节"
        case .signature: "签名"
        case .archive: "归档"
        case .book: "书本"
        case .paperclip: "回形针"
        case .package: "包裹"
        case .swatches: "色板"
        case .gift: "礼物"
        case .stack: "叠层"
        case .numberCircle0, .numberSquare0: "数字 0"
        case .numberCircle1, .numberSquare1: "数字 1"
        case .numberCircle2, .numberSquare2: "数字 2"
        case .numberCircle3, .numberSquare3: "数字 3"
        case .numberCircle4, .numberSquare4: "数字 4"
        case .numberCircle5, .numberSquare5: "数字 5"
        case .numberCircle6, .numberSquare6: "数字 6"
        case .numberCircle7, .numberSquare7: "数字 7"
        case .numberCircle8, .numberSquare8: "数字 8"
        case .numberCircle9, .numberSquare9: "数字 9"
        }
    }

    var symbolName: String {
        switch self {
        case .folder: "folder"
        case .books: "books.vertical"
        case .type: "textformat"
        case .star: "star"
        case .heart: "heart"
        case .bookmark: "bookmark"
        case .tag: "tag"
        case .briefcase: "briefcase"
        case .sparkles: "sparkles"
        case .slidersHorizontal: "slider.horizontal.3"
        case .signature: "signature"
        case .archive: "archivebox"
        case .book: "book"
        case .paperclip: "paperclip"
        case .package: "shippingbox"
        case .swatches: "swatchpalette"
        case .gift: "gift"
        case .stack: "rectangle.stack"
        case .numberCircle0: "0.circle"
        case .numberCircle1: "1.circle"
        case .numberCircle2: "2.circle"
        case .numberCircle3: "3.circle"
        case .numberCircle4: "4.circle"
        case .numberCircle5: "5.circle"
        case .numberCircle6: "6.circle"
        case .numberCircle7: "7.circle"
        case .numberCircle8: "8.circle"
        case .numberCircle9: "9.circle"
        case .numberSquare0: "0.square"
        case .numberSquare1: "1.square"
        case .numberSquare2: "2.square"
        case .numberSquare3: "3.square"
        case .numberSquare4: "4.square"
        case .numberSquare5: "5.square"
        case .numberSquare6: "6.square"
        case .numberSquare7: "7.square"
        case .numberSquare8: "8.square"
        case .numberSquare9: "9.square"
        }
    }
}

enum CollectionColor: String, CaseIterable, Hashable, Identifiable, Sendable {
    case red
    case orange
    case yellow
    case lime
    case green
    case cyan
    case blue
    case purple
    case gray

    var id: String { rawValue }

    var title: String {
        switch self {
        case .red: "红色"
        case .orange: "橙色"
        case .yellow: "黄色"
        case .lime: "黄绿色"
        case .green: "绿色"
        case .cyan: "青色"
        case .blue: "蓝色"
        case .purple: "紫色"
        case .gray: "灰色"
        }
    }

    var color: Color {
        switch self {
        case .red: Color(.sRGB, red: 0.86, green: 0.22, blue: 0.25, opacity: 1)
        case .orange: Color(.sRGB, red: 0.91, green: 0.39, blue: 0.12, opacity: 1)
        case .yellow: Color(.sRGB, red: 0.82, green: 0.62, blue: 0.02, opacity: 1)
        case .lime: Color(.sRGB, red: 0.49, green: 0.69, blue: 0.16, opacity: 1)
        case .green: Color(.sRGB, red: 0.12, green: 0.60, blue: 0.36, opacity: 1)
        case .cyan: Color(.sRGB, red: 0.00, green: 0.59, blue: 0.63, opacity: 1)
        case .blue: Color(.sRGB, red: 0.18, green: 0.47, blue: 0.84, opacity: 1)
        case .purple: Color(.sRGB, red: 0.49, green: 0.31, blue: 0.81, opacity: 1)
        case .gray: Color(.sRGB, red: 0.48, green: 0.50, blue: 0.53, opacity: 1)
        }
    }
}

enum CollectionEditorIntent: Identifiable, Sendable {
    case create
    case edit(CollectionSummary)

    var id: String {
        switch self {
        case .create: "create"
        case let .edit(collection): "edit-\(collection.id.rawValue)"
        }
    }

    var title: String {
        switch self {
        case .create: "新建收藏夹"
        case .edit: "编辑收藏夹"
        }
    }

    var isCreate: Bool {
        if case .create = self { return true }
        return false
    }

    var initialName: String {
        switch self {
        case .create: ""
        case let .edit(collection): collection.name
        }
    }

    var initialIcon: CollectionIcon {
        switch self {
        case .create: .folder
        case let .edit(collection): collection.icon
        }
    }

    var initialColor: CollectionColor {
        switch self {
        case .create: .gray
        case let .edit(collection): collection.color
        }
    }
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
