import type { PagePreview } from './browser-dashboard.ts';
import type { BrowserVisit, OnlineJob, OnlineProvider } from './online.ts';

// 浏览资料只保存网页元数据，不包含凭据、下载地址或网页内容。
export const personalFolderId = 'personal';
export interface BrowserFolder { id: string; name: string }
export interface Bookmark { id: string; title: string; url: string; folderId: string | null; providerId: string | null }
export type BookmarkDraft = Omit<Bookmark, 'id'> & { id?: string };
export type BrowserLibraryTab = 'bookmarks' | 'history' | 'downloads';
export interface BrowserLibraryRequest { id: string; tab: BrowserLibraryTab; bookmark: BookmarkDraft | null }
export interface HistoryEntry { id: string; title: string; url: string; visitedAt: number; providerId: string | null }
export interface BrowserData { version: 1; bookmarks: Bookmark[]; folders: BrowserFolder[]; history: HistoryEntry[]; searches: string[]; previews: Record<string, PagePreview> }
export const emptyBrowserData: BrowserData = { version: 1, bookmarks: [], folders: [], history: [], searches: [], previews: {} };
let serial = 0;
export function browserId() { return `${Date.now().toString(36)}-${(++serial).toString(36)}`; }

export function browserAddress(value: string): string | null {
  const text = value.trim();
  if (!text || /\s/.test(text)) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')
      || /(^|\.)(localhost|local|internal)$/.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}
export function browserHost(url: string) { try { return new URL(url).hostname; } catch { return ''; } }
export function matchingProvider(providers: OnlineProvider[], url: string, preferred?: string | null) {
  const host = browserHost(url);
  const matches = providers.filter((item) => {
    const home = browserHost(item.homepage);
    return item.enabled && home && (host === home || host.endsWith(`.${home}`));
  });
  return matches.find((item) => item.id === preferred) ?? matches[0] ?? null;
}
export function historyDay(time: number) {
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
export function pruneHistory(entries: HistoryEntry[], now = Date.now()) {
  return entries.filter((item) => now - item.visitedAt <= 90 * 86400000 && item.visitedAt <= now)
    .sort((a, b) => b.visitedAt - a.visitedAt).slice(0, 1000);
}
export function recordHistory(data: BrowserData, visit: Omit<HistoryEntry, 'id'>): BrowserData {
  const url = browserAddress(visit.url);
  if (!url) return data;
  const previous = data.history.find((item) => item.url === url && historyDay(item.visitedAt) === historyDay(visit.visitedAt));
  return { ...data, history: pruneHistory([
    { ...visit, url, title: visit.title.trim() || browserHost(url), id: previous?.id ?? browserId() },
    ...data.history.filter((item) => item.id !== previous?.id),
  ], visit.visitedAt) };
}
export function applyBrowserVisit(data: BrowserData, visit: BrowserVisit, providerId: string | null, previousUrl?: string): BrowserData {
  const url = browserAddress(visit.url);
  if (!url) return data;
  if (visit.reload || visit.sameDocument) {
    const previous = data.history.find((item) => item.url === previousUrl);
    if (!previous) return data;
    return { ...data, history: data.history.map((item) => item.id === previous.id
      ? { ...item, url, title: visit.title.trim() || item.title, providerId } : item) };
  }
  return recordHistory(data, { url, title: visit.title, visitedAt: visit.visitedAt, providerId });
}
export function saveBookmark(data: BrowserData, bookmark: Omit<Bookmark, 'id'> & { id?: string }): BrowserData {
  const url = browserAddress(bookmark.url);
  if (!url) throw new Error('online.browser.invalidSource');
  const existing = data.bookmarks.find((item) => item.url === url) ?? data.bookmarks.find((item) => item.id === bookmark.id);
  const next: Bookmark = { ...bookmark, url, title: bookmark.title.trim() || browserHost(url), id: existing?.id ?? browserId() };
  return { ...data, bookmarks: existing ? data.bookmarks.map((item) => item.id === existing.id ? next : item)
    .filter((item) => item.id === next.id || item.id !== bookmark.id) : [...data.bookmarks, next] };
}
export function removeFolder(data: BrowserData, id: string): BrowserData {
  if (id === personalFolderId) return data;
  return { ...data, folders: data.folders.filter((item) => item.id !== id),
    bookmarks: data.bookmarks.map((item) => item.folderId === id ? { ...item, folderId: null } : item) };
}
export function moveBrowserItem<T extends { id: string }>(items: T[], id: string, direction: number): T[] {
  const index = items.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
export function moveBookmark(data: BrowserData, id: string, direction: number): BrowserData {
  const item = data.bookmarks.find((bookmark) => bookmark.id === id);
  if (!item) return data;
  const siblings = data.bookmarks.filter((bookmark) => bookmark.folderId === item.folderId);
  const index = siblings.findIndex((bookmark) => bookmark.id === id);
  const other = siblings[index + direction];
  if (!other) return data;
  const bookmarks = [...data.bookmarks];
  const from = bookmarks.indexOf(item);
  const to = bookmarks.indexOf(other);
  [bookmarks[from], bookmarks[to]] = [other, item];
  return { ...data, bookmarks };
}
export function addSearch(searches: string[], text: string) {
  const value = text.trim().replace(/\s+/g, ' ');
  return value ? [value, ...searches.filter((item) => item.toLowerCase() !== value.toLowerCase())].slice(0, 10) : searches;
}
export function downloadBadge(jobs: OnlineJob[]) {
  const count = jobs.filter((item) => item.state === 'queued' || item.state === 'transferring').length;
  return { count, attention: jobs.some((item) => ['failed', 'paused', 'needsUser', 'ready'].includes(item.state)) };
}
export function readBrowserData(raw: string | null, now = Date.now()): BrowserData {
  if (!raw) return { ...emptyBrowserData };
  const value = JSON.parse(raw) as BrowserData;
  if (value.version !== 1 || !Array.isArray(value.folders) || !Array.isArray(value.bookmarks) || !Array.isArray(value.history)) throw new Error('invalid-browser-data');
  const folders = value.folders.filter((item) => typeof item.id === 'string' && item.id !== personalFolderId && typeof item.name === 'string');
  const bookmarks = value.bookmarks.filter((item) => typeof item.id === 'string' && typeof item.title === 'string' && typeof item.url === 'string' && !!browserAddress(item.url))
    .map((item) => ({ ...item, folderId: item.folderId === personalFolderId || folders.some((folder) => folder.id === item.folderId) ? item.folderId : null }));
  const previews: Record<string, PagePreview> = {};
  if (value.previews && typeof value.previews === 'object') {
    for (const [url, preview] of Object.entries(value.previews).slice(-100)) {
      if (browserAddress(url) && preview && typeof preview.title === 'string' && typeof preview.description === 'string' && Number.isFinite(preview.fetchedAt)) {
        previews[url] = { title: preview.title.slice(0, 300), description: preview.description.slice(0, 1000), fetchedAt: preview.fetchedAt,
          image: typeof preview.image === 'string' ? browserAddress(preview.image) : null };
      }
    }
  }
  return { version: 1, folders, bookmarks, previews, history: pruneHistory(value.history.filter((item) => typeof item.id === 'string'
    && typeof item.title === 'string' && typeof item.url === 'string' && !!browserAddress(item.url) && Number.isFinite(item.visitedAt)), now),
    searches: Array.isArray(value.searches) ? value.searches.filter((item) => typeof item === 'string').slice(0, 10) : [] };
}

export function searchDownloadJobs(jobs: OnlineJob[], query: string) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return jobs.filter((job) => job.state !== 'cancelled' && tokens.every((token) =>
    `${job.name} ${job.origin.providerName} ${job.origin.downloadHost}`.toLowerCase().includes(token)))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}
