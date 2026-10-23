import type { ImportReport } from './library';
import type { Theme } from './ui';

export type WebPalette = Record<string, string>;

export interface OnlineProvider {
  id: string; name: string; homepage: string; searchTemplate: string; enabled: boolean; builtin: boolean;
  icon?: { kind: 'custom'; assetId: string } | null;
  iconUri?: string | null;
}
export type TransferState = 'queued' | 'transferring' | 'paused' | 'needsUser' | 'failed' | 'ready' | 'completed' | 'cancelled';
export interface OnlineJob {
  id: string; name: string; state: TransferState; bytesDone: number; bytesTotal: number | null;
  kind: 'font' | 'archive' | null; errorKey: string | null;
  origin: { providerId: string | null; providerName: string; sourcePageUrl: string; downloadHost: string };
}
export interface OnlineState { providers: OnlineProvider[]; defaultProviders: OnlineProvider[]; accepted: boolean; jobs: OnlineJob[] }
export interface OnlineEntry {
  id: string; name: string; size: number; eligible: boolean; duplicate: boolean;
  previewPath?: string;
  analysis?: { fingerprint: string; faces: { family: string; style: string; faceIndex: number; duplicate: boolean; conflict: boolean }[] };
}
export interface BrowserState {
  url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; errorKey: string | null;
}
export interface OnlineBridge {
  onlineState(): Promise<string>;
  onlineImportIcon(uri: string): Promise<string>;
  onlineAcceptDisclaimer(): Promise<void>;
  onlineSaveProviders(value: string): Promise<void>;
  onlineClearData(): Promise<void>;
  onlineSearch(id: string, query: string): Promise<string>;
  onlineDownload(intentId: string): Promise<string>;
  onlinePause(id: string): Promise<void>;
  onlineCancel(id: string): Promise<void>;
  onlineRetry(id: string): Promise<void>;
  onlineInspect(id: string): Promise<string>;
  onlineImport(id: string, selection: string[]): Promise<ImportReport>;
  onlineSave(id: string): Promise<void>;
}

export function createOnlineClient(bridge: OnlineBridge) {
  return {
    state: async (): Promise<OnlineState> => JSON.parse(await bridge.onlineState()),
    importIcon: async (uri: string): Promise<{ assetId: string; uri: string }> => JSON.parse(await bridge.onlineImportIcon(uri)),
    accept: () => bridge.onlineAcceptDisclaimer(),
    saveProviders: (providers: OnlineProvider[]) => bridge.onlineSaveProviders(JSON.stringify(providers)),
    clearData: () => bridge.onlineClearData(),
    search: (id: string, query: string) => bridge.onlineSearch(id, query),
    download: (id: string) => bridge.onlineDownload(id),
    pause: (id: string) => bridge.onlinePause(id),
    cancel: (id: string) => bridge.onlineCancel(id),
    retry: (id: string) => bridge.onlineRetry(id),
    inspect: async (id: string): Promise<OnlineEntry[]> => JSON.parse(await bridge.onlineInspect(id)),
    collect: (id: string, selected: string[]) => bridge.onlineImport(id, selected),
    save: (id: string) => bridge.onlineSave(id),
  };
}

// 仅展示登记过的错误键，原生异常不直接进入界面。
export function onlineErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/online\.browser\.[A-Za-z]+/)?.[0] ?? 'common.operationFailed';
}

const fallbackQueryKeys = ['query', 'q', 'keyword', 's', 'search', 'text'];

function hostOf(value: string) {
  return /^https:\/\/([^/?#]+)/i.exec(value.trim())?.[1]?.toLowerCase().replace(/^www\./, '') ?? null;
}

function pathOf(value: string) {
  return /^https:\/\/[^/?#]+(\/[^?#]*)/i.exec(value.trim())?.[1] ?? '/';
}

// 只移除分隔符后的已知站点名，保留正文中的品牌名与未知后缀。
export function browserPageTitle(title: string, provider: OnlineProvider | null, url: string): string {
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  const host = hostOf(url);
  const home = provider ? hostOf(provider.homepage) : null;
  const names = new Set<string>();
  if (provider && (!host || host === home || (home && host.endsWith(`.${home}`)))) names.add(normalize(provider.name));
  if (host) {
    names.add(normalize(host));
    const labels = host.split('.');
    const brand = labels.at(-2);
    if (brand && brand.length >= 4 && brand !== 'fonts') names.add(normalize(brand));
  }
  let result = title.trim();
  const isSiteName = (value: string) => {
    const candidate = normalize(value);
    return [...names].some((name) => name && (candidate === name || (candidate.startsWith(name)
      && /^(?:免费|商用|字体|下载|网站|官网|大全|资源|free|fonts?|download|official|website)+$/.test(candidate.slice(name.length)))));
  };
  while (result) {
    const separators = [...result.matchAll(/\s*[-–—|｜·•_:：]\s*/gu)];
    const match = separators.reverse().find((part) => isSiteName(result.slice(part.index + part[0].length)));
    if (!match || match.index === 0) break;
    result = result.slice(0, match.index).trim();
  }
  return result || title.trim();
}

export function providerCustomCss(value: string | undefined, providerId: string): string {
  if (value !== undefined) return value;
  if (providerId === 'google-fonts') return 'gf-theme-toggle{display:none;}';
  if (providerId === 'zeoseven') return [
    'body { min-width: auto !important; }',
    '.navbar > .container-fluid { padding: 0 !important; }',
    '.logo { height: 1.5rem !important; }',
    '.navbar-toggler-icon { width: 1em !important; height: 1em !important; }',
    '.navbar-toggler { padding: 0.25rem !important; }',
    '.home-1col { padding: 0 !important; }',
    '.home-1col .home-search { max-width: auto !important; }',
  ].join('\n');
  return '';
}

function decodeQuery(value: string) {
  try { return decodeURIComponent(value.replace(/\+/g, ' ')).trim(); }
  catch { return ''; }
}

function queryValue(url: string, key: string) {
  const end = url.search(/[#]/);
  const beforeHash = end < 0 ? url : url.slice(0, end);
  const start = beforeHash.indexOf('?');
  if (start < 0) return null;
  for (const part of beforeHash.slice(start + 1).split('&')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator) === key) return part.slice(separator + 1);
  }
  return null;
}

// 从站内搜索后的地址还原关键词；支持查询参数与路径模板。
export function extractSearchQuery(provider: OnlineProvider, url: string): string | null {
  const home = hostOf(provider.homepage);
  const actual = hostOf(url);
  if (!home || !actual || (actual !== home && !actual.endsWith(`.${home}`))) return null;
  const template = provider.searchTemplate.trim();
  const placeholder = template.indexOf('{{query}}');
  if (placeholder >= 0) {
    const prefix = template.slice(0, placeholder);
    const queryKey = /[?&]([^=&#]+)=$/.exec(prefix)?.[1];
    if (queryKey) {
      const raw = queryValue(url, queryKey);
      const value = raw === null ? '' : decodeQuery(raw);
      if (value) return value;
    } else {
      const templatePath = pathOf(template);
      const actualPath = pathOf(url);
      const pathPlaceholder = templatePath.indexOf('{{query}}');
      if (pathPlaceholder >= 0) {
        const pathPrefix = templatePath.slice(0, pathPlaceholder);
        const pathSuffix = templatePath.slice(pathPlaceholder + '{{query}}'.length);
        if (actualPath.startsWith(pathPrefix) && actualPath.endsWith(pathSuffix)) {
          const end = pathSuffix ? actualPath.length - pathSuffix.length : actualPath.length;
          const value = decodeQuery(actualPath.slice(pathPrefix.length, end));
          if (value) return value;
        }
      }
      // 模板含路径参数时，URL 查询参数仍可能使用同一关键词。
      const raw = queryValue(url, 'query');
      const value = raw === null ? '' : decodeQuery(raw);
      if (value) return value;
    }
  }
  for (const key of fallbackQueryKeys) {
    const raw = queryValue(url, key);
    const value = raw === null ? '' : decodeQuery(raw);
    if (value) return value;
  }
  return null;
}

// 站内配色默认只对已验证变量体系的 Google Fonts 开启。
export function providerThemeEnabled(value: boolean | undefined, providerId: string) {
  return value ?? providerId === 'google-fonts';
}

const paletteRoles = [
  'background', 'onBackground', 'surface', 'onSurface', 'surfaceVariant', 'onSurfaceVariant',
  'surfaceDim', 'surfaceBright', 'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer',
  'surfaceContainerHigh', 'surfaceContainerHighest', 'outline', 'outlineVariant', 'scrim', 'shadow',
  'surfaceTint', 'inverseSurface', 'inverseOnSurface', 'inversePrimary',
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer', 'primaryFixed', 'primaryFixedDim',
  'onPrimaryFixed', 'onPrimaryFixedVariant', 'secondary', 'onSecondary', 'secondaryContainer',
  'onSecondaryContainer', 'secondaryFixed', 'secondaryFixedDim', 'onSecondaryFixed', 'onSecondaryFixedVariant',
  'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer', 'tertiaryFixed', 'tertiaryFixedDim',
  'onTertiaryFixed', 'onTertiaryFixedVariant', 'error', 'onError', 'errorContainer', 'onErrorContainer',
] as const;

function kebab(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

// --mat-* 由 Material 组件族固定设置，仅覆盖与颜色相关的常用 token。
const materialTokens: [string, string][] = [
  ['--mat-app-background-color', 'background'],
  ['--mat-app-text-color', 'onBackground'],
  ['--mat-sidenav-content-background-color', 'background'],
  ['--mat-sidenav-content-text-color', 'onSurface'],
  ['--mat-sidenav-container-background-color', 'surface'],
  ['--mat-sidenav-container-text-color', 'onSurface'],
  ['--mat-toolbar-container-background-color', 'surface'],
  ['--mat-toolbar-container-text-color', 'onSurface'],
  ['--mat-autocomplete-background-color', 'surfaceContainer'],
  ['--mat-bottom-sheet-container-background-color', 'surfaceContainerLow'],
  ['--mat-bottom-sheet-container-text-color', 'onSurface'],
  ['--mat-menu-container-color', 'surfaceContainer'],
  ['--mat-menu-item-label-text-color', 'onSurface'],
  ['--mat-menu-item-icon-color', 'onSurfaceVariant'],
  ['--mat-divider-color', 'outlineVariant'],
  ['--mat-ripple-color', 'primary'],
  ['--mat-expansion-container-background-color', 'surface'],
  ['--mat-expansion-container-text-color', 'onSurface'],
  ['--mat-select-enabled-trigger-text-color', 'onSurface'],
  ['--mat-select-enabled-arrow-color', 'onSurfaceVariant'],
  ['--mat-select-panel-background-color', 'surfaceContainer'],
  ['--mat-option-label-text-color', 'onSurface'],
  ['--mat-option-selected-state-label-text-color', 'primary'],
  ['--mat-option-selected-state-layer-color', 'primaryContainer'],
  ['--mat-button-filled-container-color', 'primary'],
  ['--mat-button-filled-label-text-color', 'onPrimary'],
  ['--mat-button-filled-state-layer-color', 'onPrimary'],
  ['--mat-button-filled-ripple-color', 'onPrimary'],
  ['--mat-button-filled-progress-active-indicator-color', 'onPrimary'],
  ['--mat-button-filled-disabled-container-color', 'onSurface'],
  ['--mat-button-filled-disabled-label-text-color', 'onSurface'],
  ['--mat-button-filled-disabled-state-layer-color', 'onSurface'],
  ['--mat-button-outlined-label-text-color', 'primary'],
  ['--mat-button-outlined-outline-color', 'outline'],
  ['--mat-button-outlined-state-layer-color', 'primary'],
  ['--mat-button-outlined-ripple-color', 'primary'],
  ['--mat-button-outlined-disabled-label-text-color', 'onSurface'],
  ['--mat-button-outlined-disabled-outline-color', 'onSurface'],
  ['--mat-button-outlined-disabled-state-layer-color', 'onSurface'],
  ['--mat-button-protected-container-color', 'surfaceContainerHigh'],
  ['--mat-button-protected-label-text-color', 'onSurface'],
  ['--mat-button-protected-state-layer-color', 'onSurface'],
  ['--mat-button-protected-ripple-color', 'onSurface'],
  ['--mat-button-text-label-text-color', 'primary'],
  ['--mat-button-text-state-layer-color', 'primary'],
  ['--mat-button-text-ripple-color', 'primary'],
  ['--mat-button-text-disabled-label-text-color', 'onSurface'],
  ['--mat-button-text-disabled-state-layer-color', 'onSurface'],
  ['--mat-icon-button-icon-color', 'onSurface'],
  ['--mat-icon-button-state-layer-color', 'onSurface'],
  ['--mat-form-field-filled-container-color', 'surfaceContainerHigh'],
  ['--mat-form-field-filled-label-text-color', 'onSurfaceVariant'],
  ['--mat-form-field-filled-input-text-color', 'onSurface'],
  ['--mat-form-field-filled-caret-color', 'primary'],
  ['--mat-form-field-filled-active-indicator-color', 'onSurfaceVariant'],
  ['--mat-form-field-filled-focus-active-indicator-color', 'primary'],
  ['--mat-form-field-outlined-label-text-color', 'onSurfaceVariant'],
  ['--mat-form-field-outlined-input-text-color', 'onSurface'],
  ['--mat-form-field-outlined-outline-color', 'outline'],
  ['--mat-form-field-outlined-focus-outline-color', 'primary'],
  ['--mat-form-field-outlined-caret-color', 'primary'],
  ['--mat-chip-container-color', 'surfaceContainerHigh'],
  ['--mat-chip-label-text-color', 'onSurface'],
  ['--mat-chip-outline-color', 'outline'],
  ['--mat-chip-selected-container-color', 'primaryContainer'],
  ['--mat-chip-selected-label-text-color', 'onPrimaryContainer'],
  ['--mat-chip-selected-state-layer-color', 'onPrimaryContainer'],
  ['--mat-icon-color', 'inherit'],
];

export function buildWebThemeCss(palette: WebPalette, dark: boolean) {
  const value = (role: string) => palette[role];
  const body = [
    'html body,html body.gf-dark-theme{',
    ...paletteRoles.filter((role) => !!value(role)).map((role) => `--sys-${kebab(role)}:${value(role)} !important;`),
    '--sys-link:var(--sys-primary) !important;',
    '--sys-link-hover:var(--sys-primary) !important;',
    '--sys-link-visited:var(--sys-primary) !important;',
    '--sys-neutral10:var(--sys-on-surface) !important;',
    '--sys-neutral-variant20:var(--sys-on-surface-variant) !important;',
    ...materialTokens.flatMap(([token, role]) => {
      const color = value(role);
      if (!color) return [];
      if (token === '--mat-ripple-color' || token.endsWith('-state-layer-color')) {
        return [`${token}:color-mix(in srgb, ${color} 12%, transparent) !important;`];
      }
      return [`${token}:${color} !important;`];
    }),
    `color-scheme:${dark ? 'dark' : 'light'};`,
    '}',
  ].join('');
  const root = [
    ':root{',
    `color-scheme:${dark ? 'dark' : 'light'};`,
    ...paletteRoles.filter((role) => !!value(role)).map((role) => `--folio-${kebab(role)}:${value(role)};`),
    `--folio-color-scheme:${dark ? 'dark' : 'light'};`,
    '}',
  ].join('');
  return `${root}${body}`;
}

// 注入只更新一个 style 节点，不注册脚本桥接。
export function buildWebThemeScript({ palette, dark, enabled, customCss }: {
  palette: WebPalette; dark: boolean; enabled: boolean; customCss?: string | null;
}) {
  const custom = (customCss ?? '').replace(/<\/style/gi, '<\\/style').slice(0, 20000).trim();
  const css = `${enabled ? buildWebThemeCss(palette, dark) : ''}${custom ? `\n${custom}` : ''}`.trim();
  const literal = JSON.stringify(css).replace(/</g, '\\u003c');
  return `(function(){var id='folio-web-theme';var css=${literal};var node=document.getElementById(id);if(!css){if(node&&node.parentNode)node.parentNode.removeChild(node);return document.readyState==='complete';}if(!node){node=document.createElement('style');node.id=id;(document.head||document.documentElement).appendChild(node);}node.textContent=css;return document.readyState==='complete'&&node.textContent===css&&!!node.sheet;})();`;
}

// 无 Monet 时使用当前 Folio 语义色，保证开关在 iOS 也可用。
export function webPaletteFromTheme(theme: Theme, dark: boolean): WebPalette {
  const background = typeof theme.background === 'string' ? theme.background : dark ? '#000000' : '#FFFFFF';
  const base = {
    background, onBackground: theme.label, surface: theme.surface, onSurface: theme.label,
    surfaceVariant: theme.raised, onSurfaceVariant: theme.secondary, surfaceDim: theme.surface,
    surfaceBright: theme.raised, surfaceContainerLowest: background, surfaceContainerLow: theme.surface,
    surfaceContainer: theme.surface, surfaceContainerHigh: theme.raised, surfaceContainerHighest: theme.raised,
    outline: theme.border, outlineVariant: theme.border, scrim: theme.scrim, shadow: theme.shadow,
    surfaceTint: theme.accent, inverseSurface: dark ? '#E6E6E6' : '#303030',
    inverseOnSurface: dark ? '#1A1A1A' : '#F2F2F2', inversePrimary: theme.accent,
    primary: theme.accent, onPrimary: theme.onAccent, primaryContainer: theme.activeTab,
    onPrimaryContainer: theme.label, primaryFixed: theme.activeTab, primaryFixedDim: theme.activeTab,
    onPrimaryFixed: theme.label, onPrimaryFixedVariant: theme.label,
    secondary: theme.secondary, onSecondary: theme.onAccent, secondaryContainer: theme.raised,
    onSecondaryContainer: theme.label, secondaryFixed: theme.raised, secondaryFixedDim: theme.raised,
    onSecondaryFixed: theme.label, onSecondaryFixedVariant: theme.label,
    tertiary: theme.accent, onTertiary: theme.onAccent, tertiaryContainer: theme.raised,
    onTertiaryContainer: theme.label, tertiaryFixed: theme.raised, tertiaryFixedDim: theme.raised,
    onTertiaryFixed: theme.label, onTertiaryFixedVariant: theme.label,
    error: theme.danger, onError: '#FFFFFF', errorContainer: theme.surface, onErrorContainer: theme.danger,
  };
  return base;
}
