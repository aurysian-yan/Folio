import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import { createLibraryClient, type LibraryBridge } from './library';
import type { MaterialRoles } from './material-theme';
import { createSyncClient, type SyncBridge } from './sync';
import { ForegroundSyncSession } from './sync-session';
import { createStorageClient, type StorageBridge } from './storage';

// 安卓外观主题桥接：壁纸种子与 Material3 语义色。
interface MaterialBridge {
  wallpaperSeed(): string | null;
  materialPalette(seed: string, dark: boolean, followWallpaper: boolean): MaterialRoles;
}

interface AndroidWindowBridge {
  screenCornerRadius(): number;
}

const nativeModule = requireNativeModule<LibraryBridge & StorageBridge & SyncBridge & MaterialBridge & AndroidWindowBridge & { copyText(text: string): Promise<void>; aboutInfo(): import("../../../shared/about/update").AppInfo }>('FolioNative');
export const cloudSync = createSyncClient(nativeModule);
export const syncSession = new ForegroundSyncSession(cloudSync, () => nativeModule.snapshot());
export const library = createLibraryClient(nativeModule, (action, kind) => syncSession.mutate(action, kind));
export const storage = createStorageClient(nativeModule);
export const copyText = (text: string) => nativeModule.copyText(text);
export const wallpaperSeed = () => nativeModule.wallpaperSeed();
export const materialPalette = (seed: string, dark: boolean, followWallpaper = false) => nativeModule.materialPalette(seed, dark, followWallpaper);
export const screenCornerRadius = () => nativeModule.screenCornerRadius();

export interface PreviewSelection {
  sourcePath: string;
  faceIndex: number;
  revisionId: string;
  axes: Record<string, number>;
  text: string;
  fontSize?: number;
  centered?: boolean;
  wrapWidth?: number;
}

export interface PreviewStatus {
  status: 'ready' | 'missing-glyph' | 'error';
  contentHeight?: number;
}

interface PreviewProps extends ViewProps {
  selection: PreviewSelection;
  onStatus: (event: NativeSyntheticEvent<PreviewStatus>) => void;
}

export const NativeFontPreview = requireNativeViewManager<PreviewProps>('FolioNative');

export const getAboutInfo = () => nativeModule.aboutInfo();
