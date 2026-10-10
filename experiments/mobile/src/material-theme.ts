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

// 把 Material3 角色映射到界面语义色。
export function materialThemeOverrides(roles: MaterialRoles, dark: boolean): Partial<Theme> {
  return {
    accent: roles.primary,
    onAccent: roles.onPrimary,
    // 浅色页面使用带色容器底，卡片保持接近白色；深色沿用原有层次。
    background: dark ? roles.surface : roles.surfaceContainer,
    surface: dark ? roles.surfaceContainer : roles.surface,
    raised: roles.surfaceContainerHigh,
    label: roles.onSurface,
    secondary: roles.onSurfaceVariant,
    muted: roles.onSurfaceVariant,
    border: roles.outlineVariant,
    backButtonBorder: roles.outlineVariant,
    tab: dark ? roles.surfaceContainerHigh : roles.surface,
    activeTab: roles.primaryContainer,
    buttonSurface: dark ? roles.surfaceContainer : roles.surface,
    buttonSurfaceOpacity: 0.9,
    buttonPressed: dark ? roles.surfaceContainer : roles.surface,
    buttonPressedLabel: roles.onSurface,
    switchTrack: roles.surfaceContainerHighest,
    listCardSurface: dark ? roles.surfaceContainerHigh : roles.surface,
    listCardBorder: roles.outlineVariant,
    danger: roles.error,
    selection: withAlpha(roles.primary, dark ? 0.25 : 0.2),
  };
}
