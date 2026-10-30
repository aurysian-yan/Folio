import { androidPageBackdropProps, usesGlasmioControls } from './android-glass';
import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';
import type { PanelBackdropProps } from './PanelBackdrop';
import { settingsLayout } from './settings-ui';

const Backdrop = requireNativeView<ViewProps & { sourceId: string; active: boolean; tintColor: string; borderColor: string; cornerRadius: number; navigationGlass: boolean; dark: boolean; continuousCapsule?: boolean; blurRadius: number; liquid: boolean }>(
  'FolioNavigation', 'FolioPanelBackdropView');

export function PanelBackdrop({ theme, cornerRadius = settingsLayout.card.borderRadius, navigationGlass = false, continuousCapsule = false, blurRadius = -1, liquid = false, ...props }: PanelBackdropProps) {
  return <Backdrop {...androidPageBackdropProps(theme)} {...props} active tintColor={theme.surface} borderColor={theme.border} cornerRadius={cornerRadius}
    blurRadius={blurRadius} liquid={liquid} navigationGlass={navigationGlass} {...(usesGlasmioControls ? { continuousCapsule } : {})} dark={theme.dark} pointerEvents="none" />;
}
