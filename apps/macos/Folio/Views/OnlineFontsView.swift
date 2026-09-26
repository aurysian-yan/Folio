import AppKit
import CoreText
import SwiftUI

struct OnlineFontsView: View {
    @Bindable var model: LibraryViewModel
    @AppStorage(AppPreferences.googleFontsMirrorTemplate) private var mirrorTemplate = ""
    @State private var online: FolioOnline?
    @State private var families: [OnlineFamilyDto] = []
    @State private var total: UInt64 = 0
    @State private var searchText = ""
    @State private var category = "全部"
    @State private var subset = "全部"
    @State private var selectedFamily: OnlineFamilyDto?
    @State private var collected: Set<String> = []
    @State private var collectedGeneration = 0
    @State private var errorMessage: String?

    private let categories = ["全部", "serif", "sans-serif", "display", "handwriting", "monospace"]
    private let subsets = ["全部", "chinese-simplified", "chinese-traditional", "latin", "cyrillic", "arabic", "devanagari"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Picker("分类", selection: $category) {
                        ForEach(categories, id: \.self) { Text(categoryTitle($0)).tag($0) }
                    }
                    .frame(maxWidth: 180)
                    Picker("文字", selection: $subset) {
                        ForEach(subsets, id: \.self) { Text(subsetTitle($0)).tag($0) }
                    }
                    .frame(maxWidth: 180)
                    Spacer()
                    Text("\(total) 个字族")
                        .foregroundStyle(.secondary)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 12)], spacing: 12) {
                    ForEach(families, id: \.id) { family in
                        Button { selectedFamily = family } label: {
                            OnlineFamilyCard(family: family, online: online, mirrorTemplate: mirrorTemplate,
                                             collected: collected)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(family.name)，\(family.styles.count) 个字款")
                    }
                }
                if UInt64(families.count) < total {
                    Button("加载更多") { loadMore() }
                        .frame(maxWidth: .infinity)
                }
            }
            .padding()
        }
        .searchable(text: $searchText, placement: .toolbar, prompt: "搜索在线字体")
        .navigationTitle("在线字体")
        .task {
            do {
                online = try FolioOnline.open(cacheDirectory: Self.cacheDirectory)
                reload()
                refreshCollected()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
        .onChange(of: searchText) { _, _ in reload() }
        .onChange(of: category) { _, _ in reload() }
        .onChange(of: subset) { _, _ in reload() }
        .onChange(of: model.isRefreshing) { _, refreshing in
            if !refreshing { refreshCollected() }
        }
        .sheet(isPresented: Binding(
            get: { selectedFamily != nil },
            set: { if !$0 { selectedFamily = nil } }
        )) {
            if let selectedFamily, let online {
                OnlineFamilyDetail(family: selectedFamily, online: online, model: model,
                                   mirrorTemplate: mirrorTemplate, collected: collected) {
                    refreshCollected()
                }
                .frame(minWidth: 520, minHeight: 540)
            }
        }
        .alert("在线字体", isPresented: Binding(
            get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
        )) {
            Button("好") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "无法完成操作")
        }
    }

    static var cacheDirectory: String {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Folio/OnlineFonts", isDirectory: true).path
    }

    private func reload() {
        guard let online else { return }
        let page = online.query(text: searchText, category: category == "全部" ? nil : category,
                                subset: subset == "全部" ? nil : subset, offset: 0, limit: 40)
        families = page.families
        total = page.total
    }

    private func loadMore() {
        guard let online else { return }
        let page = online.query(text: searchText, category: category == "全部" ? nil : category,
                                subset: subset == "全部" ? nil : subset,
                                offset: UInt64(families.count), limit: 40)
        families += page.families
        total = page.total
    }

    private func refreshCollected() {
        guard let online else { return }
        let paths = model.onlineLocalPaths()
        collectedGeneration += 1
        let generation = collectedGeneration
        Task {
            do {
                let identifiers = try await Task.detached {
                    try online.collectedGitOids(paths: paths)
                }.value
                if generation == collectedGeneration { collected = Set(identifiers) }
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func categoryTitle(_ value: String) -> String {
        ["全部": "全部分类", "serif": "衬线", "sans-serif": "无衬线", "display": "展示",
         "handwriting": "手写", "monospace": "等宽"][value] ?? value
    }

    private func subsetTitle(_ value: String) -> String {
        ["全部": "全部文字", "chinese-simplified": "简体中文", "chinese-traditional": "繁体中文",
         "latin": "拉丁文", "cyrillic": "西里尔文", "arabic": "阿拉伯文",
         "devanagari": "天城文"][value] ?? value
    }
}

private struct OnlineFamilyCard: View {
    let family: OnlineFamilyDto
    let online: FolioOnline?
    let mirrorTemplate: String
    let collected: Set<String>
    @State private var previewURL: URL?
    @State private var previewError = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let previewURL {
                OnlineFontSample(url: previewURL, text: sampleText, size: 30)
                    .frame(height: 82)
            } else if previewError {
                Text("预览暂不可用")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 82)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, minHeight: 82)
                    .accessibilityLabel("正在加载字体预览")
            }
            HStack {
                Text(family.name).font(.headline).lineLimit(1)
                Spacer()
                if family.styles.contains(where: { collected.contains($0.gitOid) }) {
                    Image.englishSystemName("checkmark.circle.fill")
                        .accessibilityLabel("已收集")
                }
            }
            Text("\(family.styles.count) 个字款 · \(family.designer)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary)
        .task(id: "\(family.id)|\(mirrorTemplate)") {
            guard let online, let style = family.previewStyle else { return }
            previewURL = nil
            previewError = false
            do {
                let result = try await online.awaitDownload(familyID: family.id, styleID: style.id,
                                                              mirror: mirrorTemplate, collect: false)
                previewURL = URL(fileURLWithPath: result.path)
            } catch is CancellationError {
                return
            } catch {
                previewError = true
            }
        }
    }

    private var sampleText: String {
        family.subsets.contains("chinese-simplified") || family.subsets.contains("chinese-traditional")
            ? "字形之美 Aa" : "Folio Aa 123"
    }
}

private struct OnlineFamilyDetail: View {
    let family: OnlineFamilyDto
    let online: FolioOnline
    @Bindable var model: LibraryViewModel
    let mirrorTemplate: String
    let collected: Set<String>
    let onCollected: () -> Void
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String> = []
    @State private var previewURL: URL?
    @State private var previewText = ""
    @State private var collecting = false
    @State private var collectTask: Task<Void, Never>?
    @State private var status = ""
    @State private var results: [String] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading) {
                    Text(family.name).font(.title2).bold()
                    Text(family.designer).foregroundStyle(.secondary)
                }
                Spacer()
                Button("关闭") { dismiss() }
            }
            TextField("输入预览文字", text: $previewText)
            if let previewURL {
                OnlineFontSample(url: previewURL, text: previewText, size: 44)
                    .frame(height: 100)
            } else {
                ProgressView("正在加载预览")
                    .frame(maxWidth: .infinity, minHeight: 100)
            }
            Text("选择字款").font(.headline)
            List(family.styles, id: \.id) { style in
                Toggle(isOn: Binding(
                    get: { selected.contains(style.id) },
                    set: { if $0 { selected.insert(style.id) } else { selected.remove(style.id) } }
                )) {
                    HStack {
                        Text(style.style)
                        Spacer()
                        if collected.contains(style.gitOid) {
                            Text("已收集").foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .frame(minHeight: 160)
            HStack {
                Text(family.license)
                Button("查看来源") {
                    if let url = URL(string: family.sourceUrl) { openURL(url) }
                }
                Spacer()
                Text(status).foregroundStyle(.secondary)
            }
            .font(.caption)
            DisclosureGroup("授权条款") {
                ScrollView {
                    Text(family.licenseText)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 100)
            }
            if !results.isEmpty {
                ScrollView {
                    ForEach(results, id: \.self) { Text($0).frame(maxWidth: .infinity, alignment: .leading) }
                }
                .frame(maxHeight: 90)
                .font(.caption)
            }
            HStack {
                if collecting {
                    Button("取消下载") { collectTask?.cancel() }
                }
                Spacer()
                Button("收集所选字款") { collect() }
                    .disabled(selected.isEmpty || collecting)
            }
        }
        .padding()
        .onAppear {
            selected = Set(family.styles.filter { !collected.contains($0.gitOid) }.prefix(1).map(\.id))
            previewText = family.subsets.contains("chinese-simplified") ? "字形之美 Aa" : "Folio Aa 123"
        }
        .task {
            guard let style = family.previewStyle else { return }
            if let result = try? await online.awaitDownload(familyID: family.id, styleID: style.id,
                                                             mirror: mirrorTemplate, collect: false) {
                previewURL = URL(fileURLWithPath: result.path)
            }
        }
        .onDisappear { collectTask?.cancel() }
    }

    private func collect() {
        collecting = true
        results = []
        let styles = family.styles.filter { selected.contains($0.id) }
        collectTask = Task {
            for (index, style) in styles.enumerated() {
                if Task.isCancelled { break }
                status = "\(index + 1)/\(styles.count)"
                do {
                    let result = try await online.awaitDownload(familyID: family.id, styleID: style.id,
                                                                  mirror: mirrorTemplate, collect: true) { state in
                        if state.total > 0 {
                            status = "\(index + 1)/\(styles.count) · \(Int(state.received * 100 / state.total))%"
                        }
                    }
                    let origin = OnlineFontOrigin(
                        provider: "Google Fonts", commit: online.catalogCommit(),
                        family: family.name, style: style.style, gitOid: style.gitOid,
                        license: family.license, licenseText: family.licenseText,
                        sourceURL: family.sourceUrl, downloadedVia: result.source
                    )
                    let outcomes = await model.importOnlineFiles([URL(fileURLWithPath: result.path)], origin: origin)
                    if let error = outcomes.first?.error {
                        results.append("\(style.style)：\(error)")
                    } else {
                        results.append("\(style.style)：已收集 · \(result.source)")
                        onCollected()
                    }
                    try? FileManager.default.removeItem(atPath: result.path)
                } catch is CancellationError {
                    break
                } catch {
                    results.append("\(style.style)：\(error.localizedDescription)")
                }
            }
            status = ""
            collecting = false
        }
    }
}

private struct OnlineFontSample: NSViewRepresentable {
    let url: URL
    let text: String
    let size: Double

    func makeNSView(context: Context) -> LocalFontPreviewNSView {
        LocalFontPreviewNSView()
    }

    func updateNSView(_ view: LocalFontPreviewNSView, context: Context) {
        view.text = text
        if let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor],
           let descriptor = descriptors.first {
            view.font = CTFontCreateWithFontDescriptor(descriptor, size, nil)
        }
        view.textColor = .labelColor
        view.alignment = .center
        view.verticalAlignment = .center
        view.lineLimit = 2
        view.needsDisplay = true
    }
}

private struct OnlineDownloadResult {
    let path: String
    let source: String
}

private extension OnlineFamilyDto {
    var previewStyle: OnlineStyleDto? {
        styles.first { $0.weight == 400 && $0.style.hasSuffix("正体") } ?? styles.first
    }
}

@MainActor
private extension FolioOnline {
    func awaitDownload(familyID: String, styleID: String, mirror: String,
                       collect: Bool, progress: ((OnlineJobDto) -> Void)? = nil) async throws -> OnlineDownloadResult {
        let id = try startDownload(familyId: familyID, styleId: styleID,
                                   mirrorTemplate: mirror.isEmpty ? nil : mirror, collect: collect)
        defer { forgetJob(id: id) }
        while true {
            if Task.isCancelled {
                cancelJob(id: id)
                throw CancellationError()
            }
            let state = try job(id: id)
            progress?(state)
            if let path = state.path {
                return OnlineDownloadResult(path: path, source: state.source ?? "官方地址")
            }
            if let error = state.error {
                throw NSError(domain: "FolioOnline", code: 1, userInfo: [NSLocalizedDescriptionKey: error])
            }
            try await Task.sleep(for: .milliseconds(150))
        }
    }
}
