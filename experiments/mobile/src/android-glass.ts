import { requireNativeModule } from 'expo';
import type { Theme } from './ui';

export const usesGlasmioControls = requireNativeModule<{ androidVariant: string }>('FolioNavigation').androidVariant === 'glasmio';

// 页面底色随消费者传递，背景源释放后仍归属于原页面。
export function androidPageBackdropProps(theme: Theme) {
  return usesGlasmioControls ? { pageBackgroundColor: theme.background, uiTheme: {
    style: theme.ui?.style ?? 'glasmio', revision: theme.revision ?? '',
    dark: String(theme.dark), primary: theme.accent, onPrimary: theme.onAccent,
    surface: String(theme.surface), onSurface: theme.label, onSurfaceVariant: theme.secondary,
    primaryContainer: theme.activeTab, outline: theme.border, error: theme.danger,
    ...theme.materialRoles,
  } } : {};
}
