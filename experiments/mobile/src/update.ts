import { compareVersions, isReleaseUrl, matchingArtifacts, repositoryUrl, validateManifest, type AppInfo } from '../../../shared/about/update.ts';
import { androidUpdateResult, validateAndroidManifest, type MobileManifest, type MobileUpdateResult, type ReleaseArtifact } from '../../../shared/about/android-release.ts';

export const releaseMirrors = [
  { id: 'direct', name: 'GitHub', prefix: '' },
  { id: 'ghfast', name: 'GhFast', prefix: 'https://ghfast.top/' },
  { id: 'ghproxy', name: 'GhProxy', prefix: 'https://gh-proxy.com/' },
  { id: 'ghproxyorg', name: 'GhProxyOrg', prefix: 'https://gh-proxy.org/' },
  { id: 'ghddlc', name: 'GhDdlc', prefix: 'https://gh.ddlc.top/' },
  { id: 'isteed', name: 'Isteed', prefix: 'https://cors.isteed.cc/' },
] as const;
export type ReleaseMirrorId = typeof releaseMirrors[number]['id'];
export type MirrorSpeed = { status: 'testing' | 'unavailable' } | { status: 'success'; milliseconds: number };
export type ManifestReader = (url: string, signal: AbortSignal) => Promise<{ status: number; body: string }>;
export const latestManifestUrl = `${repositoryUrl}/releases/latest/download/folio-release.json`;
export const latestAndroidManifestUrl = `${repositoryUrl}/releases/latest/download/folio-release-v2.json`;
export function utf8Size(value: string): number {
  let bytes = 0;
  for (const character of value) { const code = character.codePointAt(0)!; bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4; }
  return bytes;
}
export function normalizeMirror(value: unknown): ReleaseMirrorId {
  return releaseMirrors.find((mirror) => mirror.id === value)?.id ?? 'direct';
}

// 仅对本仓库的附件改写传输地址，清单保留原始来源。
export function mirrorReleaseUrl(url: string, mirrorId: ReleaseMirrorId): string {
  if (url !== latestManifestUrl && url !== latestAndroidManifestUrl && !isReleaseUrl(url, true)) throw new Error('failed');
  const mirror = releaseMirrors.find((item) => item.id === mirrorId);
  if (!mirror) throw new Error('failed');
  return mirror.prefix ? mirror.prefix + url.replace(/^https:\/\//, '') : url;
}

export const readManifest: ManifestReader = async (url, signal) => {
  const response = await fetch(url, { signal, credentials: 'omit', headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
  const length = Number(response.headers.get('content-length'));
  if (length > 100_000) throw new Error('failed');
  const body = await response.text();
  if (utf8Size(body) > 100_000) throw new Error('failed');
  return { status: response.status, body };
};

// 超时与外部取消共同约束读取，即使传输层没有响应取消也能结束等待。
async function loadManifest(url: string, mirror: ReleaseMirrorId, parent?: AbortSignal, timeout = 15_000, reader = readManifest, version?: string): Promise<MobileManifest> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) controller.abort();
  const timer = setTimeout(abort, timeout);
  let rejectAbort: () => void = () => {};
  try {
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error(parent?.aborted ? 'cancelled' : 'timeout'));
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    });
    const response = await Promise.race([reader(mirrorReleaseUrl(url, mirror), controller.signal), cancelled]);
    if (controller.signal.aborted) throw new Error('cancelled');
    if (response.status === 404) throw new Error('noRelease');
    if ([403, 429].includes(response.status)) throw new Error('rateLimited');
    if (response.status !== 200 || utf8Size(response.body) > 100_000) throw new Error('failed');
    return url.endsWith('/folio-release-v2.json')
      ? validateAndroidManifest(JSON.parse(response.body), version) : validateManifest(JSON.parse(response.body), version);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}
export async function checkMobileUpdate(app: AppInfo, mirror: ReleaseMirrorId, signal?: AbortSignal, reader = readManifest): Promise<MobileUpdateResult> {
  try {
    if (app.platform === 'android' && app.sdkInt !== undefined) {
      const migration = app.androidVariant === 'legacy' && app.sdkInt >= 33;
      if (migration) {
        try {
          const pinned = await loadManifest(`${repositoryUrl}/releases/download/v${app.version}/folio-release-v2.json`, mirror, signal, 15_000, reader, app.version);
          if (pinned.schemaVersion === 2) {
            const result = androidUpdateResult(pinned, app);
            if (result.status === 'variantRequired') return result;
          }
        } catch { if (signal?.aborted) throw new Error('cancelled'); }
      }
      try {
        const release = await loadManifest(latestAndroidManifestUrl, mirror, signal, 15_000, reader);
        if (release.schemaVersion !== 2) throw new Error('failed');
        return androidUpdateResult(release, app);
      } catch (cause) {
        if (migration || (app.sdkInt ?? 0) >= 33 || !(cause instanceof Error) || cause.message !== 'noRelease') throw cause;
      }
    }
    const release = await loadManifest(latestManifestUrl, mirror, signal, 15_000, reader);
    if (release.schemaVersion !== 1) throw new Error('failed');
    const artifacts = matchingArtifacts(release, app);
    if (app.platform === 'android' && app.sdkInt !== undefined && compareVersions(release.version, app.version) > 0) {
      return { release, artifacts: [], status: 'unavailable' };
    }
    return { release, artifacts, status: compareVersions(release.version, app.version) > 0 ? app.platform === 'ios' || artifacts.length ? 'newVersion' : 'unavailable' : 'latest' };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return { status: message === 'noRelease' && mirror !== 'direct' ? 'failed' : message === 'noRelease' || message === 'rateLimited' || message === 'timeout' ? message : 'failed' };
  }
}

// 每次展开创建独立代次；关闭、重开和卸载都使旧回调失效。
export class MirrorSpeedSession {
  private controller?: AbortController;
  private readonly reader: ManifestReader;
  private readonly timeout: number;
  constructor(reader: ManifestReader = readManifest, timeout = 5_000) { this.reader = reader; this.timeout = timeout; }
  close() { this.controller?.abort(); this.controller = undefined; }
  async open(version: string | undefined, onResult: (id: ReleaseMirrorId, result: MirrorSpeed) => void, android = false) {
    this.close();
    const controller = new AbortController(); this.controller = controller;
    const filename = android ? 'folio-release-v2.json' : 'folio-release.json';
    const url = version ? `${repositoryUrl}/releases/download/v${version}/${filename}` : android ? latestAndroidManifestUrl : latestManifestUrl;
    await Promise.all(releaseMirrors.map(async (mirror) => {
      onResult(mirror.id, { status: 'testing' });
      const start = performance.now();
      let result: MirrorSpeed;
      try {
        await loadManifest(url, mirror.id, controller.signal, this.timeout, this.reader, version);
        result = { status: 'success', milliseconds: Math.max(1, Math.round(performance.now() - start)) };
      } catch { result = { status: 'unavailable' }; }
      if (this.controller === controller && !controller.signal.aborted) onResult(mirror.id, result);
    }));
  }
}
export function fastestMirror(results: Partial<Record<ReleaseMirrorId, MirrorSpeed>>): ReleaseMirrorId | undefined {
  return releaseMirrors.filter(({ id }) => results[id]?.status === 'success').sort((a, b) => {
    const left = results[a.id]; const right = results[b.id];
    return (left?.status === 'success' ? left.milliseconds : Infinity) - (right?.status === 'success' ? right.milliseconds : Infinity);
  })[0]?.id;
}

export interface UpdateDownload {
  status: 'idle' | 'downloading' | 'paused' | 'ready' | 'failed';
  id?: string; version?: string; bytes?: number; total?: number; error?: string; autoInstall?: boolean; canInstall?: boolean;
}
export interface UpdateBridge {
  updateDownloadState(): Promise<UpdateDownload>;
  startUpdateDownload(request: string): Promise<UpdateDownload>;
  cancelUpdateDownload(): Promise<UpdateDownload>;
  installUpdate(automatic: boolean): Promise<void>;
}
export function downloadRequest(release: Pick<MobileManifest, 'version'>, artifact: ReleaseArtifact, mirror: ReleaseMirrorId) {
  return JSON.stringify({ version: release.version, artifact, mirror });
}
