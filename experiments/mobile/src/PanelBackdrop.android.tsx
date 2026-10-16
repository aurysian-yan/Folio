import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';
import type { PanelBackdropProps } from './PanelBackdrop';
import { settingsLayout } from './settings-ui';

const Backdrop = requireNativeView<ViewProps & { sourceId: string; active: boolean; tintColor: string; borderColor: string; cornerRadius: number }>(
  'FolioNavigation', 'FolioPanelBackdropView');

export function PanelBackdrop({ theme, cornerRadius = settingsLayout.card.borderRadius, ...props }: PanelBackdropProps) {
  return <Backdrop {...props} active tintColor={theme.surface} borderColor={theme.border} cornerRadius={cornerRadius} pointerEvents="none" />;
}
