import { View, type ViewProps } from 'react-native';
import type { Theme } from './ui';

export interface PanelBackdropProps extends ViewProps { theme: Theme; sourceId: string; cornerRadius?: number }

export function PanelBackdrop({ theme, sourceId: _sourceId, style, cornerRadius = 24, ...props }: PanelBackdropProps) {
  return <View {...props} style={[style, { backgroundColor: theme.surface, borderRadius: cornerRadius }]} />;
}
