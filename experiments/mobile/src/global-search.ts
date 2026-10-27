import type { CloudFont } from './sync.ts';
import type { OnlineProvider } from './online.ts';

export type SearchScope = 'all' | 'local' | 'cloud' | 'online' | 'settings';
export interface SettingsSearchEntry {
  page: 'sync' | 'storage' | 'appearance' | 'browsing' | 'online' | 'update' | 'about'; titleKey: string; pageKey: string; keywords: string[]; platform?: 'android';
}
export const settingsSearchEntries: SettingsSearchEntry[] = [
  { page: 'sync', titleKey: 'settings.cloud', pageKey: 'settings.cloud', keywords: ['WebDAV', '同步', 'sync', '账号', 'account'] },
  { page: 'storage', titleKey: 'settings.storage', pageKey: 'settings.storage', keywords: ['缓存', 'cache', '空间', 'space'] },
  { page: 'appearance', titleKey: 'mobile.settings.appearanceAndDisplay', pageKey: 'mobile.settings.appearanceAndDisplay', keywords: ['外观', 'appearance', '颜色', 'color', '主题色', 'theme'] },
  { page: 'appearance', titleKey: 'mobile.settings.materialTheme', platform: 'android', pageKey: 'mobile.settings.appearanceAndDisplay', keywords: ['Material3', '壁纸', 'wallpaper'] },
  { page: 'browsing', titleKey: 'mobile.settings.browsingAndImport', pageKey: 'mobile.settings.browsingAndImport', keywords: ['导入', 'import', '浏览', 'browsing'] },
  { page: 'browsing', titleKey: 'browser.autoCollapse', pageKey: 'mobile.settings.browsingAndImport', keywords: ['导航', '折叠', 'navigation', 'collapse'] },
  { page: 'browsing', titleKey: 'mobile.settings.searchAutoFocus', pageKey: 'mobile.settings.browsingAndImport', keywords: ['搜索', 'search', '键盘', 'keyboard'] },
  { page: 'online', titleKey: 'settings.onlineFonts', pageKey: 'settings.onlineFonts', keywords: ['来源', 'source', '网站', 'website'] },
  { page: 'online', titleKey: 'browser.showSourceHomes', pageKey: 'settings.onlineFonts', keywords: ['首页', '最近浏览', 'homepage', 'recent'] },
  { page: 'online', titleKey: 'browser.inheritSearch', pageKey: 'settings.onlineFonts', keywords: ['关键词', 'keyword', '搜索', 'search'] },
  { page: 'online', titleKey: 'online.browser.downloads', pageKey: 'settings.onlineFonts', keywords: ['下载', 'download'] },
  { page: 'online', titleKey: 'online.browser.regionHints', pageKey: 'settings.onlineFonts', keywords: ['区域', 'region'] },
  { page: 'update', titleKey: 'softwareUpdate.title', pageKey: 'softwareUpdate.title', keywords: ['更新', '版本', '镜像', 'update', 'version', 'release', 'mirror'] },
  { page: 'about', titleKey: 'settings.about', pageKey: 'settings.about', keywords: ['版本', 'version', '许可', 'license'] },
];
export function normalizeSearch(value: string) { return value.trim().replace(/\s+/g, ' ').toLowerCase(); }
export function searchMatches(value: string, ...fields: string[]) {
  const tokens = normalizeSearch(value).split(' ').filter(Boolean);
  const text = normalizeSearch(fields.join(' '));
  return tokens.length > 0 && tokens.every((token) => text.includes(token));
}
export function searchCloud(fonts: CloudFont[], query: string) {
  return fonts.filter((font) => !font.deleted && searchMatches(query, font.displayName, font.filename))
    .sort((a, b) => Number(searchMatches(query, b.displayName)) - Number(searchMatches(query, a.displayName)));
}
export function searchProviders(providers: OnlineProvider[], query: string) {
  return providers.filter((item) => item.enabled).sort((a, b) => {
    const score = (item: OnlineProvider) => searchMatches(query, item.name) ? 2 : searchMatches(query, item.homepage) ? 1 : 0;
    return score(b) - score(a);
  });
}
export function searchSettings(query: string, translate: (key: string) => string, platform?: string) {
  return settingsSearchEntries.filter((entry) => (!entry.platform || !platform || entry.platform === platform) && searchMatches(query, translate(entry.titleKey), translate(entry.pageKey), ...entry.keywords))
    .sort((a, b) => Number(searchMatches(query, translate(b.titleKey))) - Number(searchMatches(query, translate(a.titleKey))));
}
