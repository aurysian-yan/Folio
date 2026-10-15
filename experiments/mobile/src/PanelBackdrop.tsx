import { View, type ViewProps } from 'react-native';
import type { Theme } from './ui';

export interface PanelBackdropProps extends ViewProps { theme: Theme; sourceId: string }

export function PanelBackdrop({ theme, sourceId: _sourceId, style, ...props }: PanelBackdropProps) {
  return <View {...props} style={[style, { backgroundColor: theme.surface }]} />;
}
