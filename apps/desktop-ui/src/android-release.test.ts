import { describe, expect, it } from 'vitest';
import { androidCompatibilityStatus, androidUpdateResult, matchingAndroidArtifacts, requiredAndroidVariant, validateAndroidManifest, type AndroidArtifact, type ReleaseManifestV2 } from '../../../shared/about/android-release';
import type { AppInfo } from '../../../shared/about/update';
import { checkMobileUpdate, latestAndroidManifestUrl, MirrorSpeedSession } from '../../../experiments/mobile/src/update';

const version = '1.2.2';
const baseUrl = `https://github.com/aurysian-yan/Folio/releases/download/v${version}`;
const app: AppInfo = { version, build: '101', platform: 'android', arch: 'arm64', sdkInt: 33, androidVariant: 'legacy' };
const artifacts: AndroidArtifact[] = (['arm64', 'x64'] as const).flatMap((arch) => (['legacy', 'glasmio'] as const).map((androidVariant) => ({
  platform: 'android', arch, format: 'apk', androidVariant, minSdk: androidVariant === 'legacy' ? 30 : 33,
  ...(androidVariant === 'legacy' ? { maxSdk: 32 } : {}), versionCode: androidVariant === 'legacy' ? 101 : 102,
  size: 123, sha256: 'a'.repeat(64), url: `${baseUrl}/Folio-v${version}-android${androidVariant === 'glasmio' ? '-glasmio' : ''}-${arch}.apk`,
})));
const manifest: ReleaseManifestV2 = { schemaVersion: 2, version, publishedAt: '2026-10-27T01:00:00Z', releaseUrl: `https://github.com/aurysian-yan/Folio/releases/tag/v${version}`, artifacts };

describe('Android 双包清单', () => {
  it.each([30, 31, 32, 33, 36, 37])('按 API %i 和架构选择唯一安装包', (sdkInt) => {
    const validated = validateAndroidManifest(manifest);
    const tier = sdkInt >= 33 ? 'glasmio' : 'legacy';
    expect(requiredAndroidVariant(sdkInt)).toBe(tier);
    for (const arch of ['arm64', 'x64'] as const) {
      expect(matchingAndroidArtifacts(validated, { ...app, sdkInt, arch }).map((item) => [item.androidVariant, item.arch])).toEqual([[tier, arch]]);
    }
  });
  it('只允许同版本向高版本包迁移，不把同构建识别为新版', () => {
    expect(androidUpdateResult(manifest, app).status).toBe('variantRequired');
    expect(androidUpdateResult(manifest, { ...app, build: '102', androidVariant: 'glasmio' }).status).toBe('latest');
    expect(androidUpdateResult(manifest, { ...app, sdkInt: 32 }).status).toBe('latest');
    expect(androidUpdateResult(manifest, { ...app, build: '102' }).status).toBe('unavailable');
    expect(androidUpdateResult(manifest, { ...app, version: '1.3.0' }).status).toBe('unavailable');
    expect(androidUpdateResult(manifest, { ...app, version: '1.2.1', build: '92', androidVariant: 'glasmio' }).status).toBe('newVersion');
  });
  it('缺少目标架构或系统类型时不选择其他包', () => {
    expect(androidUpdateResult({ ...manifest, artifacts: artifacts.filter((item) => item.arch === 'x64') }, app).status).toBe('unavailable');
    expect(androidUpdateResult({ ...manifest, artifacts: artifacts.filter((item) => item.androidVariant === 'legacy') }, app).status).toBe('unavailable');
  });
  it('拒绝重复产物、错误范围、构建号、文件名和来源', () => {
    expect(() => validateAndroidManifest({ ...manifest, artifacts: [...artifacts, artifacts[0]] })).toThrow();
    for (const patch of [{ minSdk: 28 }, { maxSdk: 33 }, { versionCode: 102 }, { versionCode: -1 }, { versionCode: 2_100_000_001 },
      { sha256: 'invalid' }, { androidVariant: 'unknown' }, { url: `${baseUrl}/other.apk` }, { url: 'https://example.com/app.apk' }]) {
      expect(() => validateAndroidManifest({ ...manifest, artifacts: [{ ...artifacts[0], ...patch }] })).toThrow();
    }
    expect(() => validateAndroidManifest({ ...manifest, artifacts: artifacts.map((item) => item.arch === 'x64' ? { ...item, versionCode: item.versionCode + 10 } : item) })).toThrow();
  });
  it('未知构建信息不能绕过兼容检查，开发包可由原生明确豁免', () => {
    expect(androidCompatibilityStatus(app)).toBe('required');
    expect(androidCompatibilityStatus({ ...app, requiresVariantUpdate: false })).toBe('ready');
    expect(androidCompatibilityStatus({ ...app, sdkInt: 32 })).toBe('ready');
    expect(() => androidCompatibilityStatus({ ...app, androidVariant: undefined })).toThrow();
    expect(() => androidCompatibilityStatus({ ...app, sdkInt: undefined })).toThrow();
    expect(() => androidCompatibilityStatus({ ...app, sdkInt: 32, androidVariant: 'glasmio' })).toThrow();
  });
});

describe('Android 迁移检查', () => {
  it('优先读取当前版本，支持同版本覆盖迁移', async () => {
    const calls: string[] = [];
    const result = await checkMobileUpdate(app, 'direct', undefined, async (url) => { calls.push(url); return { status: 200, body: JSON.stringify(manifest) }; });
    expect(calls).toEqual([`${baseUrl}/folio-release-v2.json`]);
    expect(result.status).toBe('variantRequired');
    expect(result.artifacts).toEqual([artifacts[1]]);
  });
  it('当前版本附件缺失时查询最新版本，不回退到旧格式包', async () => {
    const calls: string[] = [];
    const result = await checkMobileUpdate(app, 'direct', undefined, async (url) => {
      calls.push(url); return { status: url === latestAndroidManifestUrl ? 200 : 404, body: JSON.stringify(manifest) };
    });
    expect(result.status).toBe('variantRequired');
    expect(calls).toEqual([`${baseUrl}/folio-release-v2.json`, latestAndroidManifestUrl]);
    const missing = await checkMobileUpdate(app, 'direct', undefined, async () => ({ status: 404, body: '' }));
    expect(missing.status).toBe('noRelease');
    expect(missing.artifacts).toBeUndefined();
  });
  it('高版本包正常更新也按系统读取 v2，不接受旧清单替代', async () => {
    const calls: string[] = [];
    const result = await checkMobileUpdate({ ...app, androidVariant: 'glasmio', build: '92', version: '1.2.1' }, 'direct', undefined,
      async (url) => { calls.push(url); return { status: 200, body: JSON.stringify(manifest) }; });
    expect(result.status).toBe('newVersion');
    expect(calls).toEqual([latestAndroidManifestUrl]);
  });
  it('v2 菜单测速校验同一份双包清单', async () => {
    const calls: string[] = [];
    const result: string[] = [];
    const session = new MirrorSpeedSession(async (url) => { calls.push(url); return { status: 200, body: JSON.stringify(manifest) }; });
    await session.open(version, (_, speed) => result.push(speed.status), true);
    expect(calls.every((url) => url.endsWith(`/v${version}/folio-release-v2.json`))).toBe(true);
    expect(result.filter((item) => item === 'success')).toHaveLength(6);
    session.close();
  });
});
