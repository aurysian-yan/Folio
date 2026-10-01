import type { ReactElement, ReactNode } from 'react';
import { View, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import type { LibrarySnapshot } from './library';
import type { Theme } from './ui';

export const usesNativeControls = false;
export const usesNativeSidebar = false;

export type NativeDestination = 'local' | 'recent' | 'favorites' | 'cloud' | 'settings';

export interface NativeNavigationProps {
  children: ReactNode;
  theme: Theme;
  sidebar: boolean;
  destination: NativeDestination;
  snapshot: LibrarySnapshot | null;
  onDestinationChange: (destination: NativeDestination) => void;
}

export interface NativeHeaderProps {
  theme: Theme;
  mode: 'grid' | 'list';
  width: number;
  searchOpen: boolean;
  searchText: string;
  importing: boolean;
  ready: boolean;
  onModeChange: (mode: 'grid' | 'list') => void;
  onSearch: () => void;
  onSearchTextChange: (text: string) => void;
  onImport: () => void;
}

export interface NativeActionProps {
  label: string;
  systemImage?: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  prominent?: boolean;
  iconOnly?: boolean;
  diameter?: number;
  plain?: boolean;
}

export interface NativeLibraryContentProps extends NativeHeaderProps {
  children: ReactElement;
  title: string;
  subtitle: string;
  active: boolean;
}

export interface NativeScrollContainerProps extends ViewProps {
  hasHeader: boolean;
  onInsetsChange: (event: NativeSyntheticEvent<{ top: number; bottom: number; contentTop: number }>) => void;
}

export function NativeScrollContainer({ hasHeader: _hasHeader, onInsetsChange: _onInsetsChange, ...props }: NativeScrollContainerProps) {
  return <View {...props} />;
}

export function NativeNavigation({ children }: NativeNavigationProps) { return <>{children}</>; }
export function NativeLibraryContent({ children }: NativeLibraryContentProps) { return children; }
export function NativeHeaderControls(_props: NativeHeaderProps) { return null; }
export function NativeActionButton(_props: NativeActionProps) { return null; }
