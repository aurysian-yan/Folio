import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';
import type { PanelBackdropProps } from './PanelBackdrop';
import { settingsLayout } from './settings-ui';

const Backdrop = requireNativeView<ViewProps & { dark: boolean; cornerRadius: number }>('FolioNative', 'FolioPanelBackdrop');

export function PanelBackdrop({ theme, sourceId: _sourceId, ...props }: PanelBackdropProps) {
  return <Backdrop {...props} dark={theme.dark} cornerRadius={settingsLayout.card.borderRadius} pointerEvents="none" />;
}
