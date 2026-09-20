import Foundation

final class BookmarkStore: @unchecked Sendable {
    static let shared = BookmarkStore()

    private let defaults = UserDefaults.standard
    private let key = "library-root-bookmarks"
    private let lock = NSLock()
    private var activeURLs: [URL] = []

    private init() {}

    func restoreAccess() {
        lock.lock()
        defer { lock.unlock() }

        for url in activeURLs {
            url.stopAccessingSecurityScopedResource()
        }
        activeURLs.removeAll()

        let bookmarks = defaults.array(forKey: key) as? [Data] ?? []
        var refreshed: [Data] = []
        for data in bookmarks {
            var stale = false
            guard let url = try? URL(
                resolvingBookmarkData: data,
                options: [.withSecurityScope],
                relativeTo: nil,
                bookmarkDataIsStale: &stale
            ) else { continue }
            guard url.startAccessingSecurityScopedResource() else { continue }
            activeURLs.append(url)
            if stale,
               let replacement = try? url.bookmarkData(
                   options: [.withSecurityScope],
                   includingResourceValuesForKeys: nil,
                   relativeTo: nil
               ) {
                refreshed.append(replacement)
            } else {
                refreshed.append(data)
            }
        }
        defaults.set(refreshed, forKey: key)
    }

    func persistAccess(to url: URL) throws {
        let data = try url.bookmarkData(
            options: [.withSecurityScope],
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )
        lock.lock()
        defer { lock.unlock() }
        var bookmarks = defaults.array(forKey: key) as? [Data] ?? []
        bookmarks.append(data)
        defaults.set(bookmarks, forKey: key)
        if url.startAccessingSecurityScopedResource() {
            activeURLs.append(url)
        }
    }
}
