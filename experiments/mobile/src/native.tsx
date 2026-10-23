import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import { createCharacterMapClient, type CharacterMapBridge } from '../../../shared/character-map';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import { createLibraryClient, type LibraryBridge } from './library';
import type { MaterialRoles } from './material-theme';
import { createSyncClient, type SyncBridge } from './sync';
import { ForegroundSyncSession } from './sync-session';
import { createStorageClient, type StorageBridge } from './storage';
import { createOnlineClient, type BrowserState, type OnlineBridge, type WebPalette } from './online';

// 安卓外观主题桥接：壁纸种子与 Material3 语义色。
interface MaterialBridge {
  wallpaperSeed(): string | null;
  materialPalette(seed: string, dark: boolean, followWallpaper: boolean): MaterialRoles;
  materialWebPalette(seed: string, dark: boolean, followWallpaper: boolean): WebPalette;
}

interface AndroidWindowBridge {
  screenCornerRadius(): number;
  screenMetrics(): ScreenMetrics;
}

export interface ScreenMetrics {
  width: number;
  height: number;
  shortestSide: number;
  topCornerRadius: number;
  bottomCornerRadius: number;
}

interface FileWorkflowBridge { cancelFileWorkflow(id:string):Promise<boolean>; fileWorkflow(request: string): Promise<string>; fileState(): Promise<string>; removeExternalSource(id: string): Promise<void>; }

const nativeModule = requireNativeModule<OnlineBridge & FileWorkflowBridge & LibraryBridge & StorageBridge & SyncBridge & MaterialBridge & AndroidWindowBridge & CharacterMapBridge & { copyText(text: string): Promise<void>; aboutInfo(): import("../../../shared/about/update").AppInfo }>('FolioNative');
export const online = createOnlineClient(nativeModule);
export const NativeOnlineBrowser = requireNativeViewManager<ViewProps & {
  provider: string;
  command: string;
  active: boolean;
  webTheme: string;
  accentColor: string;
  onBrowserState: (event: NativeSyntheticEvent<BrowserState>) => void;
  onDownloadIntent: (event: NativeSyntheticEvent<{ id: string; name: string }>) => void;
}>('FolioNative', 'FolioOnlineView');
export const characterMap = createCharacterMapClient(nativeModule);
export const cloudSync = createSyncClient(nativeModule);
export const syncSession = new ForegroundSyncSession(cloudSync, () => nativeModule.snapshot());
export const library = createLibraryClient(nativeModule, (action, kind) => syncSession.mutate(action, kind));
export const storage = createStorageClient(nativeModule);
export const copyText = (text: string) => nativeModule.copyText(text);
export const wallpaperSeed = () => nativeModule.wallpaperSeed();
export const materialPalette = (seed: string, dark: boolean, followWallpaper = false) => nativeModule.materialPalette(seed, dark, followWallpaper);
export const materialWebPalette = (seed: string, dark: boolean, followWallpaper = false) => nativeModule.materialWebPalette(seed, dark, followWallpaper);
export const screenCornerRadius = () => nativeModule.screenCornerRadius();
export const screenMetrics = () => nativeModule.screenMetrics();

export interface PreviewSelection {
  requestId?: string;
  sourcePath: string;
  faceIndex: number;
  revisionId: string;
  axes: Record<string, number>;
  text: string;
  fontSize?: number;
  centered?: boolean;
  wrapWidth?: number;
  foregroundColor?: string;
}

export interface PreviewStatus {
  requestId?: string;
  status: 'ready' | 'missing-glyph' | 'error';
  contentHeight?: number;
}

interface PreviewProps extends ViewProps {
  selection: PreviewSelection;
  editable?: boolean;
  tintColor?: string;
  mostRecentTextEventCount?: number;
  onTextChange?: (event: NativeSyntheticEvent<{ text: string; eventCount: number }>) => void;
  onStatus: (event: NativeSyntheticEvent<PreviewStatus>) => void;
}

export const NativeFontPreview = requireNativeViewManager<PreviewProps>('FolioNative', 'FolioFontPreview');

export const getAboutInfo = () => nativeModule.aboutInfo();

export const cancelFileWorkflow = (id:string) => nativeModule.cancelFileWorkflow(id);
export const fileWorkflow = (request: string) => nativeModule.fileWorkflow(request);
export const fileState = () => nativeModule.fileState();
export const removeExternalSource = (id: string) => nativeModule.removeExternalSource(id);
