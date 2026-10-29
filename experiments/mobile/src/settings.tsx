import { defaultDashboard, sanitizeDashboard, type DashboardSection } from './browser-dashboard';
import { sanitizePreviewScale } from './preview-scale';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// 移动端偏好：外观、字体卡片与导入行为，统一持久化到设备本地。
export type AppearanceMode = 'system';
export type AccentId = 'folio' | 'blue' | 'green' | 'purple' | 'yellow' | 'pink' | 'cyan' | 'wallpaper';
export type LibraryMode = 'grid' | 'list';

export interface Preferences {
  navigationAutoCollapse: boolean;
  browserShowSourceHomes: boolean;
  browserDashboard: DashboardSection[];
  appearance: AppearanceMode;
  accent: AccentId;
  materialTheme: boolean;
  previewScale: number;
  showCardMetadata: boolean;
  showFavoriteBadge: boolean;
  defaultViewMode: LibraryMode;
  importShowResults: boolean;
  searchAutoFocus: boolean;
  characterMapAutoSelectFirstNonEmpty: boolean;
  characterMapInheritAxes: boolean;
  /** 在线来源的站内配色开关，缺省时仅 Google Fonts 开启。 */
  onlineTheme: Record<string, boolean>;
  /** 按来源保存的自定义 CSS，仅保存在本机。 */
  onlineCss: Record<string, string>;
  /** 是否显示在线来源的区域提示，关闭后不发起出口查询。 */
  onlineRegionHints: boolean;
  /** 首次打开来源时沿用最近提交的站内关键词。 */
  onlineInheritSearchQuery: boolean;
}

export const defaultPreferences: Preferences = {
  navigationAutoCollapse: true,
  browserShowSourceHomes: false,
  browserDashboard: defaultDashboard,
  appearance: 'system',
  accent: 'folio',
  materialTheme: false,
  previewScale: 24,
  showCardMetadata: true,
  showFavoriteBadge: true,
  defaultViewMode: 'grid',
  importShowResults: true,
  searchAutoFocus: false,
  characterMapAutoSelectFirstNonEmpty: true,
  characterMapInheritAxes: true,
  onlineTheme: {},
  onlineCss: {},
  onlineRegionHints: true,
  onlineInheritSearchQuery: true,
};

// 外观页可选的预览字号，与 FontCard 的基准字号对应。
export const previewScaleOptions = [18, 24, 30] as const;

const storageKey = 'folio.mobile.preferences.v1';
const accentValues: readonly AccentId[] = ['folio', 'blue', 'green', 'purple', 'yellow', 'pink', 'cyan', 'wallpaper'];
const viewModeValues: readonly LibraryMode[] = ['grid', 'list'];

function pick<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

function sanitizeTheme(raw: unknown): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [key, item] of Object.entries(raw as Record<string, unknown>)) {
    if (key.length > 0 && key.length <= 100 && typeof item === 'boolean') result[key] = item;
  }
  return result;
}

function sanitizeCss(raw: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [key, item] of Object.entries(raw as Record<string, unknown>)) {
    if (key.length > 0 && key.length <= 100 && typeof item === 'string') {
      result[key] = item.slice(0, 20000);
    }
  }
  return result;
}

function sanitize(raw: unknown): Preferences {
  if (!raw || typeof raw !== 'object') return defaultPreferences;
  const value = raw as Record<string, unknown>;
  const scale = sanitizePreviewScale(value.previewScale, defaultPreferences.previewScale);
  return {
    navigationAutoCollapse: typeof value.navigationAutoCollapse === 'boolean' ? value.navigationAutoCollapse : true,
    browserShowSourceHomes: value.browserShowSourceHomes === true,
    browserDashboard: sanitizeDashboard(value.browserDashboard),
    // 兼容旧偏好，深浅色统一跟随系统。
    appearance: 'system',
    accent: pick(accentValues, value.accent, defaultPreferences.accent),
    materialTheme: typeof value.materialTheme === 'boolean' ? value.materialTheme : defaultPreferences.materialTheme,
    previewScale: scale,
    showCardMetadata: typeof value.showCardMetadata === 'boolean' ? value.showCardMetadata : defaultPreferences.showCardMetadata,
    showFavoriteBadge: typeof value.showFavoriteBadge === 'boolean' ? value.showFavoriteBadge : defaultPreferences.showFavoriteBadge,
    defaultViewMode: pick(viewModeValues, value.defaultViewMode, defaultPreferences.defaultViewMode),
    searchAutoFocus: typeof value.searchAutoFocus === 'boolean' ? value.searchAutoFocus : defaultPreferences.searchAutoFocus,
    importShowResults: typeof value.importShowResults === 'boolean' ? value.importShowResults : defaultPreferences.importShowResults,
    characterMapAutoSelectFirstNonEmpty: typeof value.characterMapAutoSelectFirstNonEmpty === 'boolean' ? value.characterMapAutoSelectFirstNonEmpty : defaultPreferences.characterMapAutoSelectFirstNonEmpty,
    characterMapInheritAxes: typeof value.characterMapInheritAxes === 'boolean' ? value.characterMapInheritAxes : defaultPreferences.characterMapInheritAxes,
    onlineTheme: sanitizeTheme(value.onlineTheme),
    onlineCss: sanitizeCss(value.onlineCss),
    onlineInheritSearchQuery: typeof value.onlineInheritSearchQuery === 'boolean' ? value.onlineInheritSearchQuery : true,
    onlineRegionHints: typeof value.onlineRegionHints === 'boolean' ? value.onlineRegionHints : defaultPreferences.onlineRegionHints,
  };
}

let preferencesQueue = Promise.resolve();
function persist(next: Preferences) {
  // 写入失败不影响当前会话内的偏好使用。
  const raw = JSON.stringify(next);
  preferencesQueue = preferencesQueue.catch(() => {}).then(() => AsyncStorage.setItem(storageKey, raw)).catch(() => {});
}

export interface PreferencesValue {
  preferences: Preferences;
  ready: boolean;
  update: (patch: Partial<Preferences>) => void;
  reset: () => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!mounted || !raw) return;
        try { setPreferences(sanitize(JSON.parse(raw))); } catch { /* 忽略损坏的本地偏好 */ }
      })
      .catch(() => undefined)
      .finally(() => { if (mounted) { loaded.current = true; setReady(true); } });
    return () => { mounted = false; };
  }, []);

  const value = useMemo<PreferencesValue>(() => ({
    preferences,
    ready,
    update: (patch) => setPreferences((current) => {
      const next = sanitize({ ...current, ...patch });
      if (loaded.current) persist(next);
      return next;
    }),
    reset: () => {
      if (loaded.current) persist(defaultPreferences);
      setPreferences(defaultPreferences);
    },
  }), [preferences, ready]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences 必须在 PreferencesProvider 内使用');
  return value;
}
