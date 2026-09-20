# Folio Phase 3 macOS UI Report

## 1. macOS project structure

`apps/macos/Folio.xcodeproj` is a complete shared Xcode project with the `Folio` application target and `FolioTests` unit-test target. Application source, generated UniFFI bindings, entitlements, build scripts, and the app icon are kept under `apps/macos`. The deployment target is macOS 15, the bundle identifier is `com.folio.app`, the default window size is 1200×800, and the minimum window size is 900×650.

## 2. Figma frames inspected

The implementation was checked against Figma file `nCaYeYhwKuWx2gDYf8hq2u`, Library node `1:6386`, Hero component set `8:7166`, card component set `4:2135`, and filter Tag component `8:6458`, including their desktop variants. Layout hierarchy, dimensions, spacing, typography, icon glyphs, and exact status colors were read from the source nodes rather than estimated from screenshots.

## 3. Native components used

The window uses `NavigationSplitView`, `List(selection:)`, `Section`, `Label`, system toolbar items, segmented `Picker`, `DisclosureGroup`, `ScrollView`, `LazyVGrid`, `.inspector`, `Menu`, `TextField`, `Slider`, `ColorPicker`, context menus, alerts, sheets, and `NSOpenPanel`.

## 4. Custom components used

`LibraryHeroView`, `FacetFilterView`, `FontFamilyCardView`, `FontPreviewView`, and `PreviewBar` implement Folio-specific presentation that has no direct native equivalent. Native interaction primitives remain inside these components so focus, keyboard, accessibility, and system appearance continue to work normally.

## 5. Swift ↔ Rust bridge architecture

`crates/folio-ffi` is a UniFFI 0.32.1 library-mode bridge over the existing core, storage, and query crates. It exposes a thread-safe `FolioEngine` and plain DTOs with domain-specific ID wrappers. `FolioRepository` is an actor that exclusively owns the generated UniFFI object, maps DTOs to `Sendable` Swift models, and is the only Rust boundary used by the `@MainActor` `LibraryViewModel`.

The Xcode bridge build uses a DerivedData-local Cargo target directory. It removes Xcode's deployment-target variable from host proc-macro builds and applies the macOS 15 minimum only to target C compilation. This prevents malformed host proc-macro dylibs and the `mis-aligned LINKEDIT string pool` launch/build failure seen in Xcode.

## 6. Initial load flow

Startup creates the SQLite database in Application Support, restores security-scoped bookmarks, loads the cached library first, and then performs incremental refresh. A new installation adds `/System/Library/Fonts`, `/Library/Fonts`, and `~/Library/Fonts` when available, so a normal macOS account immediately receives its installed-font library instead of an artificial empty state.

## 7. Sidebar implementation

The sidebar is a native selectable list with All Fonts, Recent, Favorites, Online Fonts, Font Health, and persisted Rust collections. Online Fonts is disabled because its backend is outside Phase 3. Collection creation and deletion call durable Rust APIs instead of maintaining a separate Swift-only collection list.

## 8. Hero implementation

The production priority is damaged files, metadata conflicts, then normal. Local multiple revisions are reported as health data but are not presented as an available online update. Update and cloud cases remain Preview-only fixtures.

The desktop Hero has no background. Title and subtitle are both 24 pt with condensed system width; title uses medium weight and subtitle regular. Status icons use monochrome SF Symbol rendering at 20 pt semibold. Figma-matched symbols and colors are: green `lasso.badge.sparkles`, red `stethoscope`, blue `tray.and.arrow.up`, orange `icloud.and.arrow.down`, `icloud.and.arrow.up`, and `externaldrive.badge.icloud`, plus magenta `bookmark` for conflicts.

## 9. Facet filter implementation

The filter exposes category, script, foundry, and license groups. Each group occupies one fixed-height horizontal scrolling Tag row. Tags use the selected checkmark/accent treatment and compact unselected material treatment from the component source. Swift stores only selected facet values and submits them to Rust. Same-group OR, cross-group AND, and same-face matching remain entirely in the Rust query layer. Script labels use the data returned by Rust and do not invent a Simplified/Traditional distinction.

## 10. Grid/List implementation

The four desktop modes render 152×152 compact cards, 272×164 large cards, 272×84 strip cards, and 410×280 expanded cards. Results load in deterministic pages of 120 families and request the next page only near the current end. Selected compact, large, and strip cards use the Figma accent outline and lower accent wash, expose glass copy/favorite controls only while selected, and allow pointer hover to select. Compact preview rendering supports two lines. Cards carry the current page's face summaries, selection, style switching, favorite state, collection actions, and native context menus.

## 11. Font preview implementation

Preview rendering opens the concrete font file URL with Core Text, selects the correct TTC/OTC member by `face_index`, creates a `CTFont`, applies variable-axis values, and draws through a lightweight `NSViewRepresentable`. The cache key includes revision, source, face index, point size, and axes. No `CTFontManagerRegister*` API is used.

## 12. Inspector implementation

The right panel is a system `.inspector` with an ideal width of 284 pt. It contains the selected face preview, style selection, variable-axis sliders, Finder reveal, family/PostScript copy actions, and real metadata. File deletion and undefined code generators remain disabled or absent.

## 13. Bottom Preview Bar

The bottom bar is fixed below the scrolling result area. Its icon-only menu provides Pangram, Alphabet, Numbers, Lorem Ipsum, and Custom modes. The size slider is continuous, defaults to 48, and presents its value as `48px` in SF Mono. Separate native color wells control card background and preview text color. These values are session-only Swift state and never rebuild the Rust query index.

## 14. Favorites, Recent, and Collections integration

Favorites and collection membership write every identity belonging to the chosen family in one Rust transaction. Recent records only the identity of the face the user explicitly selects. Sidebar scopes and collection counts are then reloaded from the durable database.

## 15. Add Folder flow

The app uses a single-directory `NSOpenPanel`, persists a security-scoped bookmark, calls `addLibraryRoot`, runs incremental refresh, and refreshes the visible query. The application sandbox includes user-selected directory access.

## 16. Search and Facet query integration

Search, scope, facets, offset, and page size are sent as one `LibraryQueryDto`. Search uses a 150 ms debounce; sidebar and facet changes query immediately. Swift does not duplicate ranking, normalization, filtering, or facet semantics.

## 17. Dark Mode result

The interface uses SwiftUI semantic foregrounds, backgrounds, separators, native materials, and system controls. Both light and dark appearances inherit macOS behavior. The only explicit colors are the seven Figma-defined semantic Hero status colors.

## 18. Resize result

The default window is 1200×800 and the minimum is 900×650. Sidebar and inspector retain system collapse/resize behavior. Adaptive grids change column count with the available width, while the bottom preview bar remains outside the scrolling grid.

## 19. Accessibility and keyboard sanity

Sidebar and table selection, search focus, native buttons, menus, context menus, sliders, and disclosure behavior come from system components. Icon-only toolbar buttons and card actions have accessibility labels; cards expose family, style count, variable state, and selection to assistive technologies.

## 20. Rust test results

`cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, and `cargo build --workspace` pass. The FFI crate includes typed-ID, empty-cache, invalid-ID error, root/refresh/query/details, favorite/recent, and collection workflow coverage.

## 21. macOS build result

Fresh DerivedData arm64 Debug builds pass, and a Release universal build produces both arm64 and x86_64 slices. `xcodebuild test` passes the Swift test suite with zero failures. Xcode Run was verified with the sandbox enabled: the app opened normally, loaded 463 installed families on the validation machine, and stopped consuming scan CPU after refresh. The previous Dock-bouncing failure is resolved by the valid bundle Info.plist, layout-safe window sizing, isolated Rust bridge build, and bounded horizontal filter rows that do not feed unbounded intrinsic widths back into `NavigationSplitView`.

## 22. Known limitations

CoreText activation/deactivation, font installation/removal, disk deletion, Hot Reload, WebDAV, online-font discovery, cloud capacity, and cloud synchronization are intentionally not implemented. The current FFI surface is synchronous internally and serialized through a Swift actor; lengthy scans are orchestrated away from direct View calls.

## 23. Intentional native macOS differences from Figma

Sidebar selection, toolbar grouping, search field, inspector resizing, focus rings, menus, sliders, color wells, materials, and window chrome use native macOS rendering instead of hand-drawn pixel copies. These choices preserve keyboard navigation, VoiceOver, dark mode, and resize behavior.

## 24. Future placeholders

The seven Hero variants remain available to SwiftUI Preview, but production displays only states backed by local Rust data. Update is reserved for a future online source such as Google Fonts. 123PAN/WebDAV ahead, behind, capacity, and synchronization content is Preview-only; no fake cloud values or backend exist in production.

## Final verdict

READY FOR MACOS FONT OPERATIONS
