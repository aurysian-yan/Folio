import { View, type ViewProps } from 'react-native';
import type { Theme } from './ui';

export interface PanelBackdropProps extends ViewProps { theme: Theme; sourceId: string; cornerRadius?: number; navigationGlass?: boolean; continuousCapsule?: boolean; blurRadius?: number; liquid?: boolean }

export function PanelBackdrop({ theme, sourceId: _sourceId, navigationGlass: _navigationGlass, continuousCapsule: _continuousCapsule, blurRadius: _blurRadius, liquid: _liquid, style, cornerRadius = 24, ...props }: PanelBackdropProps) {
  return <View {...props} style={[style, { backgroundColor: theme.surface, borderRadius: cornerRadius }]} />;
}
