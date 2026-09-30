import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import { createLibraryClient, type LibraryBridge } from './library';

export const library = createLibraryClient(requireNativeModule<LibraryBridge>('FolioNative'));

export interface PreviewSelection {
  sourcePath: string;
  faceIndex: number;
  revisionId: string;
  axes: Record<string, number>;
  text: string;
}

export interface PreviewStatus {
  status: 'ready' | 'missing-glyph' | 'error';
}

interface PreviewProps extends ViewProps {
  selection: PreviewSelection;
  onStatus: (event: NativeSyntheticEvent<PreviewStatus>) => void;
}

export const NativeFontPreview = requireNativeViewManager<PreviewProps>('FolioNative');
