import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import { createLibraryClient, type LibraryBridge } from './library';
import { createSyncClient, type SyncBridge } from './sync';
import { ForegroundSyncSession } from './sync-session';
import { createStorageClient, type StorageBridge } from './storage';

const nativeModule = requireNativeModule<LibraryBridge & StorageBridge & SyncBridge & { copyText(text: string): Promise<void> }>('FolioNative');
export const cloudSync = createSyncClient(nativeModule);
export const syncSession = new ForegroundSyncSession(cloudSync, () => nativeModule.snapshot());
export const library = createLibraryClient(nativeModule, (action, kind) => syncSession.mutate(action, kind));
export const storage = createStorageClient(nativeModule);
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
