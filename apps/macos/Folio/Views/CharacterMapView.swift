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
struct CharacterRender: Encodable {
    let handle: String; let glyphIds: [UInt32]; let axes: [String: Double]; let size: Int; let foreground: [UInt8]
}
struct CharacterGlyph: Decodable { let glyphId: UInt32; let status: String; let dataUrl: String?; let error: String? }

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

// 会话共享优先队列，相同参数的网格请求合批，优先处理选中预览。
@MainActor
final class CharacterGlyphRenderer {
    private final class Job {
        let request: CharacterRender
        let channel: String
        let priority: Int
        let order: Int
        var continuation: CheckedContinuation<[CharacterGlyph], Error>?
        init(_ request: CharacterRender, channel: String, priority: Int, order: Int, continuation: CheckedContinuation<[CharacterGlyph], Error>) {
            self.request = request; self.channel = channel; self.priority = priority; self.order = order; self.continuation = continuation
        }
        func finish(_ result: Result<[CharacterGlyph], Error>) {
            continuation?.resume(with: result)
            continuation = nil
        }
    }
    private let draw: (CharacterRender) async throws -> [CharacterGlyph]
    private var pending: [String: Job] = [:]
    private var active: [Job] = []
    private var cache: [String: CharacterGlyph] = [:]
    private var cacheOrder: [String] = []
    private var cacheBytes = 0
    private var scheduled = false
    private var disposed = false
    private var order = 0
    private var generation = 0

    init(draw: @escaping (CharacterRender) async throws -> [CharacterGlyph]) { self.draw = draw }
    private func signature(_ request: CharacterRender) -> String {
        "\(request.handle)|\(request.axes.sorted { $0.key < $1.key })|\(request.size)|\(request.foreground)"
    }
    private func key(_ request: CharacterRender, _ id: UInt32) -> String { "\(signature(request))|\(id)" }
    func render(_ request: CharacterRender, channel: String, priority: Int) async throws -> [CharacterGlyph] {
        guard !disposed else { return [] }
        guard request.glyphIds.count <= 16 else { throw NSError(domain: "characterMap.error.invalidQuery", code: 1) }
        pending.removeValue(forKey: channel)?.finish(.success([]))
        let cached = request.glyphIds.compactMap { cache[key(request, $0)] }
        if cached.count == request.glyphIds.count { return cached }
        order += 1
        return try await withCheckedThrowingContinuation { continuation in
            pending[channel] = Job(request, channel: channel, priority: priority, order: order, continuation: continuation)
            schedule()
        }
    }
    func cancel(_ channel: String) {
        pending.removeValue(forKey: channel)?.finish(.success([]))
        for job in active where job.channel == channel { job.finish(.success([])) }
    }
    func cancelGrid() {
        for channel in Array(pending.keys) where channel.hasPrefix("grid:") && pending[channel]?.priority == 0 { cancel(channel) }
        for job in active where job.channel.hasPrefix("grid:") && job.priority == 0 { job.finish(.success([])) }
    }
    func reset() {
        generation += 1
        for job in pending.values { job.finish(.success([])) }
        for job in active { job.finish(.success([])) }
        pending.removeAll(); cache.removeAll(); cacheOrder.removeAll(); cacheBytes = 0
    }
    func dispose() {
        disposed = true
        reset()
    }
    private func schedule() {
        guard !disposed, !scheduled, active.isEmpty, !pending.isEmpty else { return }
        scheduled = true
        Task {
            await Task.yield()
            scheduled = false
            await pump()
        }
    }
    private func pump() async {
        guard !disposed, active.isEmpty else { return }
        let jobs = pending.values.sorted { $0.priority == $1.priority ? $0.order < $1.order : $0.priority > $1.priority }
        guard let first = jobs.first else { return }
        var batch: [Job] = []
        var ids: [UInt32] = []
        for job in jobs where job.priority == first.priority && signature(job.request) == signature(first.request) {
            let combined = Array(Set(ids + job.request.glyphIds))
            if combined.count > 16 { continue }
            ids = combined; batch.append(job)
        }
        for job in batch { pending.removeValue(forKey: job.channel) }
        active = batch
        let currentGeneration = generation
        do {
            let request = CharacterRender(handle: first.request.handle, glyphIds: ids, axes: first.request.axes, size: first.request.size, foreground: first.request.foreground)
            let values = try await draw(request)
            if !disposed && generation == currentGeneration {
                for glyph in values where glyph.status != "error" {
                    let key = key(request, glyph.glyphId)
                    cacheBytes -= cache[key]?.dataUrl?.utf8.count ?? 0
                    cache[key] = glyph
                    cacheBytes += glyph.dataUrl?.utf8.count ?? 0
                    cacheOrder.removeAll { $0 == key }; cacheOrder.append(key)
                }
                while cache.count > 512 || cacheBytes > 32 * 1024 * 1024 {
                    let oldest = cacheOrder.removeFirst()
                    cacheBytes -= cache.removeValue(forKey: oldest)?.dataUrl?.utf8.count ?? 0
                }
                for job in batch {
                    job.finish(.success(job.request.glyphIds.map { id in
                        values.first { $0.glyphId == id } ?? CharacterGlyph(glyphId: id, status: "error", dataUrl: nil, error: "characterMap.error.renderFailed")
                    }))
                }
            }
        } catch { for job in batch { job.finish(.failure(error)) } }
        active = []
        schedule()
    }
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
    var search = "" { didSet { offset = 0; cancelAutoSelection() } }
    var script = "" { didSet { offset = 0; cancelAutoSelection() } }
    var offset = 0
    var queryRetry = 0
    var result: (key: String, page: CharacterPage)?
    var queryFailure: (key: String, message: String)?
    var selected: CharacterEntry?
    var copyStatus = ""
    var committedAxes: [String: Double]
    var axisEditing = false
    @ObservationIgnored let renderer: CharacterGlyphRenderer
    @ObservationIgnored private var autoSelectionTask: Task<Void, Never>?
    @ObservationIgnored private var autoGeneration = 0
    var autoSelectFirstNonEmpty: Bool {
        UserDefaults.standard.object(forKey: AppPreferences.characterMapAutoSelectFirstNonEmpty) as? Bool ?? true
    }
    func axesChanged(_ axes: [String: Double]) {
        if !axisEditing { committedAxes = axes }
    }
    func setAxisEditing(_ editing: Bool) {
        axisEditing = editing
        if editing { renderer.cancelGrid() }
        else { committedAxes = model.axisValues }
    }
    func cancelAutoSelection() {
        autoGeneration += 1
        autoSelectionTask?.cancel()
        renderer.cancel("auto-select")
    }
    func select(_ entry: CharacterEntry) {
        cancelAutoSelection()
        selected = entry
    }
    func matchesQuery(_ entry: CharacterEntry) -> Bool {
        if !script.isEmpty && entry.script != script { return false }
        if search.isEmpty { return true }
        let trimmed = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.lowercased().hasPrefix("u+") { return UInt32(trimmed.dropFirst(2), radix: 16) == entry.codepoint }
        return search == entry.text
    }
    func initializeSelection(_ page: CharacterPage, foreground: [UInt8]) {
        cancelAutoSelection()
        if let selected, matchesQuery(selected) { return }
        selected = nil
        guard autoSelectFirstNonEmpty, let info else { return }
        let key = queryKey
        let generation = autoGeneration
        let axes = model.axisValues
        let text = search
        let script = script
        autoSelectionTask = Task { [weak self] in
            guard let self else { return }
            var page = page
            var index = 0
            do {
                while !Task.isCancelled && generation == autoGeneration && autoSelectFirstNonEmpty && queryKey == key {
                    if index < page.entries.count {
                        let entries = Array(page.entries.dropFirst(index).prefix(16))
                        let request = CharacterRender(handle: info.handle, glyphIds: entries.map(\.glyphId), axes: axes, size: 128, foreground: foreground)
                        let values = try await renderer.render(request, channel: "auto-select", priority: 1)
                        guard !Task.isCancelled, generation == autoGeneration, autoSelectFirstNonEmpty, queryKey == key else { return }
                        if let fatal = values.first(where: { ["characterMap.error.sourceUnavailable", "characterMap.error.staleSource", "characterMap.error.sessionClosed", "characterMap.error.invalidFont", "characterMap.error.invalidAxes"].contains($0.error ?? "") }) {
                            throw NSError(domain: fatal.error!, code: 1)
                        }
                        if let entry = entries.first(where: { entry in values.contains { $0.glyphId == entry.glyphId && $0.status == "ready" } }) { selected = entry; return }
                        if values.isEmpty { return }
                        index += entries.count
                    } else {
                        guard page.entries.count < page.total else { return }
                        let request = CharacterQuery(handle: info.handle, text: text, script: script.isEmpty ? nil : script, offset: page.entries.count)
                        let next = try characterDecode(CharacterPage.self, await model.characterMapQuery(characterJSON(request)))
                        guard !Task.isCancelled, generation == autoGeneration, queryKey == key, !next.entries.isEmpty else { return }
                        page = CharacterPage(entries: page.entries + next.entries, total: next.total)
                        if (self.page?.entries.count ?? 0) < page.entries.count { result = (key, page) }
                    }
                }
            } catch { if !Task.isCancelled && generation == autoGeneration && queryKey == key { queryFailure = (requestKey, characterError(error)) } }
        }
    }

    init(model: LibraryViewModel, family: FamilyCard, inspectorPresented: Bool, renderer: CharacterGlyphRenderer? = nil) {
        self.model = model
        self.family = family
        initialFaceID = model.selectedFaceID
        initialSourcePath = model.selectedSourcePath
        initialAxes = model.axisValues
        committedAxes = model.axisValues
        self.renderer = renderer ?? CharacterGlyphRenderer { [weak model] request in
            guard let model else { throw NSError(domain: "characterMap.error.sessionClosed", code: 1) }
            return try characterDecode([CharacterGlyph].self, await model.characterMapRender(characterJSON(request)))
        }
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

    func copy(_ value: String) -> Bool {
        NSPasteboard.general.clearContents()
        let success = NSPasteboard.general.setString(value, forType: .string)
        copyStatus = success ? "" : L.text("characterMap.error.copyFailed")
        return success
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
                CharacterMapContent(model: model, info: info, state: state).id(info.handle)
            } else { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
        }
        .onDisappear { state.cancelAutoSelection(); state.renderer.dispose() }
        .task(id: state.selectionKey) {
            let key = state.selectionKey
            state.cancelAutoSelection()
            state.renderer.reset()
            state.axisEditing = false
            state.committedAxes = model.axisValues
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
        GeometryReader { geometry in
            ScrollView {
                inspectorContent
                    .padding()
                    .frame(minHeight: geometry.size.height, alignment: .top)
            }
        }
    }

    private var inspectorContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let info = state.info, let selected = state.selected, state.page != nil {
                GeometryReader { preview in
                    CharacterGlyphView(renderer: state.renderer, handle: info.handle, entry: selected, axes: model.axisValues, axisDefaults: [:], size: 512, compact: false, suspended: false)
                        .id("\(info.handle)|\(selected.id)")
                        .frame(width: min(preview.size.width, preview.size.height), height: min(preview.size.width, preview.size.height))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .frame(minHeight: 128, maxHeight: .infinity)

                VStack(alignment: .leading, spacing: 4) {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(selected.label).monospaced()
                            Text(selected.script).foregroundStyle(.secondary)
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text(selected.label).monospaced()
                            Text(selected.script).foregroundStyle(.secondary)
                        }
                    }
                    Text("\(L.text("characterMap.glyphId")) \(selected.glyphId)")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .font(.callout)
                .textSelection(.enabled)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(L.format("characterMap.characterLabel", selected.label, String(selected.glyphId), selected.script))

                HStack(alignment: .top) {
                    CopyFeedbackButton(identity: state.selectionKey + selected.label, action: { state.copy(selected.text) }) { copied in
                        VStack(spacing: 4) {
                            Image.englishSystemName(copied ? "checkmark" : "doc.on.doc").font(.title3)
                            Text(L.text(copied ? "common.copied" : "characterMap.copyCharacter")).font(.caption)
                        }.frame(maxWidth: .infinity)
                    }.accessibilityLabel(L.text("characterMap.copyCharacter"))
                    CopyFeedbackButton(identity: state.selectionKey + selected.label, action: { state.copy(selected.label) }) { copied in
                        VStack(spacing: 4) {
                            Image.englishSystemName(copied ? "checkmark" : "number").font(.title3)
                            Text(L.text(copied ? "common.copied" : "characterMap.copyCodepoint")).font(.caption)
                        }.frame(maxWidth: .infinity)
                    }.accessibilityLabel(L.text("characterMap.copyCodepoint"))
                }
                .buttonStyle(.borderless)
                .fixedSize(horizontal: false, vertical: true)

                if !state.copyStatus.isEmpty {
                    Text(state.copyStatus).font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Text(L.text("characterMap.selectCharacter"))
                    .font(.callout).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}

private struct CharacterMapContent: View {
    let model: LibraryViewModel
    let info: CharacterInfo
    @Environment(\.colorScheme) private var colorScheme
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
                                Button { state.select(entry) } label: {
                                    VStack {
                                        CharacterGlyphView(renderer: state.renderer, handle: info.handle, entry: entry, axes: state.selected?.id == entry.id ? model.axisValues : state.committedAxes, axisDefaults: Dictionary(uniqueKeysWithValues: (model.selectedFace?.axes ?? []).map { ($0.tag, $0.defaultValue) }), size: 128, compact: true, suspended: state.axisEditing && state.selected?.id != entry.id, selected: state.selected?.id == entry.id)
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
                    state.select(next); proxy.scrollTo(next.id)
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
                let previous = state.page?.entries ?? []
                let entries = Array((Array(previous.prefix(offset)) + page.entries + Array(previous.dropFirst(offset + page.entries.count))).prefix(page.total))
                state.result = (key, CharacterPage(entries: entries, total: page.total))
                if offset == 0 { state.initializeSelection(page, foreground: characterForeground(colorScheme)) }
            } catch is CancellationError { }
            catch { if !Task.isCancelled { state.queryFailure = (requestKey, characterError(error)) } }
        }
    }

}

private func characterForeground(_ colorScheme: ColorScheme) -> [UInt8] {
    let appearance = NSAppearance(named: colorScheme == .dark ? .darkAqua : .aqua)!
    var rgba: [UInt8] = [0, 0, 0, 255]
    appearance.performAsCurrentDrawingAppearance {
        if let color = NSColor.labelColor.usingColorSpace(.sRGB) {
            rgba = [color.redComponent, color.greenComponent, color.blueComponent, color.alphaComponent].map { UInt8(($0 * 255).rounded()) }
        }
    }
    return rgba
}

func characterAxisCoordinates(from: [String: Double], to: [String: Double], defaults: [String: Double], progress: Double) -> [String: Double] {
    let eased = 1 - pow(1 - min(1, max(0, progress)), 3)
    return Dictionary(uniqueKeysWithValues: Set(from.keys).union(to.keys).map { tag in
        let start = from[tag] ?? defaults[tag] ?? to[tag]!
        let end = to[tag] ?? defaults[tag] ?? start
        return (tag, start + (end - start) * eased)
    })
}

private struct CharacterGlyphView: View {
    let renderer: CharacterGlyphRenderer
    let handle: String
    let entry: CharacterEntry
    let axes: [String: Double]
    let axisDefaults: [String: Double]
    let size: Int
    let compact: Bool
    let suspended: Bool
    var selected = false
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var resultAxes: [String: Double]?
    @State private var result: (glyph: CharacterGlyph, image: NSImage?)?
    @State private var retry = 0
    @State private var failure: String?
    @State private var visible = false
    @State private var sequence = 0
    @State private var accepted = 0
    private var channel: String { compact ? "grid:\(entry.codepoint)" : "detail" }
    private var key: String { "\(handle)|\(entry.glyphId)|\(axes.sorted { $0.key < $1.key })|\(size)|\(colorScheme)|\(retry)|\(suspended)|\(selected)|\(reduceMotion)" }
    var body: some View {
        Group {
            ZStack {
                if let image = result?.image {
                    Image(nsImage: image).resizable().scaledToFit().accessibilityHidden(compact)
                        .id(result?.glyph.dataUrl).transition(.opacity)
                }
            }
            if result?.glyph.status == "empty", !compact { Text(L.text("characterMap.blankGlyph")) }
            if let failure {
                Text(L.text(failure)).font(compact ? .caption : .body)
                if !compact { Button(L.text("common.retry")) { retry += 1 } }
            } else if result == nil { ProgressView().controlSize(.small) }
        }
        .onAppear { visible = true }
        .task(id: key) {
            guard !suspended else { renderer.cancel(channel); return }
            sequence += 1
            let requestSequence = sequence
            let from = resultAxes
            let changed = from.map { previous in Set(previous.keys).union(axes.keys).contains { (previous[$0] ?? axisDefaults[$0]) != (axes[$0] ?? axisDefaults[$0]) } } ?? false
            let animate = compact && !selected && !reduceMotion && changed
            let started = Date()
            var step = animate ? 1 : 4
            do {
                while visible {
                    let delay = max(0, Double(step - 1) * 0.18 / 4 - Date().timeIntervalSince(started))
                    if animate && delay > 0 { try await Task.sleep(for: .seconds(delay)) }
                    let coordinates = step == 4 ? axes : characterAxisCoordinates(from: from!, to: axes, defaults: axisDefaults, progress: Double(step) / 4)
                    let request = CharacterRender(handle: handle, glyphIds: [entry.glyphId], axes: coordinates, size: size, foreground: characterForeground(colorScheme))
                    let glyphs = try await renderer.render(request, channel: channel, priority: compact ? (selected ? 3 : 0) : 3)
                    // 同一字形的中间帧可回显，取消的视图与较旧结果不回写。
                    guard visible, requestSequence >= accepted, let glyph = glyphs.first else { return }
                    accepted = requestSequence
                    if glyph.status == "error" { failure = glyph.error ?? "characterMap.error.renderFailed"; return }
                    let image = glyph.dataUrl?.split(separator: ",", maxSplits: 1).last.flatMap { Data(base64Encoded: String($0)) }.flatMap(NSImage.init(data:))
                    guard glyph.status == "empty" || image != nil else { failure = "characterMap.error.renderFailed"; return }
                    withAnimation(animate ? .easeOut(duration: 0.075) : nil) { result = (glyph, image) }
                    resultAxes = coordinates
                    failure = nil
                    if step == 4 || Task.isCancelled { return }
                    step = min(4, max(step + 1, Int(Date().timeIntervalSince(started) * 4 / 0.18) + 1))
                }
            } catch is CancellationError { }
            catch { if visible && requestSequence >= accepted { accepted = requestSequence; failure = characterError(error) } }
        }
        .onDisappear { visible = false; renderer.cancel(channel) }
    }
}
