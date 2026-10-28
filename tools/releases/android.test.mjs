import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { androidBuildInfo, androidOutputs } from './android.mjs';
import { stage, verifyVersions } from './release.mjs';
const version = verifyVersions();

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'folio-android-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const metadata = {};
  for (const variant of ['legacy', 'glasmio']) {
    const directory = join(root, variant, 'release'); mkdirSync(directory, { recursive: true });
    metadata[variant] = { artifactType: { type: 'APK' }, applicationId: 'com.folio.mobile.poc', variantName: `${variant}Release`,
      elements: ['arm64-v8a', 'x86_64'].map((abi) => ({ filters: [{ filterType: 'ABI', value: abi }],
        versionCode: variant === 'legacy' ? 101 : 102, versionName: version,
        outputFile: `app-${variant}-${abi}-release${variant === 'legacy' ? '-unsigned' : ''}.apk` })) };
  }
  const save = () => { for (const [variant, data] of Object.entries(metadata)) writeFileSync(join(root, variant, 'release/output-metadata.json'), JSON.stringify(data)); };
  save(); return { root, metadata, save };
}
test('按 Gradle 变体与 ABI 收集四包，不依赖旧目录或签名后缀', (t) => {
  const { root } = fixture(t);
  assert.deepEqual(androidOutputs(root, version, 10).map(({ variant, arch, file }) => [variant, arch, file.endsWith('-unsigned.apk')]),
    [['legacy', 'arm64', true], ['legacy', 'x64', true], ['glasmio', 'arm64', false], ['glasmio', 'x64', false]]);
  const output = join(root, 'staged');
  for (const { variant, arch } of androidOutputs(root, version, 10)) {
    const input = join(root, `${variant}-${arch}`); mkdirSync(input);
    writeFileSync(join(input, 'app.apk'), `PK${variant}-${arch}`);
    stage('android', arch, input, output, variant);
  }
  assert.deepEqual(readdirSync(output).sort(), [
    `Folio-v${version}-android-arm64.apk`, `Folio-v${version}-android-glasmio-arm64.apk`,
    `Folio-v${version}-android-glasmio-x64.apk`, `Folio-v${version}-android-x64.apk`,
  ].sort());
  for (const value of [undefined, '', 0, -1, 1.5, 210000000]) assert.throws(() => androidBuildInfo('legacy', value));
});
test('漏包、重复 ABI、错误应用、版本、构建号及目录越界均停止归档', (t) => {
  for (const change of [
    (data) => data.elements.pop(),
    (data) => data.elements[1].filters = data.elements[0].filters,
    (data) => data.applicationId = 'com.folio.mobile.poc.dev',
    (data) => data.variantName = 'legacyDebug',
    (data) => data.elements[0].versionName = '0.0.0',
    (data) => data.elements[0].versionCode = 10,
    (data) => data.elements[0].outputFile = '../wrong.apk',
  ]) {
    const { root, metadata, save } = fixture(t); change(metadata.legacy); save();
    assert.throws(() => androidOutputs(root, version, 10));
  }
});
test('APK 验收检查实际包内 ABI、类型、最低 API、构建号和签名', (t) => {
  const { root } = fixture(t);
  const sdk = join(root, 'sdk/build-tools/36.0.0'); mkdirSync(sdk, { recursive: true });
  const input = join(root, 'input'); mkdirSync(input);
  const apk = join(input, 'app.apk');
  const catalogPath = join(root, 'catalog.json');
  writeFileSync(catalogPath, readFileSync('shared/about/licenses.json'));
  execFileSync('python3', ['-c', "import zipfile,sys,json\nc=json.load(open(sys.argv[2]))\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n z.writestr('lib/arm64-v8a/libfolio_ffi.so',b'fixture')\n z.writestr('assets/index.android.bundle',' '.join([e['id'] for e in c['entries']]+list(c['texts'])))", apk, catalogPath]);
  const badging = join(root, 'badging'); const xml = join(root, 'xml');
  writeFileSync(join(sdk, 'aapt2'), `#!/usr/bin/env node\nconst fs=require('fs');process.stdout.write(fs.readFileSync(process.argv[3]==='badging'?${JSON.stringify(badging)}:${JSON.stringify(xml)},'utf8'));\n`, { mode: 0o755 });
  writeFileSync(join(sdk, 'apksigner'), '#!/usr/bin/env node\nprocess.exit(Number(process.env.TEST_SIGNATURE_STATUS??0));\n', { mode: 0o755 });
  const run = (extra = {}) => spawnSync(process.execPath, ['tools/releases/check-native.mjs', 'android', input, 'arm64', 'legacy'],
    { encoding: 'utf8', env: { ...process.env, ANDROID_HOME: join(root, 'sdk'), FOLIO_BUILD_NUMBER: '10', FOLIO_BUILD_ONLY: '1', ...extra } });
  const identity = `package: name='com.folio.mobile.poc' versionCode='101' versionName='${version}'\nsdkVersion:'30'\n`;
  const manifest = 'E: meta-data\n  A: android:name(0x01010003)="com.folio.android.GLASS_TIER" (Raw: "com.folio.android.GLASS_TIER")\n  A: android:value(0x01010024)="legacy" (Raw: "legacy")\n';
  writeFileSync(badging, identity); writeFileSync(xml, manifest);
  assert.equal(run().status, 0, run().stderr);
  writeFileSync(badging, identity.replace('sdkVersion:', 'minSdkVersion:'));
  writeFileSync(xml, manifest.replaceAll('android:', 'http://schemas.android.com/apk/res/android:'));
  assert.equal(run().status, 0, run().stderr);
  writeFileSync(xml, manifest);
  for (const replacement of [identity.replace("'101'", "'10'"), identity.replace("'30'", "'33'")]) {
    writeFileSync(badging, replacement); assert.notEqual(run().status, 0);
  }
  writeFileSync(badging, identity); writeFileSync(xml, manifest.replaceAll('legacy', 'glasmio'));
  assert.notEqual(run().status, 0); writeFileSync(xml, manifest);
  const unsigned = run({ FOLIO_BUILD_ONLY: '0', TEST_SIGNATURE_STATUS: '1' });
  assert.notEqual(unsigned.status, 0); assert.match(unsigned.stderr, /APK 签名验证失败/);
});
