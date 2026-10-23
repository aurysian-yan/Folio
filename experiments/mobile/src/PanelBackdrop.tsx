import { View, type ViewProps } from 'react-native';
import type { Theme } from './ui';

export interface PanelBackdropProps extends ViewProps { theme: Theme; sourceId: string; cornerRadius?: number; navigationGlass?: boolean }

export function PanelBackdrop({ theme, sourceId: _sourceId, navigationGlass: _navigationGlass, style, cornerRadius = 24, ...props }: PanelBackdropProps) {
  return <View {...props} style={[style, { backgroundColor: theme.surface, borderRadius: cornerRadius }]} />;
}
