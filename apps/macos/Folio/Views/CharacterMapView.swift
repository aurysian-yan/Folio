import AppKit
import SwiftUI
import Observation

private struct CharacterSelection: Encodable {
    let faceId: String
    let revisionId: String
    let sourcePath: String
}

struct CharacterInfo: Decodable {
    struct Script: Decodable { let name: String; let count: Int }
    let handle: String
    let count: Int
    let scripts: [Script]
}

struct CharacterEntry: Decodable, Identifiable, Hashable {
    let codepoint: UInt32
    let glyphId: UInt32
    let script: String
    var id: UInt32 { codepoint }
    var label: String { String(format: "U+%04X", codepoint) }
    var text: String { Unicode.Scalar(codepoint).map(String.init) ?? "" }
}

struct CharacterPage: Decodable { let entries: [CharacterEntry]; let total: Int }
private struct CharacterQuery: Encodable {
    let handle: String; let text: String; let script: String?; let offset: Int; let limit = 256
}
private struct CharacterRender: Encodable {
    let handle: String; let glyphIds: [UInt32]; let axes: [String: Double]; let size: Int; let foreground: [UInt8]
}
private struct CharacterGlyph: Decodable { let status: String; let dataUrl: String?; let error: String? }

private func characterJSON<T: Encodable>(_ value: T) throws -> String {
    String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
}
private func characterDecode<T: Decodable>(_ type: T.Type, _ value: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(value.utf8))
}
private func characterError(_ error: Error) -> String {
    let text = String(describing: error)
    let keys = ["notDownloaded", "sourceUnavailable", "staleSource", "invalidFont", "invalidQuery", "invalidAxes", "sessionClosed", "renderFailed"]
    return keys.map { "characterMap.error.\($0)" }.first(where: text.contains) ?? "characterMap.error.renderFailed"
}

// 页面会话与两侧检查器共享选择状态。
@MainActor @Observable
final class CharacterMapState {
    let family: FamilyCard
    let initialFaceID: FaceID?
    let initialSourcePath: String?
    let initialAxes: [String: Double]
    let initialInspectorPresented: Bool
    @ObservationIgnored unowned let model: LibraryViewModel
    var retry = 0
    var opened: (key: String, info: CharacterInfo)?
    var failure: (key: String, message: String)?
    var search = "" { didSet { offset = 0 } }
    var script = "" { didSet { offset = 0 } }
    var offset = 0
    var queryRetry = 0
    var result: (key: String, page: CharacterPage)?
    var queryFailure: (key: String, message: String)?
    var selected: CharacterEntry?
    var copyStatus = ""

    init(model: LibraryViewModel, family: FamilyCard, inspectorPresented: Bool) {
        self.model = model
        self.family = family
        initialFaceID = model.selectedFaceID
        initialSourcePath = model.selectedSourcePath
        initialAxes = model.axisValues
        initialInspectorPresented = inspectorPresented
    }
    var source: String { model.selectedSource?.path ?? model.selectedFace?.sourcePath ?? "" }
    var selectionKey: String { "\(model.selectedFace?.id.rawValue ?? "")|\(model.selectedFace?.revisionID ?? "")|\(source)|\(retry)" }
    var info: CharacterInfo? { opened?.key == selectionKey ? opened?.info : nil }
    var queryKey: String { "\(info?.handle ?? "")|\(search)|\(script)" }
    var requestKey: String { "\(queryKey)|\(offset)|\(queryRetry)" }
    var page: CharacterPage? { result?.key == queryKey ? result?.page : nil }

    var count: Int? { page?.total ?? info?.count }
    var canLoadMore: Bool {
        guard let page else { return false }
        return page.entries.count > offset && page.entries.count < page.total && queryFailure?.key != requestKey
    }
    func loadMore() {
        if canLoadMore { offset = page?.entries.count ?? 0 }
    }

    func copy(_ value: String) {
        NSPasteboard.general.clearContents()
        copyStatus = L.text(NSPasteboard.general.setString(value, forType: .string) ? "common.copied" : "characterMap.error.copyFailed")
    }
}

struct CharacterMapView: View {
    let model: LibraryViewModel
    @Bindable var state: CharacterMapState

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let failure = state.failure, failure.key == state.selectionKey {
                VStack(alignment: .leading) {
                    Text(L.text(failure.message))
                    Button(L.text("common.retry")) { state.retry += 1 }
                    ForEach((model.selectedFace?.location?.files ?? []).filter { $0.cloudAvailable && $0.localSources.isEmpty }, id: \.fingerprint) { file in
                        Button(L.text("fontLocation.download")) { CloudSyncModel.shared.download(file.fingerprint) }
                    }
                    Spacer()
                }.padding()
            } else if let info = state.info {
                CharacterMapContent(model: model, info: info, axes: model.axisValues, state: state).id(info.handle)
            } else { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
        }
        .task(id: state.selectionKey) {
            let key = state.selectionKey
            state.opened = nil
            state.result = nil
            state.selected = nil
            state.offset = 0
            state.script = ""
            state.copyStatus = ""
            var handle: String?
            do {
                if state.source.isEmpty && model.selectedFace?.location?.cloudAvailable == true {
                    throw NSError(domain: "characterMap.error.notDownloaded", code: 1)
                }
                guard let face = model.selectedFace else {
                    throw NSError(domain: "characterMap.error.sourceUnavailable", code: 1)
                }
                let request = CharacterSelection(faceId: face.id.rawValue, revisionId: face.revisionID, sourcePath: state.source)
                let info = try characterDecode(CharacterInfo.self, await model.characterMapOpen(characterJSON(request)))
                handle = info.handle
                try Task.checkCancellation()
                state.opened = (key, info)
                while !Task.isCancelled { try await Task.sleep(for: .seconds(60)) }
            } catch is CancellationError { }
            catch { if !Task.isCancelled { state.failure = (key, characterError(error)) } }
            if let handle { await model.characterMapClose(handle) }
        }
    }
}

struct CharacterMapInspectorView: View {
    let model: LibraryViewModel
    @Bindable var state: CharacterMapState
    var body: some View {
        ScrollView {
            if let info = state.info, let selected = state.selected, state.page != nil {
                VStack(alignment: .leading) {
                    CharacterGlyphView(model: model, handle: info.handle, entry: selected, axes: model.axisValues, size: 512, compact: false)
                        .frame(maxWidth: .infinity).aspectRatio(1, contentMode: .fit)
                    LabeledContent(L.text("characterMap.codepoint"), value: selected.label)
                    LabeledContent(L.text("characterMap.glyphId"), value: String(selected.glyphId))
                    LabeledContent(L.text("filters.script"), value: selected.script)
                    Button(L.text("characterMap.copyCharacter")) { state.copy(selected.text) }
                    Button(L.text("characterMap.copyCodepoint")) { state.copy(selected.label) }
                    Text(state.copyStatus).foregroundStyle(.secondary)
                }.padding()
            } else { Text(L.text("characterMap.selectCharacter")).padding() }
        }
    }
}

private struct CharacterMapContent: View {
    let model: LibraryViewModel
    let info: CharacterInfo
    let axes: [String: Double]
    @Bindable var state: CharacterMapState
    @FocusState private var gridFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            if let queryFailure = state.queryFailure, queryFailure.key == state.requestKey {
                HStack { Text(L.text(queryFailure.message)); Button(L.text("common.retry")) { state.queryRetry += 1 } }.padding()
            }
            ScrollViewReader { proxy in
                ScrollView {
                    VStack {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 80))]) {
                            ForEach(state.page?.entries ?? []) { entry in
                                Button { state.selected = entry } label: {
                                    VStack {
                                        CharacterGlyphView(model: model, handle: info.handle, entry: entry, axes: axes, size: 128, compact: true)
                                            .frame(width: 64, height: 64)
                                        Text(entry.label).font(.caption).foregroundStyle(.secondary)
                                    }.frame(maxWidth: .infinity)
                                }
                                .buttonStyle(.plain)
                                .modifier(FontCardSurface(highlighted: state.selected?.id == entry.id))
                                .focusEffectDisabled()
                                .accessibilityLabel(L.format("characterMap.characterLabel", entry.label, String(entry.glyphId), entry.script))
                                .accessibilityAddTraits(state.selected?.id == entry.id ? .isSelected : [])
                                .id(entry.id)
                                .onAppear {
                                    if entry.id == state.page?.entries.last?.id { state.loadMore() }
                                }
                            }
                        }
                        if state.page?.entries.isEmpty == true { Text(L.text("characterMap.empty")) }
                        if state.page == nil || state.page?.entries.count == state.offset {
                            if state.queryFailure?.key != state.requestKey { ProgressView() }
                        }
                    }.padding()
                }
                .focusable().focusEffectDisabled().focused($gridFocused)
                .onMoveCommand { direction in
                    guard let entries = state.page?.entries, !entries.isEmpty else { return }
                    let index = entries.firstIndex(where: { $0.id == state.selected?.id }) ?? 0
                    let delta = direction == .left || direction == .up ? -1 : 1
                    let next = entries[min(entries.count - 1, max(0, index + delta))]
                    state.selected = next; proxy.scrollTo(next.id)
                }
            }.frame(minWidth: 320).id(state.queryKey)
        }
        .task(id: state.requestKey) {
            let key = state.queryKey
            let requestKey = state.requestKey
            let offset = state.offset
            do {
                try await Task.sleep(for: .milliseconds(120))
                let query = CharacterQuery(handle: info.handle, text: state.search, script: state.script.isEmpty ? nil : state.script, offset: offset)
                let page = try characterDecode(CharacterPage.self, await model.characterMapQuery(characterJSON(query)))
                try Task.checkCancellation()
                guard state.requestKey == requestKey else { return }
                let entries = offset > 0 ? Array((state.page?.entries ?? []).prefix(offset)) + page.entries : page.entries
                state.result = (key, CharacterPage(entries: entries, total: page.total))
                if offset == 0 { state.selected = page.entries.first }
            } catch is CancellationError { }
            catch { if !Task.isCancelled { state.queryFailure = (requestKey, characterError(error)) } }
        }
    }

}

private struct CharacterGlyphView: View {
    let model: LibraryViewModel
    let handle: String
    let entry: CharacterEntry
    let axes: [String: Double]
    let size: Int
    let compact: Bool
    @Environment(\.colorScheme) private var colorScheme
    @State private var result: (key: String, glyph: CharacterGlyph, image: NSImage?)?
    @State private var retry = 0
    @State private var failure: (key: String, message: String)?
    private var key: String { "\(handle)|\(entry.glyphId)|\(axes.sorted { $0.key < $1.key })|\(size)|\(colorScheme)|\(retry)" }
    var body: some View {
        Group {
            if let result, result.key == key {
                if let image = result.image { Image(nsImage: image).resizable().scaledToFit().accessibilityHidden(compact) }
                if result.glyph.status == "empty", !compact { Text(L.text("characterMap.blankGlyph")) }
                if let error = result.glyph.error {
                    Text(L.text(error)).font(compact ? .caption : .body)
                    if !compact { Button(L.text("common.retry")) { retry += 1 } }
                }
            } else if let failure, failure.key == key {
                Text(L.text(failure.message)).font(compact ? .caption : .body)
                if !compact { Button(L.text("common.retry")) { retry += 1 } }
            }
            else { ProgressView().controlSize(.small) }
        }
        .task(id: key) {
            let current = key
            do {
                let appearance = NSAppearance(named: colorScheme == .dark ? .darkAqua : .aqua)!
                var rgba: [UInt8] = [0, 0, 0, 255]
                appearance.performAsCurrentDrawingAppearance {
                    if let color = NSColor.labelColor.usingColorSpace(.sRGB) {
                        rgba = [color.redComponent, color.greenComponent, color.blueComponent, color.alphaComponent].map { UInt8(($0 * 255).rounded()) }
                    }
                }
                let request = CharacterRender(handle: handle, glyphIds: [entry.glyphId], axes: axes, size: size, foreground: rgba)
                let glyphs = try characterDecode([CharacterGlyph].self, await model.characterMapRender(characterJSON(request)))
                try Task.checkCancellation()
                if let glyph = glyphs.first {
                    let image = glyph.dataUrl?.split(separator: ",", maxSplits: 1).last.flatMap { Data(base64Encoded: String($0)) }.flatMap(NSImage.init(data:))
                    result = (current, glyph, image)
                }
            } catch is CancellationError { }
            catch { if !Task.isCancelled { failure = (current, characterError(error)) } }
        }
        .onDisappear { result = nil }
    }
}
