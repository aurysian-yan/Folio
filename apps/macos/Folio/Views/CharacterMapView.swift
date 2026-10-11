import AppKit
import SwiftUI

private struct CharacterSelection: Encodable {
    let faceId: String
    let revisionId: String
    let sourcePath: String
}

private struct CharacterInfo: Decodable {
    struct Script: Decodable { let name: String; let count: Int }
    let handle: String
    let count: Int
    let scripts: [Script]
}

private struct CharacterEntry: Decodable, Identifiable, Hashable {
    let codepoint: UInt32
    let glyphId: UInt32
    let script: String
    var id: UInt32 { codepoint }
    var label: String { String(format: "U+%04X", codepoint) }
    var text: String { Unicode.Scalar(codepoint).map(String.init) ?? "" }
}

private struct CharacterPage: Decodable { let entries: [CharacterEntry]; let total: Int }
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

struct CharacterMapView: View {
    let model: LibraryViewModel
    let family: FamilyCard
    @Environment(\.dismiss) private var dismiss
    @State private var face: FaceSummary
    @State private var source: String
    @State private var axes: [String: Double]
    @State private var retry = 0
    @State private var opened: (key: String, info: CharacterInfo)?
    @State private var failure: (key: String, message: String)?

    init(model: LibraryViewModel, family: FamilyCard, face: FaceSummary) {
        self.model = model
        self.family = family
        _face = State(initialValue: face)
        _source = State(initialValue: model.selectedSource?.path ?? face.sourcePath ?? face.sources.first?.path ?? "")
        _axes = State(initialValue: model.axisValues)
    }

    private var currentFace: FaceSummary { family.faces.first(where: { $0.id == face.id }) ?? face }
    private var currentSource: String { source.isEmpty ? currentFace.sourcePath ?? currentFace.sources.first?.path ?? "" : source }
    private var selectionKey: String { "\(currentFace.id.rawValue)|\(currentFace.revisionID)|\(currentSource)|\(retry)" }

    var body: some View {
        VStack(alignment: .leading) {
            HStack {
                Button(L.text("common.back")) { dismiss() }.keyboardShortcut(.cancelAction)
                Text("\(family.displayName) · \(L.text("characterMap.title"))").font(.headline)
                Spacer()
            }
            HStack {
                Picker(L.text("font.styles"), selection: Binding(get: { face.id }, set: { id in
                    guard let next = family.faces.first(where: { $0.id == id }) else { return }
                    face = next; source = next.sourcePath ?? next.sources.first?.path ?? ""
                    axes = Dictionary(uniqueKeysWithValues: next.axes.map { ($0.tag, $0.defaultValue) })
                })) {
                    ForEach(family.faces) { Text($0.styleName).tag($0.id) }
                }
                if !currentFace.sources.isEmpty {
                    Picker(L.text("inspector.source"), selection: Binding(get: { currentSource }, set: { source = $0 })) {
                        ForEach(currentFace.sources, id: \.path) { Text($0.path).tag($0.path) }
                    }
                }
            }
            if !face.axes.isEmpty {
                ScrollView(.horizontal) {
                    HStack {
                        ForEach(face.axes.filter { $0.maximum > $0.minimum }) { axis in
                            VStack(alignment: .leading) {
                                Text("\(axis.name) \((axes[axis.tag] ?? axis.defaultValue).formatted())")
                                Slider(value: Binding(get: { axes[axis.tag] ?? axis.defaultValue }, set: { axes[axis.tag] = $0 }), in: axis.minimum...axis.maximum)
                                    .accessibilityLabel(axis.name)
                            }.frame(minWidth: 180)
                        }
                    }
                }
            }
            if let failure, failure.key == selectionKey {
                Text(L.text(failure.message)).accessibilityAddTraits(.isStaticText)
                Button(L.text("common.retry")) { retry += 1 }
                ForEach((currentFace.location?.files ?? []).filter { $0.cloudAvailable && $0.localSources.isEmpty }, id: \.fingerprint) { file in
                    Button(L.text("fontLocation.download")) { CloudSyncModel.shared.download(file.fingerprint) }
                }
                Spacer()
            } else if let opened, opened.key == selectionKey {
                CharacterMapContent(model: model, info: opened.info, axes: axes).id(opened.info.handle)
            } else { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
        }
        .padding()
        .frame(minWidth: 680, idealWidth: 900, minHeight: 560, idealHeight: 720)
        .task(id: selectionKey) {
            let key = selectionKey
            var handle: String?
            do {
                if currentSource.isEmpty && currentFace.location?.cloudAvailable == true {
                    throw NSError(domain: "characterMap.error.notDownloaded", code: 1)
                }
                let request = CharacterSelection(faceId: currentFace.id.rawValue, revisionId: currentFace.revisionID, sourcePath: currentSource)
                let info = try characterDecode(CharacterInfo.self, await model.characterMapOpen(characterJSON(request)))
                handle = info.handle
                try Task.checkCancellation()
                opened = (key, info)
                // 会话随页面任务存活；字款、来源切换和关闭统一取消。
                while !Task.isCancelled { try await Task.sleep(for: .seconds(60)) }
            } catch is CancellationError { }
            catch { if !Task.isCancelled { failure = (key, characterError(error)) } }
            if let handle { await model.characterMapClose(handle) }
        }
    }
}

private struct CharacterMapContent: View {
    let model: LibraryViewModel
    let info: CharacterInfo
    let axes: [String: Double]
    @State private var search = ""
    @State private var script = ""
    @State private var offset = 0
    @State private var retry = 0
    @State private var result: (key: String, page: CharacterPage)?
    @State private var failure: (key: String, message: String)?
    @State private var selected: CharacterEntry?
    @State private var copyStatus = ""
    @FocusState private var gridFocused: Bool
    private var queryKey: String { "\(search)|\(script)|\(offset)|\(retry)" }
    private var page: CharacterPage? { result?.key == queryKey ? result?.page : nil }

    var body: some View {
        VStack {
            HStack {
                TextField(L.text("characterMap.search"), text: $search).textFieldStyle(.roundedBorder)
                    .onChange(of: search) { offset = 0 }
                Picker(L.text("filters.script"), selection: $script) {
                    Text(L.text("characterMap.allScripts")).tag("")
                    ForEach(info.scripts, id: \.name) { Text("\($0.name) (\($0.count))").tag($0.name) }
                }.onChange(of: script) { offset = 0 }
                Text(L.plural("characterMap.count", page?.total ?? info.count))
            }
            if let failure, failure.key == queryKey {
                HStack { Text(L.text(failure.message)); Button(L.text("common.retry")) { retry += 1 } }
            }
            HSplitView {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 80))]) {
                            ForEach(page?.entries ?? []) { entry in
                                Button { selected = entry } label: {
                                    VStack {
                                        CharacterGlyphView(model: model, handle: info.handle, entry: entry, axes: axes, size: 128, compact: true)
                                            .frame(width: 64, height: 64)
                                        Text(entry.label).font(.caption)
                                    }.frame(maxWidth: .infinity)
                                }
                                .buttonStyle(.bordered)
                                .tint(selected?.id == entry.id ? .accentColor : .secondary)
                                .accessibilityLabel(L.format("characterMap.characterLabel", entry.label, String(entry.glyphId), entry.script))
                                .accessibilityAddTraits(selected?.id == entry.id ? .isSelected : [])
                                .id(entry.id)
                            }
                        }
                        if page?.entries.isEmpty == true { Text(L.text("characterMap.empty")) }
                    }
                    .focusable().focused($gridFocused)
                    .onMoveCommand { direction in
                        guard let entries = page?.entries, !entries.isEmpty else { return }
                        let index = entries.firstIndex(where: { $0.id == selected?.id }) ?? 0
                        let delta = direction == .left || direction == .up ? -1 : 1
                        let next = entries[min(entries.count - 1, max(0, index + delta))]
                        selected = next; proxy.scrollTo(next.id)
                    }
                }.frame(minWidth: 320)
                ScrollView {
                    if let selected, page != nil {
                        VStack(alignment: .leading) {
                            CharacterGlyphView(model: model, handle: info.handle, entry: selected, axes: axes, size: 512, compact: false)
                                .frame(maxWidth: .infinity).aspectRatio(1, contentMode: .fit)
                            LabeledContent(L.text("characterMap.codepoint"), value: selected.label)
                            LabeledContent(L.text("characterMap.glyphId"), value: String(selected.glyphId))
                            LabeledContent(L.text("filters.script"), value: selected.script)
                            Button(L.text("characterMap.copyCharacter")) { copy(selected.text) }
                            Button(L.text("characterMap.copyCodepoint")) { copy(selected.label) }
                            Text(copyStatus).foregroundStyle(.secondary)
                        }.padding()
                    } else { Text(L.text("characterMap.selectCharacter")) }
                }.frame(minWidth: 240, idealWidth: 300)
            }
            HStack {
                Button(L.text("characterMap.previousPage")) { offset = max(0, offset - 256) }.disabled(offset == 0)
                Text(L.format("characterMap.page", String(offset / 256 + 1), String(max(1, ((page?.total ?? 0) + 255) / 256))))
                Button(L.text("characterMap.nextPage")) { offset += 256 }.disabled(page == nil || offset + 256 >= (page?.total ?? 0))
            }
        }
        .task(id: queryKey) {
            let key = queryKey
            do {
                try await Task.sleep(for: .milliseconds(120))
                let query = CharacterQuery(handle: info.handle, text: search, script: script.isEmpty ? nil : script, offset: offset)
                let page = try characterDecode(CharacterPage.self, await model.characterMapQuery(characterJSON(query)))
                try Task.checkCancellation()
                result = (key, page); selected = page.entries.first
            } catch is CancellationError { }
            catch { if !Task.isCancelled { failure = (key, characterError(error)) } }
        }
    }

    private func copy(_ value: String) {
        NSPasteboard.general.clearContents()
        copyStatus = L.text(NSPasteboard.general.setString(value, forType: .string) ? "common.copied" : "characterMap.error.copyFailed")
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
