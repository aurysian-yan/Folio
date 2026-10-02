import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// 移动端偏好：外观、字体卡片与导入行为，统一持久化到设备本地。
export type AppearanceMode = 'system';
export type AccentId = 'folio' | 'blue' | 'green' | 'purple';
export type LibraryMode = 'grid' | 'list';

export interface Preferences {
  appearance: AppearanceMode;
  accent: AccentId;
  previewScale: number;
  showCardMetadata: boolean;
  showFavoriteBadge: boolean;
  defaultViewMode: LibraryMode;
  importShowResults: boolean;
}

export const defaultPreferences: Preferences = {
  appearance: 'system',
  accent: 'folio',
  previewScale: 24,
  showCardMetadata: true,
  showFavoriteBadge: true,
  defaultViewMode: 'grid',
  importShowResults: true,
};

// 外观页可选的预览字号，与 FontCard 的基准字号对应。
export const previewScaleOptions = [18, 24, 30] as const;

const storageKey = 'folio.mobile.preferences.v1';
const accentValues: readonly AccentId[] = ['folio', 'blue', 'green', 'purple'];
const viewModeValues: readonly LibraryMode[] = ['grid', 'list'];

function pick<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

function sanitize(raw: unknown): Preferences {
  if (!raw || typeof raw !== 'object') return defaultPreferences;
  const value = raw as Record<string, unknown>;
  const scale = typeof value.previewScale === 'number' && Number.isFinite(value.previewScale)
    ? Math.min(48, Math.max(12, Math.round(value.previewScale)))
    : defaultPreferences.previewScale;
  return {
    // 兼容旧偏好，深浅色统一跟随系统。
    appearance: 'system',
    accent: pick(accentValues, value.accent, defaultPreferences.accent),
    previewScale: scale,
    showCardMetadata: typeof value.showCardMetadata === 'boolean' ? value.showCardMetadata : defaultPreferences.showCardMetadata,
    showFavoriteBadge: typeof value.showFavoriteBadge === 'boolean' ? value.showFavoriteBadge : defaultPreferences.showFavoriteBadge,
    defaultViewMode: pick(viewModeValues, value.defaultViewMode, defaultPreferences.defaultViewMode),
    importShowResults: typeof value.importShowResults === 'boolean' ? value.importShowResults : defaultPreferences.importShowResults,
  };
}

function persist(next: Preferences) {
  // 写入失败不影响当前会话内的偏好使用。
  AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => undefined);
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
