import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdate, compareVersions, isReleaseUrl, matchingArtifacts, repositoryUrl, validateManifest, WordmarkVariation, type AppInfo, type ReleaseManifest, type Transport } from '../../../shared/about/update';
const app: AppInfo = { version: '1.0.0', build: '2', platform: 'linux', arch: 'arm64' };
const manifest: ReleaseManifest = { schemaVersion: 1, version: '1.1.0', publishedAt: '2026-10-08T12:00:00Z', releaseUrl: `${repositoryUrl}/releases/tag/v1.1.0`, artifacts: [
  { platform: 'linux', arch: 'arm64', format: 'deb', size: 10, sha256: 'a'.repeat(64), url: `${repositoryUrl}/releases/download/v1.1.0/arm64.deb` },
  { platform: 'linux', arch: 'arm64', format: 'AppImage', size: 10, sha256: 'a'.repeat(64), url: `${repositoryUrl}/releases/download/v1.1.0/arm64.AppImage` },
  { platform: 'linux', arch: 'x64', format: 'AppImage', size: 10, sha256: 'a'.repeat(64), url: `${repositoryUrl}/releases/download/v1.1.0/x64.AppImage` },
] };
const latest = { draft: false, prerelease: false, tag_name: 'v1.1.0', html_url: manifest.releaseUrl, assets: [{ name: 'folio-release.json', browser_download_url: `${repositoryUrl}/releases/download/v1.1.0/folio-release.json` }] };
const transport = (data: unknown = manifest): Transport => vi.fn().mockResolvedValueOnce({ status: 200, body: JSON.stringify(latest) }).mockResolvedValueOnce({ status: 200, body: JSON.stringify(data) });
afterEach(() => vi.useRealTimers());
describe('更新协议', () => {
  it('按整数、预发行标识和构建元数据比较语义版本', () => {
    expect(compareVersions('1.10.0', '1.9.99')).toBe(1);
    expect(compareVersions('1.0.0-rc.10', '1.0.0-rc.2')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0+2', '1.0.0+3')).toBe(0);
    for (const value of ['1.0', '01.0.0', '1.0.0-01', 'NaN']) expect(() => compareVersions(value, '1.0.0')).toThrow();
  });
  it('只提供运行架构的产物，Linux 优先 AppImage', () => {
    expect(matchingArtifacts(manifest, app).map((item) => item.format)).toEqual(['AppImage', 'deb']);
    expect(matchingArtifacts(manifest, { ...app, platform: 'ios' })).toEqual([]);
  });
  it('拒绝外部仓库、重复产物、损坏校验和与不一致版本', () => {
    expect(isReleaseUrl('https://github.com.evil.test/aurysian-yan/Folio/releases/tag/v1.0.0')).toBe(false);
    expect(isReleaseUrl(`${manifest.releaseUrl}?next=evil`)).toBe(false);
    expect(() => validateManifest({ ...manifest, artifacts: [manifest.artifacts[0], manifest.artifacts[0]] })).toThrow();
    expect(() => validateManifest({ ...manifest, artifacts: [{ ...manifest.artifacts[0], sha256: 'bad' }] })).toThrow();
    expect(() => validateManifest(manifest, '1.2.0')).toThrow();
    expect(() => validateManifest({ ...manifest, publishedAt: '2026-02-31T12:00:00Z' })).toThrow();
    expect(() => validateManifest({ ...manifest, publishedAt: '2026-10-08T12:00:00.123Z' })).not.toThrow();
  });
  it('区分新版本、最新、缺少平台和无发行版', async () => {
    expect((await checkForUpdate(app, transport())).status).toBe('newVersion');
    expect((await checkForUpdate({ ...app, version: '1.2.0' }, transport())).status).toBe('latest');
    expect((await checkForUpdate({ ...app, platform: 'ios' }, transport())).status).toBe('unavailable');
    expect((await checkForUpdate(app, async () => ({ status: 404, body: '' }))).status).toBe('noRelease');
    expect((await checkForUpdate(app, transport({ bad: true }))).status).toBe('failed');
    expect((await checkForUpdate(app, async () => ({ status: 429, body: '' }))).status).toBe('rateLimited');
  });
  it('超过总时限取消请求，可再次检查', async () => {
    vi.useFakeTimers();
    const pending = checkForUpdate(app, () => new Promise(() => {}), undefined, 15);
    await vi.advanceTimersByTimeAsync(16);
    expect((await pending).status).toBe('timeout');
    expect((await checkForUpdate(app, transport())).status).toBe('newVersion');
  });
});
describe('字标变奏', () => {
  it('五次触发、播放期间忽略输入并恢复原字标', () => {
    vi.useFakeTimers(); const frames: number[] = []; const egg = new WordmarkVariation((frame) => frames.push(frame), () => false);
    for (let i = 0; i < 4; i++) egg.activate(i * 100); expect(frames).toEqual([]);
    egg.activate(500); egg.activate(600); egg.play(); vi.advanceTimersByTime(2000);
    expect(frames).toEqual([1, 2, 3, 0]); egg.dispose();
  });
  it('过期计数失效，离页立即清除回调', () => {
    vi.useFakeTimers(); const callback = vi.fn(); const egg = new WordmarkVariation(callback, () => false);
    egg.activate(0); for (let i = 0; i < 4; i++) egg.activate(4000 + i); expect(callback).not.toHaveBeenCalled();
    egg.activate(4010); egg.dispose(); vi.advanceTimersByTime(5000); expect(callback.mock.calls).toEqual([[1]]);
  });
  it('减少动态效果只展示一次替代字形', () => {
    vi.useFakeTimers(); const callback = vi.fn(); const egg = new WordmarkVariation(callback, () => true);
    egg.play(); vi.advanceTimersByTime(2000); expect(callback.mock.calls).toEqual([[1], [0]]); egg.dispose();
  });
});
