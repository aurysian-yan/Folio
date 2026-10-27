import { describe, expect, it } from 'vitest';
import { checkMobileUpdate, fastestMirror, latestManifestUrl, mirrorReleaseUrl, MirrorSpeedSession, normalizeMirror, releaseMirrors, utf8Size, type ManifestReader } from '../../../experiments/mobile/src/update';
import { noteBlocks, noteSpans } from '../../../experiments/mobile/src/update-markdown';
import { matchingArtifacts, validateManifest, type AppInfo, type ReleaseManifest } from '../../../shared/about/update';

const app: AppInfo = { version: '1.0.0', build: '1', platform: 'android', arch: 'arm64' };
const manifest: ReleaseManifest = { schemaVersion: 1, version: '1.2.2', publishedAt: '2026-10-27T01:00:00Z', releaseUrl: 'https://github.com/aurysian-yan/Folio/releases/tag/v1.2.2',
  releaseNotes: { 'zh-CN': '### 修复\n\n- 修复预览', en: '### Fixes\n\n- Fix previews' }, artifacts: [{ platform: 'android', arch: 'arm64', format: 'apk', size: 123, sha256: 'a'.repeat(64), url: 'https://github.com/aurysian-yan/Folio/releases/download/v1.2.2/Folio-v1.2.2-android-arm64.apk' }] };
const reader: ManifestReader = async () => ({ status: 200, body: JSON.stringify(manifest) });

describe('移动更新清单与镜像', () => {
  it('直接读取所选镜像的清单，不访问 GitHub API，保持原始附件来源', async () => {
    const calls: string[] = [];
    const result = await checkMobileUpdate(app, 'ghfast', undefined, async (url, signal) => { calls.push(url); return reader(url, signal); });
    expect(calls).toEqual(['https://ghfast.top/github.com/aurysian-yan/Folio/releases/latest/download/folio-release.json']);
    expect(result.status).toBe('newVersion');
    expect(result.artifacts?.[0]?.url).toBe(manifest.artifacts[0]!.url);
    expect(result.release?.releaseNotes).toEqual(manifest.releaseNotes);
  });
  it('只选择设备运行架构的 Android APK', () => {
    const x64 = { ...manifest.artifacts[0]!, arch: 'x64' as const, url: 'https://github.com/aurysian-yan/Folio/releases/download/v1.2.2/Folio-v1.2.2-android-x64.apk' };
    const both = { ...manifest, artifacts: [manifest.artifacts[0]!, x64] };
    expect(matchingArtifacts(both, app).map((item) => item.arch)).toEqual(['arm64']);
    expect(matchingArtifacts(both, { ...app, arch: 'x64' }).map((item) => item.arch)).toEqual(['x64']);
    expect(matchingArtifacts(manifest, { ...app, arch: 'x64' })).toEqual([]);
  });
  it('拒绝外仓、任意外链、未知镜像和损坏的双语日志', () => {
    expect(() => mirrorReleaseUrl('https://github.com/other/repo/releases/download/v1/a.apk', 'direct')).toThrow();
    expect(() => mirrorReleaseUrl('https://example.com/a.apk', 'ghfast')).toThrow();
    expect(() => mirrorReleaseUrl(latestManifestUrl, 'invalid' as never)).toThrow();
    expect(normalizeMirror('invalid')).toBe('direct');
    expect(() => validateManifest({ ...manifest, releaseNotes: { en: '' } })).toThrow();
    expect(() => validateManifest({ ...manifest, releaseNotes: null })).toThrow();
  });
  it('兼容旧清单，同版本仍返回大小，iOS 无包仍展示新版', async () => {
    const old = { ...manifest }; delete old.releaseNotes;
    expect(validateManifest(old).releaseNotes).toBeUndefined();
    const latest = await checkMobileUpdate({ ...app, version: '1.2.2' }, 'direct', undefined, reader);
    expect(latest.status).toBe('latest');
    expect(latest.artifacts?.[0]?.size).toBe(123);
    const ios = await checkMobileUpdate({ ...app, platform: 'ios', arch: 'arm64' }, 'direct', undefined, reader);
    expect(ios.status).toBe('newVersion');
    expect(ios.artifacts).toEqual([]);
    expect(ios.release?.version).toBe('1.2.2');
  });
  it('区分错误状态并拒绝 HTTP 200 错误页与超长 UTF-8 清单', async () => {
    for (const [status, expected] of [[404, 'noRelease'], [403, 'rateLimited'], [429, 'rateLimited'], [500, 'failed']] as const) {
      expect((await checkMobileUpdate(app, 'direct', undefined, async () => ({ status, body: '' }))).status).toBe(expected);
    }
    for (const body of ['<html>error</html>', '中'.repeat(34_000), JSON.stringify({ ...manifest, version: '0.1' })]) {
      expect((await checkMobileUpdate(app, 'direct', undefined, async () => ({ status: 200, body }))).status).toBe('failed');
    }
    expect(utf8Size('Folio 中文😀')).toBe(16);
  });
  it('取消不响应中止信号的请求也会结束等待', async () => {
    const controller = new AbortController();
    const pending = checkMobileUpdate(app, 'direct', controller.signal, () => new Promise(() => {}));
    controller.abort();
    expect((await pending).status).toBe('failed');
  });
});
describe('菜单测速生命周期', () => {
  it('并发完整读取同一版本，逐项回传，不改变手动选择', async () => {
    const calls: string[] = []; const results: Record<string, unknown>[] = [];
    const session = new MirrorSpeedSession(async (url, signal) => { calls.push(url); return reader(url, signal); });
    await session.open(manifest.version, (id, result) => results.push({ id, ...result }));
    expect(calls).toHaveLength(releaseMirrors.length);
    expect(calls.every((url) => url.includes('/releases/download/v1.2.2/folio-release.json'))).toBe(true);
    expect(results.filter((item) => item.status === 'testing')).toHaveLength(releaseMirrors.length);
    expect(results.filter((item) => item.status === 'success')).toHaveLength(releaseMirrors.length);
    expect(fastestMirror({ direct: { status: 'success', milliseconds: 45 }, ghfast: { status: 'success', milliseconds: 12 }, ghproxy: { status: 'unavailable' } })).toBe('ghfast');
  });
  it('关闭与快速重开后旧回调失效', async () => {
    const pending: (() => void)[] = [];
    const session = new MirrorSpeedSession(() => new Promise((resolve) => pending.push(() => resolve({ status: 200, body: JSON.stringify(manifest) }))));
    const old: string[] = []; const next: string[] = [];
    const first = session.open(undefined, (_, result) => old.push(result.status));
    session.close();
    const second = session.open(undefined, (_, result) => next.push(result.status));
    pending.forEach((done) => done());
    await Promise.all([first, second]);
    expect(old).toEqual(releaseMirrors.map(() => 'testing'));
    expect(next.filter((value) => value === 'success')).toHaveLength(releaseMirrors.length);
    session.close();
  });
  it('超时、错误页、错误版本不作为可用线路', async () => {
    const session = new MirrorSpeedSession(() => new Promise(() => {}), 5);
    const results: string[] = [];
    await session.open(undefined, (_, result) => results.push(result.status));
    expect(results.filter((value) => value === 'unavailable')).toHaveLength(releaseMirrors.length);
    const invalid = new MirrorSpeedSession(reader);
    const mismatch: string[] = [];
    await invalid.open('1.0.0', (_, result) => mismatch.push(result.status));
    expect(mismatch.filter((value) => value === 'success')).toHaveLength(0);
  });
});
it('日志渲染仅保留原生文本和有效 HTTPS 链接', () => {
  expect(noteBlocks('### 修复\n\n- 修复预览\n- 支持字体\n\n说明\n下一行').map((item) => item.kind)).toEqual(['heading', 'list', 'list', 'paragraph']);
  const spans = noteSpans('**说明** [Release](https://github.com/aurysian-yan/Folio/releases) ![image](https://example.com/a.png) [unsafe](javascript:alert) https://user:password@example.com');
  expect(spans.filter((item) => item.url).map((item) => item.url)).toEqual(['https://github.com/aurysian-yan/Folio/releases']);
  expect(spans.map((item) => item.text).join('')).not.toContain('a.png');
});
