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
  it('每次点击切换一个字标，六次后恢复原字标', () => {
    const frames: number[] = []; const egg = new WordmarkVariation((frame) => frames.push(frame), 6);
    egg.activate(); expect(frames).toEqual([1]);
    for (let i = 0; i < 6; i++) egg.activate();
    expect(frames).toEqual([1, 2, 3, 4, 5, 0, 1]); egg.dispose();
  });
  it('字标保持到下一次点击，离页后不再回调，重新进入从主字标开始', () => {
    vi.useFakeTimers(); const callback = vi.fn(); const egg = new WordmarkVariation(callback, 6);
    egg.activate(); vi.advanceTimersByTime(5000); expect(callback.mock.calls).toEqual([[1]]);
    egg.dispose(); egg.activate(); expect(callback.mock.calls).toEqual([[1]]);
    const reopened = new WordmarkVariation(callback, 6); reopened.activate();
    expect(callback.mock.calls).toEqual([[1], [1]]); reopened.dispose();
  });
  it('拒绝无效字标数量', () => {
    for (const count of [0, -1, 1.5, NaN]) expect(() => new WordmarkVariation(vi.fn(), count)).toThrow();
  });
});
