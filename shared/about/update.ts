import content from './content.json';

export type Platform = 'macos' | 'windows' | 'linux' | 'android' | 'ios';
export type Architecture = 'arm64' | 'x64' | 'universal';
export interface AppInfo { version: string; build: string; platform: Platform; arch: Architecture }
export interface Artifact { platform: Platform; arch: Architecture; format: string; url: string; size: number; sha256: string }
export interface ReleaseManifest { schemaVersion: 1; version: string; publishedAt: string; releaseUrl: string; artifacts: Artifact[] }
export type UpdateStatus = 'idle' | 'checking' | 'latest' | 'newVersion' | 'noRelease' | 'unavailable' | 'timeout' | 'rateLimited' | 'failed';
export interface UpdateResult { status: UpdateStatus; release?: ReleaseManifest; artifacts?: Artifact[] }
export interface HttpResult { status: number; body: string }
export type Transport = (url: string, signal: AbortSignal) => Promise<HttpResult>;
export const repositoryUrl = `https://github.com/${content.repository}`;
export const latestReleaseUrl = `https://api.github.com/repos/${content.repository}/releases/latest`;

// 外链仅允许登记的项目与鸣谢来源，更新下载限于本仓库。
export function isReleaseUrl(value: string, download = false): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.port && !url.search && !url.hash
      && (download ? new RegExp(`^/${content.repository}/releases/download/[^/]+/[^/]+$`).test(url.pathname)
        : new RegExp(`^/${content.repository}/releases/tag/[^/]+$`).test(url.pathname));
  } catch { return false; }
}
export function isAllowedExternalUrl(value: string): boolean {
  return content.links.some((link) => link.url === value) || content.credits.some((credit) => credit.url === value) || isReleaseUrl(value) || isReleaseUrl(value, true);
}

// 不将版本转换为浮点数，保留预发行标识的语义排序。
export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
    if (!match || match[4]?.split('.').some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) throw new Error('failed');
    return { parts: [match[1]!, match[2]!, match[3]!].map(BigInt), pre: match[4]?.split('.') };
  };
  const a = parse(left); const b = parse(right);
  for (let i = 0; i < 3; i++) { if (a.parts[i]! !== b.parts[i]!) return a.parts[i]! > b.parts[i]! ? 1 : -1; }
  if (!a.pre || !b.pre) return a.pre ? -1 : b.pre ? 1 : 0;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i]; const y = b.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x); const yn = /^\d+$/.test(y);
    return xn && yn ? BigInt(x) > BigInt(y) ? 1 : -1 : xn !== yn ? xn ? -1 : 1 : x > y ? 1 : -1;
  }
  return 0;
}
export function validateManifest(input: unknown, expectedVersion?: string): ReleaseManifest {
  if (!input || typeof input !== 'object') throw new Error('failed');
  const value = input as ReleaseManifest;
  if (value.schemaVersion !== 1 || typeof value.version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version)
    || expectedVersion && value.version !== expectedVersion || typeof value.publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.publishedAt)
    || !Number.isFinite(Date.parse(value.publishedAt)) || new Date(value.publishedAt).toISOString().replace('.000Z', 'Z') !== value.publishedAt.replace('.000Z', 'Z') || !isReleaseUrl(value.releaseUrl) || value.releaseUrl !== `${repositoryUrl}/releases/tag/v${value.version}`
    || !Array.isArray(value.artifacts) || value.artifacts.length > 32) throw new Error('failed');
  const formats: Record<Platform, string[]> = { macos: ['dmg'], windows: ['exe'], linux: ['AppImage', 'deb', 'rpm'], android: ['apk'], ios: ['ipa'] };
  const seen = new Set<string>();
  for (const artifact of value.artifacts) {
    if (!artifact || !Object.hasOwn(formats, artifact.platform) || !formats[artifact.platform].includes(artifact.format)
      || !['arm64', 'x64', 'universal'].includes(artifact.arch) || (artifact.arch === 'universal' && artifact.platform !== 'android')
      || artifact.platform === 'android' && artifact.arch !== 'universal' || !Number.isSafeInteger(artifact.size) || artifact.size <= 0
      || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !isReleaseUrl(artifact.url, true)
      || !artifact.url.startsWith(`${repositoryUrl}/releases/download/v${value.version}/`)) throw new Error('failed');
    const key = `${artifact.platform}/${artifact.arch}/${artifact.format}`;
    if (seen.has(key)) throw new Error('failed'); seen.add(key);
  }
  return value;
}
export function matchingArtifacts(manifest: ReleaseManifest, app: AppInfo): Artifact[] {
  return manifest.artifacts.filter((item) => item.platform === app.platform && (item.arch === app.arch || item.platform === 'android' && item.arch === 'universal'))
    .sort((a, b) => Number(b.format === 'AppImage') - Number(a.format === 'AppImage'));
}
export const fetchTransport: Transport = async (url, signal) => {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  return { status: response.status, body: await response.text() };
};
export async function checkForUpdate(app: AppInfo, transport: Transport = fetchTransport, signal?: AbortSignal, timeout = 15000): Promise<UpdateResult> {
  const controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  const read = async (url: string): Promise<HttpResult> => {
    // 原生请求也必须受同一个取消与超时边界约束。
    return await Promise.race([transport(url, controller.signal), new Promise<never>((_, reject) => {
      if (controller.signal.aborted) reject(new Error('timeout'));
      else controller.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    })]);
  };
  try {
    const response = await read(latestReleaseUrl);
    if (response.status === 404) return { status: 'noRelease' };
    if (response.status === 403 || response.status === 429) return { status: 'rateLimited' };
    if (response.status !== 200 || response.body.length > 2_000_000) throw new Error('failed');
    const latest = JSON.parse(response.body) as { draft: boolean; prerelease: boolean; tag_name: string; html_url: string; assets: { name: string; browser_download_url: string }[] };
    const version = latest.tag_name?.replace(/^v/, '');
    if (latest.draft || latest.prerelease || !isReleaseUrl(latest.html_url) || latest.html_url !== `${repositoryUrl}/releases/tag/v${version}`) throw new Error('failed');
    const assets = latest.assets?.filter((item) => item.name === 'folio-release.json');
    if (assets?.length !== 1 || !isReleaseUrl(assets[0]!.browser_download_url, true) || !assets[0]!.browser_download_url.startsWith(`${repositoryUrl}/releases/download/v${version}/`)) throw new Error('failed');
    const manifestResponse = await read(assets[0]!.browser_download_url);
    if ([403, 429].includes(manifestResponse.status)) return { status: 'rateLimited' };
    if (manifestResponse.status !== 200 || manifestResponse.body.length > 100_000) throw new Error('failed');
    const release = validateManifest(JSON.parse(manifestResponse.body), version);
    const artifacts = matchingArtifacts(release, app);
    const newer = compareVersions(release.version, app.version) > 0;
    return { status: !artifacts.length ? 'unavailable' : newer ? 'newVersion' : 'latest', release, artifacts: newer ? artifacts : [] };
  } catch (error) {
    return { status: timedOut || error === 'timeout' || error instanceof Error && error.message === 'timeout' ? 'timeout' : 'failed' };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

// 每次操作切换一个字标，卸载后不再回调。
export class WordmarkVariation {
  private frame = 0;
  private disposed = false;
  private readonly onFrame: (index: number) => void;
  private readonly count: number;
  constructor(onFrame: (index: number) => void, count: number) {
    if (!Number.isInteger(count) || count < 1) throw new Error('字标数量必须为正整数');
    this.onFrame = onFrame; this.count = count;
  }
  activate(): void {
    if (this.disposed) return;
    this.frame = (this.frame + 1) % this.count;
    this.onFrame(this.frame);
  }
  dispose(): void { this.disposed = true; this.frame = 0; }
}
