import type { Theme } from './ui';

// 原生 Material3 色彩角色，仅保留映射到 Folio 语义色所需的项。
export interface MaterialRoles {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  surface: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  onSurface: string;
  onSurfaceVariant: string;
  outlineVariant: string;
  error: string;
}

function withAlpha(hex: string, alpha: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}, ${alpha})`;
}

// 把 Material3 角色映射到既有语义 token，不新增主题字段。
export function materialThemeOverrides(roles: MaterialRoles, dark: boolean): Partial<Theme> {
  return {
    accent: roles.primary,
    onAccent: roles.onPrimary,
    background: roles.surface,
    surface: roles.surfaceContainer,
    raised: roles.surfaceContainerHigh,
    label: roles.onSurface,
    secondary: roles.onSurfaceVariant,
    muted: roles.onSurfaceVariant,
    border: roles.outlineVariant,
    backButtonBorder: roles.outlineVariant,
    tab: roles.surfaceContainerHigh,
    activeTab: roles.primaryContainer,
    buttonPressed: roles.surfaceContainerHighest,
    buttonPressedLabel: roles.onSurface,
    switchTrack: roles.surfaceContainerHighest,
    listCardSurface: roles.surfaceContainerHigh,
    listCardBorder: roles.outlineVariant,
    danger: roles.error,
    selection: withAlpha(roles.primary, dark ? 0.25 : 0.2),
  };
}
