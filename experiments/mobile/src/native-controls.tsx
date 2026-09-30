import type { ReactNode } from 'react';
import type { Theme } from './ui';

export const usesNativeControls = false;

export interface NativeTabsProps {
  children: ReactNode;
  theme: Theme;
  onTabChange: (local: boolean) => void;
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

export function NativeTabs({ children }: NativeTabsProps) { return <>{children}</>; }
export function NativeHeaderControls(_props: NativeHeaderProps) { return null; }
export function NativeActionButton(_props: NativeActionProps) { return null; }
