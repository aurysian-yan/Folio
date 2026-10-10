import AppKit
import SwiftUI

// 三端共用的品牌、鸣谢与离线许可资源。
private struct AboutContent: Decodable {
    struct Link: Decodable { let key: String; let url: String }
    struct Credit: Decodable { let key: String; let name: String; let url: String }
    let links: [Link]
    let credits: [Credit]
}
private struct AboutLicense: Decodable, Identifiable {
    struct Document: Decodable { let title: String; let text: String }
    let id: String; let name: String; let version: String; let license: String
    let source: String; let platforms: [String]; let documents: [Document]; let declarationOnly: Bool
}
private struct AboutLicenses: Decodable { let entries: [AboutLicense]; let texts: [String: String] }
private struct GlyphCommand: Decodable {
    let operation: String; let coordinates: [Double]
    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        operation = try container.decode(String.self)
        var values: [Double] = []
        while !container.isAtEnd { values.append(try container.decode(Double.self)) }
        coordinates = values
    }
}
private struct AboutGlyph: Decodable { let name: String; let width: Double; let height: Double; let commands: [GlyphCommand] }
private enum AboutResources {
    static func load<T: Decodable>(_ name: String, as type: T.Type) -> T {
        guard let url = Bundle.main.url(forResource: name, withExtension: "json", subdirectory: "About"),
              let data = try? Data(contentsOf: url), let value = try? JSONDecoder().decode(type, from: data) else {
            preconditionFailure("关于资源不完整")
        }
        return value
    }
    static let content = load("content", as: AboutContent.self)
    static let licenses = load("licenses", as: AboutLicenses.self)
    static let glyphs = load("glyphs", as: [AboutGlyph].self)
    static func allowed(_ value: String) -> Bool {
        guard let url = URL(string: value), url.scheme == "https", url.user == nil, url.password == nil else { return false }
        return content.links.contains { $0.url == value } || content.credits.contains { $0.url == value }
            || licenses.entries.contains { $0.source == value } || AboutRelease.validURL(value) || AboutRelease.validURL(value, download: true)
    }
}
private struct GlyphShape: Shape {
    let glyph: AboutGlyph
    func path(in rect: CGRect) -> Path {
        var path = Path()
        for command in glyph.commands {
            let v = command.coordinates
            switch command.operation {
            case "M": path.move(to: CGPoint(x: v[0], y: v[1]))
            case "L": path.addLine(to: CGPoint(x: v[0], y: v[1]))
            case "C": path.addCurve(to: CGPoint(x: v[4], y: v[5]), control1: CGPoint(x: v[0], y: v[1]), control2: CGPoint(x: v[2], y: v[3]))
            case "Z": path.closeSubpath()
            default: break
            }
        }
        let scale = min(rect.width / glyph.width, rect.height / glyph.height)
        return path.applying(CGAffineTransform(scaleX: scale, y: scale))
            .applying(CGAffineTransform(translationX: rect.midX - glyph.width * scale / 2,
                                       y: rect.midY - glyph.height * scale / 2))
    }
}
private struct AboutRelease: Decodable {
    struct Artifact: Decodable {
        let platform: String; let arch: String; let format: String; let url: String; let size: UInt64; let sha256: String
    }
    let schemaVersion: Int; let version: String; let publishedAt: String; let releaseUrl: String; let artifacts: [Artifact]
    static let repository = "https://github.com/aurysian-yan/Folio"
    static func validURL(_ value: String, download: Bool = false) -> Bool {
        guard let url = URL(string: value), url.scheme == "https", url.host == "github.com", url.user == nil,
              url.password == nil, url.port == nil, url.query == nil, url.fragment == nil else { return false }
        let prefix = repository + (download ? "/releases/download/" : "/releases/tag/")
        guard value.hasPrefix(prefix) else { return false }
        let parts = value.dropFirst(prefix.count).split(separator: "/", omittingEmptySubsequences: false)
        return parts.count == (download ? 2 : 1) && parts.allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }
    static func publishedDate(_ value: String) -> Date? {
        guard value.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{3})?Z$", options: .regularExpression) != nil else { return nil }
        let formatter = ISO8601DateFormatter()
        if value.contains(".") { formatter.formatOptions.insert(.withFractionalSeconds) }
        guard let date = formatter.date(from: value), formatter.string(from: date) == value else { return nil }
        return date
    }
    func validate(expected: String) throws {
        let formats = ["macos": ["dmg"], "windows": ["exe"], "linux": ["AppImage", "deb", "rpm"], "android": ["apk"], "ios": ["ipa"]]
        guard schemaVersion == 1, version == expected, version.range(of: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$", options: .regularExpression) != nil,
              Self.publishedDate(publishedAt) != nil, releaseUrl == Self.repository + "/releases/tag/v" + version,
              Self.validURL(releaseUrl), artifacts.count <= 32 else { throw AboutUpdateError.failed }
        var keys = Set<String>()
        for artifact in artifacts {
            let key = "\(artifact.platform)/\(artifact.arch)/\(artifact.format)"
            guard formats[artifact.platform]?.contains(artifact.format) == true,
                  ["arm64", "x64", "universal"].contains(artifact.arch), artifact.arch != "universal" || artifact.platform == "android",
                  artifact.platform != "android" || artifact.arch == "universal", artifact.size > 0, artifact.size <= 9_007_199_254_740_991,
                  artifact.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  Self.validURL(artifact.url, download: true), artifact.url.hasPrefix(Self.repository + "/releases/download/v\(version)/"),
                  keys.insert(key).inserted else { throw AboutUpdateError.failed }
        }
    }
    static func compare(_ left: String, _ right: String) throws -> ComparisonResult {
        func parse(_ value: String) throws -> ([String], [String]?) {
            guard value.range(of: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?(\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$", options: .regularExpression) != nil else { throw AboutUpdateError.failed }
            let clean = value.split(separator: "+")[0].split(separator: "-", maxSplits: 1)
            let pre = clean.count == 2 ? clean[1].split(separator: ".").map(String.init) : nil
            guard pre?.contains(where: { $0.allSatisfy(\.isNumber) && $0.count > 1 && $0.first == "0" }) != true else { throw AboutUpdateError.failed }
            return (clean[0].split(separator: ".").map(String.init), pre)
        }
        func number(_ a: String, _ b: String) -> ComparisonResult {
            if a.count != b.count { return a.count > b.count ? .orderedDescending : .orderedAscending }
            return a.compare(b)
        }
        let (a, ap) = try parse(left); let (b, bp) = try parse(right)
        for i in 0..<3 { let comparison = number(a[i], b[i]); if comparison != .orderedSame { return comparison } }
        guard let ap, let bp else { return ap == nil ? bp == nil ? .orderedSame : .orderedDescending : .orderedAscending }
        for i in 0..<max(ap.count, bp.count) {
            if i >= ap.count { return .orderedAscending }; if i >= bp.count { return .orderedDescending }
            let x = ap[i]; let y = bp[i]; if x == y { continue }
            let xn = x.allSatisfy(\.isNumber); let yn = y.allSatisfy(\.isNumber)
            return xn && yn ? number(x, y) : xn != yn ? xn ? .orderedAscending : .orderedDescending : x.compare(y)
        }
        return .orderedSame
    }
}
private enum AboutUpdateError: Error { case failed, rateLimited, noRelease, timeout }

struct AboutView: View {
    var isActive = true
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @State private var frame = 0
    @State private var updateTask: Task<Void, Never>?
    @State private var status = "idle"
    @State private var release: AboutRelease?
    @State private var showLicenses = false
    @State private var linkFailed = false
    private var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }
    private var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "" }
    private var arch: String {
        #if arch(arm64)
        "arm64"
        #else
        "x64"
        #endif
    }
    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 12) {
                    Button(action: activate) {
                        ZStack {
                            ForEach(AboutResources.glyphs.indices, id: \.self) { index in
                                GlyphShape(glyph: AboutResources.glyphs[index]).fill(.primary).opacity(frame == index ? 1 : 0)
                            }
                        }.frame(width: 192, height: 72)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L.text("about.logoLabel"))
                    .accessibilityHint(L.text("about.logoHint"))
                    .accessibilityValue(L.format("about.logoVariant", String(frame + 1), String(AboutResources.glyphs.count)))
                    .accessibilityAction(named: Text(L.text("about.nextVariation")), activate)
                    Text(L.format("macos.versionWithBuild", version, build)).monospacedDigit().foregroundStyle(.secondary)
                    Text(L.format("about.platform", "macOS", arch)).font(.caption).foregroundStyle(.secondary)
                    Button(L.text(status == "checking" ? "about.checking" : "about.check"), action: checkUpdate).disabled(status == "checking")
                    if status != "idle" && status != "checking" {
                        Text(status == "newVersion" ? L.format("about.newVersion", release?.version ?? "") : L.text("about." + status))
                            .font(.callout).foregroundStyle(.secondary).accessibilityAddTraits(.updatesFrequently)
                    }
                    if let release {
                        if let date = AboutRelease.publishedDate(release.publishedAt) {
                            Text(L.format("about.published", date.formatted(date: .abbreviated, time: .omitted))).font(.caption).foregroundStyle(.secondary)
                        }
                        HStack {
                            Button(L.text("about.notes")) { open(release.releaseUrl) }
                            if status == "newVersion", let artifact = release.artifacts.first(where: { $0.platform == "macos" && $0.arch == arch }) {
                                Button(L.text("about.download")) { open(artifact.url) }.buttonStyle(.borderedProminent)
                            }
                        }
                    }
                }.padding(.vertical, 24)
                HStack(alignment: .top, spacing: 32) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(L.text("about.links")).font(.headline)
                        ForEach(AboutResources.content.links, id: \.key) { link in
                            linkButton(L.text("about." + link.key), url: link.url)
                        }
                        Divider().padding(.vertical, 8)
                        Text(L.text("about.licenses")).font(.headline)
                        Text(L.text("about.projectLicense")).font(.caption).foregroundStyle(.secondary)
                        Button { showLicenses = true } label: {
                            Label { Text(L.text("about.allLicenses")) } icon: { Image.englishSystemName("doc.text") }
                        }.buttonStyle(.bordered)
                        Text(L.text("about.licenseSummary")).font(.caption).foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    VStack(alignment: .leading, spacing: 12) {
                        Text(L.text("about.thanks")).font(.headline)
                        ForEach(AboutResources.content.credits, id: \.key) { credit in
                            VStack(alignment: .leading, spacing: 4) {
                                linkButton(credit.name, url: credit.url)
                                Text(L.text("about." + credit.key)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                if linkFailed { Text(L.text("about.failed")).foregroundStyle(.secondary) }
                Text(L.text("about.copyright")).font(.caption).foregroundStyle(.tertiary)
            }
            .padding(32)
            .frame(maxWidth: 800)
            .frame(maxWidth: .infinity)
        }
        .background(alignment: .top) {
            GeometryReader { geometry in
                ZStack(alignment: .topLeading) {
                    ForEach(AboutResources.glyphs.indices, id: \.self) { index in
                        GlyphShape(glyph: AboutResources.glyphs[index]).stroke(.primary, lineWidth: 1.25)
                            .frame(width: geometry.size.width * 2.4,
                                   height: geometry.size.width * 2.4 * AboutResources.glyphs[index].height / AboutResources.glyphs[index].width)
                            .offset(x: -geometry.size.width * 1.5, y: -100).opacity(frame == index ? 0.14 : 0)
                    }
                    Path { path in
                        path.move(to: CGPoint(x: 0, y: 120)); path.addLine(to: CGPoint(x: 64, y: 120))
                        path.move(to: CGPoint(x: geometry.size.width - 64, y: 480)); path.addLine(to: CGPoint(x: geometry.size.width, y: 480))
                    }.stroke(.primary.opacity(0.14), lineWidth: 1.25)
                }.clipped().allowsHitTesting(false).accessibilityHidden(true)
            }
        }
        .animation(reducedMotion ? nil : .easeInOut(duration: 0.15), value: frame)
        .sheet(isPresented: $showLicenses) { AboutLicenseReader() }
        .onDisappear(perform: cleanup)
        .onChange(of: isActive) { _, active in if !active { cleanup() } }
    }
    private func linkButton(_ title: String, url: String) -> some View {
        Button { open(url) } label: {
            HStack { Text(title); Spacer(); Image.englishSystemName("arrow.up.right").font(.caption) }
        }.buttonStyle(.plain).foregroundStyle(.tint)
    }
    private func open(_ value: String) {
        guard AboutResources.allowed(value), let url = URL(string: value) else { linkFailed = true; return }
        linkFailed = !NSWorkspace.shared.open(url)
    }
    private func activate() {
        guard isActive else { return }
        frame = (frame + 1) % AboutResources.glyphs.count
    }
    private func cleanup() {
        frame = 0
        updateTask?.cancel(); updateTask = nil
        if status == "checking" { status = "idle" }
        showLicenses = false
    }
    private func checkUpdate() {
        guard updateTask == nil else { return }; status = "checking"; release = nil
        let currentVersion = version
        updateTask = Task { @MainActor in
            let started = Date()
            func fetch(_ value: String) async throws -> Data {
                guard let url = URL(string: value) else { throw AboutUpdateError.failed }
                var request = URLRequest(url: url, timeoutInterval: max(1, 15 - Date().timeIntervalSince(started)))
                request.setValue("Folio/" + currentVersion, forHTTPHeaderField: "User-Agent")
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                let (data, response) = try await URLSession.shared.data(for: request)
                guard data.count <= 2_000_000, let http = response as? HTTPURLResponse else { throw AboutUpdateError.failed }
                switch http.statusCode {
                case 200: return data
                case 404: throw value.hasSuffix("/releases/latest") ? AboutUpdateError.noRelease : AboutUpdateError.failed
                case 403, 429: throw AboutUpdateError.rateLimited
                default: throw AboutUpdateError.failed
                }
            }
            do {
                struct Latest: Decodable {
                    struct Asset: Decodable { let name: String; let browser_download_url: String }
                    let tag_name: String; let html_url: String; let draft: Bool; let prerelease: Bool; let assets: [Asset]
                }
                let latest = try JSONDecoder().decode(Latest.self, from: await fetch("https://api.github.com/repos/aurysian-yan/Folio/releases/latest"))
                let expected = latest.tag_name.hasPrefix("v") ? String(latest.tag_name.dropFirst()) : latest.tag_name
                let assets = latest.assets.filter { $0.name == "folio-release.json" }
                guard !latest.draft, !latest.prerelease, latest.html_url == AboutRelease.repository + "/releases/tag/v" + expected,
                      assets.count == 1, AboutRelease.validURL(assets[0].browser_download_url, download: true),
                      assets[0].browser_download_url.hasPrefix(AboutRelease.repository + "/releases/download/v\(expected)/") else { throw AboutUpdateError.failed }
                let data = try await fetch(assets[0].browser_download_url)
                guard data.count <= 100_000 else { throw AboutUpdateError.failed }
                let manifest = try JSONDecoder().decode(AboutRelease.self, from: data)
                try manifest.validate(expected: expected)
                try Task.checkCancellation()
                release = manifest
                status = !manifest.artifacts.contains(where: { $0.platform == "macos" && $0.arch == arch }) ? "unavailable"
                    : try AboutRelease.compare(manifest.version, version) == .orderedDescending ? "newVersion" : "latest"
            } catch {
                if Task.isCancelled { return }
                switch error {
                case AboutUpdateError.noRelease: status = "noRelease"
                case AboutUpdateError.rateLimited: status = "rateLimited"
                case let error as URLError where error.code == .timedOut: status = "timeout"
                default: status = "failed"
                }
            }
            updateTask = nil
        }
    }
}
private struct AboutLicenseReader: View {
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var selected: AboutLicense?
    @State private var linkFailed = false
    private var entries: [AboutLicense] {
        AboutResources.licenses.entries.filter {
            $0.platforms.contains("macos") && (query.isEmpty || "\($0.name) \($0.version) \($0.license)".localizedCaseInsensitiveContains(query))
        }
    }
    var body: some View {
        VStack(spacing: 16) {
            HStack {
                if selected != nil {
                    Button { selected = nil } label: { Image.englishSystemName("chevron.left"); Text(L.text("about.back")) }
                }
                Text(L.text("about.licenses")).font(.headline)
                Spacer()
                Button(L.text("about.close")) { dismiss() }.keyboardShortcut(.cancelAction)
            }
            ZStack {
                VStack {
                    TextField(L.text("about.search"), text: $query).textFieldStyle(.roundedBorder)
                    List(entries) { entry in
                        Button { selected = entry } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(entry.name + " " + entry.version)
                                Text(entry.license == "See notices" ? L.text("about.licenseNotices") : entry.license).font(.caption).foregroundStyle(.secondary)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }.buttonStyle(.plain)
                    }
                    if entries.isEmpty { Text(L.text("about.noResults")).foregroundStyle(.secondary) }
                }.opacity(selected == nil ? 1 : 0).allowsHitTesting(selected == nil).accessibilityHidden(selected != nil)
                if let entry = selected {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            Text(entry.name + " " + entry.version).font(.title2)
                            Text(entry.license == "See notices" ? L.text("about.licenseNotices") : entry.license).foregroundStyle(.secondary)
                            Text(L.format("about.appliesTo", entry.platforms.map { L.text("about.platformNames." + $0) }.joined(separator: " · "))).font(.caption).foregroundStyle(.secondary)
                            Button(L.text("about.sourceLink")) {
                                if AboutResources.allowed(entry.source), let url = URL(string: entry.source) { linkFailed = !NSWorkspace.shared.open(url) }
                            }
                            if linkFailed { Text(L.text("about.failed")) }
                            if entry.declarationOnly { Text(L.text("about.declaration") + ": " + (entry.license == "See notices" ? L.text("about.licenseNotices") : entry.license)) }
                            ForEach(entry.documents.indices, id: \.self) { index in
                                Text(AboutResources.licenses.texts[entry.documents[index].text] ?? "").font(.callout)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }.textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    }.id(entry.id)
                }
            }
        }.padding(24).frame(width: 600, height: 560)
    }
}
