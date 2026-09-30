import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import { createLibraryClient, type LibraryBridge } from './library';

const nativeModule = requireNativeModule<LibraryBridge & { copyText(text: string): Promise<void> }>('FolioNative');
export const library = createLibraryClient(nativeModule);
export const copyText = (text: string) => nativeModule.copyText(text);

export interface PreviewSelection {
  sourcePath: string;
  faceIndex: number;
  revisionId: string;
  axes: Record<string, number>;
  text: string;
  fontSize?: number;
  centered?: boolean;
}

export interface PreviewStatus {
  status: 'ready' | 'missing-glyph' | 'error';
}

interface PreviewProps extends ViewProps {
  selection: PreviewSelection;
  onStatus: (event: NativeSyntheticEvent<PreviewStatus>) => void;
}

export const NativeFontPreview = requireNativeViewManager<PreviewProps>('FolioNative');
