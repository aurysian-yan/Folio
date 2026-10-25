import { browserAddress, type HistoryEntry } from './browser-data.ts';
import type { OnlineProvider } from './online.ts';

export type BookmarkStyle = 'normal' | 'detailed' | 'list';
export interface DashboardSection { id: string; rows: number; style: BookmarkStyle }
export const defaultDashboard: DashboardSection[] = [{ id: 'personal', rows: 2, style: 'normal' }, { id: 'recent', rows: 2, style: 'normal' }];

// 保留区块顺序，兼容旧配置并限制单次展示行数。
export function sanitizeDashboard(raw: unknown): DashboardSection[] {
  if (!Array.isArray(raw)) return defaultDashboard;
  const ids = new Set<string>();
  return raw.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const { id, rows, style } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !['personal', 'recent', 'downloads'].includes(id) && !/^folder:.+/.test(id) || ids.has(id)) return [];
    ids.add(id);
    return [{ id, style: style === 'detailed' || style === 'list' ? style : 'normal', rows: typeof rows === 'number' && Number.isFinite(rows) ? Math.max(1, Math.min(6, Math.round(rows))) : 2 }];
  });
}
function homepageKey(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch { return null; }
}
export function recentDashboardEntries(history: HistoryEntry[], providers: OnlineProvider[], showHomes: boolean) {
  const homes = new Set(providers.map((provider) => homepageKey(provider.homepage)).filter(Boolean));
  const seen = new Set<string>();
  return history.filter((entry) => {
    const key = homepageKey(entry.url);
    if (!showHomes && homes.has(key) || seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}
export interface PagePreview { title: string; description: string; image: string | null; fetchedAt: number }
function decodeHtml(value: string) {
  return value.replace(/&#(x[\da-f]+|\d+);/gi, (match, code: string) => {
    const point = code[0]?.toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
  }).replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, (_, code: string) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[code.toLowerCase()] ?? '').trim();
}
function attributes(tag: string) {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1]!.toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}
// 仅提取公开页面的标题、摘要和图片地址，不保存正文与脚本。
export function parsePagePreview(html: string, pageUrl: string, now = Date.now()): PagePreview {
  const source = html.slice(0, 524288).replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  const meta: Record<string, string> = {};
  for (const match of source.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.property ?? attrs.name)?.toLowerCase();
    if (key && attrs.content && !meta[key]) meta[key] = attrs.content;
  }
  const firstImage = [...source.matchAll(/<img\b[^>]*>/gi)].map((match) => attributes(match[0])).find((attrs) => attrs.src || attrs['data-src']);
  const candidate = meta['og:image'] || meta['twitter:image'] || firstImage?.src || firstImage?.['data-src'];
  let image: string | null = null;
  try { if (candidate) image = browserAddress(new URL(candidate, pageUrl).href); } catch { /* 忽略无效图片地址 */ }
  return { title: (meta['og:title'] || meta['twitter:title'] || decodeHtml(source.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? '')).slice(0, 300),
    description: (meta['og:description'] || meta.description || meta['twitter:description'] || '').slice(0, 1000), image, fetchedAt: now };
}

export function dashboardColumns(style: BookmarkStyle, width: number, fontScale: number) {
  const minimum = style === 'detailed' ? 180 : 80;
  return style === 'list' ? 1 : Math.max(1, Math.min(style === 'detailed' ? 4 : 6, Math.floor((width + 12) / (minimum * Math.max(1, fontScale) + 12))));
}
export function downloadProgress(bytesDone: number, bytesTotal: number | null) {
  return bytesTotal && bytesTotal > 0 && Number.isFinite(bytesTotal) ? Math.max(0, Math.min(1, bytesDone / bytesTotal)) : null;
}
