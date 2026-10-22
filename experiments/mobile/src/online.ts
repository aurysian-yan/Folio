import type { ImportReport } from './library';

export interface OnlineProvider {
  id: string; name: string; homepage: string; searchTemplate: string; enabled: boolean; builtin: boolean;
  icon?: { kind: 'custom'; assetId: string } | null;
  iconUri?: string | null;
}
export type TransferState = 'queued' | 'transferring' | 'paused' | 'needsUser' | 'failed' | 'ready' | 'completed' | 'cancelled';
export interface OnlineJob {
  id: string; name: string; state: TransferState; bytesDone: number; bytesTotal: number | null;
  kind: 'font' | 'archive' | null; errorKey: string | null;
  origin: { providerId: string | null; providerName: string; sourcePageUrl: string; downloadHost: string };
}
export interface OnlineState { providers: OnlineProvider[]; defaultProviders: OnlineProvider[]; accepted: boolean; jobs: OnlineJob[] }
export interface OnlineEntry {
  id: string; name: string; size: number; eligible: boolean; duplicate: boolean;
  previewPath?: string;
  analysis?: { fingerprint: string; faces: { family: string; style: string; faceIndex: number; duplicate: boolean; conflict: boolean }[] };
}
export interface BrowserState {
  url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; errorKey: string | null;
}
export interface OnlineBridge {
  onlineState(): Promise<string>;
  onlineImportIcon(uri: string): Promise<string>;
  onlineAcceptDisclaimer(): Promise<void>;
  onlineSaveProviders(value: string): Promise<void>;
  onlineSearch(id: string, query: string): Promise<string>;
  onlineDownload(intentId: string): Promise<string>;
  onlinePause(id: string): Promise<void>;
  onlineCancel(id: string): Promise<void>;
  onlineRetry(id: string): Promise<void>;
  onlineInspect(id: string): Promise<string>;
  onlineImport(id: string, selection: string[]): Promise<ImportReport>;
  onlineSave(id: string): Promise<void>;
}

export function createOnlineClient(bridge: OnlineBridge) {
  return {
    state: async (): Promise<OnlineState> => JSON.parse(await bridge.onlineState()),
    importIcon: async (uri: string): Promise<{ assetId: string; uri: string }> => JSON.parse(await bridge.onlineImportIcon(uri)),
    accept: () => bridge.onlineAcceptDisclaimer(),
    saveProviders: (providers: OnlineProvider[]) => bridge.onlineSaveProviders(JSON.stringify(providers)),
    search: (id: string, query: string) => bridge.onlineSearch(id, query),
    download: (id: string) => bridge.onlineDownload(id),
    pause: (id: string) => bridge.onlinePause(id),
    cancel: (id: string) => bridge.onlineCancel(id),
    retry: (id: string) => bridge.onlineRetry(id),
    inspect: async (id: string): Promise<OnlineEntry[]> => JSON.parse(await bridge.onlineInspect(id)),
    collect: (id: string, selected: string[]) => bridge.onlineImport(id, selected),
    save: (id: string) => bridge.onlineSave(id),
  };
}

// 仅展示登记过的错误键，原生异常不直接进入界面。
export function onlineErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/online\.browser\.[A-Za-z]+/)?.[0] ?? 'common.operationFailed';
}
