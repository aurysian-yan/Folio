import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';
import type { PanelBackdropProps } from './PanelBackdrop';
import { settingsLayout } from './settings-ui';

const Backdrop = requireNativeView<ViewProps & { dark: boolean; cornerRadius: number; blurRadius: number; liquid: boolean }>('FolioNative', 'FolioPanelBackdrop');

export function PanelBackdrop({ theme, sourceId: _sourceId, navigationGlass: _navigationGlass, continuousCapsule: _continuousCapsule, blurRadius = -1, liquid = false, cornerRadius = settingsLayout.card.borderRadius, ...props }: PanelBackdropProps) {
  return <Backdrop {...props} dark={theme.dark} blurRadius={blurRadius} liquid={liquid} cornerRadius={cornerRadius} pointerEvents="none" />;
}
