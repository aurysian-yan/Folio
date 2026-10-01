import type { ViewProps } from 'react-native';
import type { NativeHeaderProps } from './native-controls';
import type { Theme } from './ui';

export interface AndroidHeaderBackdropProps extends ViewProps {
  sourceId: string;
  active: boolean;
  theme: Theme;
}

export interface AndroidHeaderProps extends NativeHeaderProps {
  sourceId: string;
  active: boolean;
}

export function AndroidHeaderControls(_props: AndroidHeaderProps) { return null; }
export function AndroidHeaderBackdrop(_props: AndroidHeaderBackdropProps) { return null; }
