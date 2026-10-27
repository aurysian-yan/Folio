import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const project = resolve(import.meta.dirname, '..');
const sdk = process.env.ANDROID_HOME ?? join(process.env.HOME, 'Library/Android/sdk');
const adb = join(sdk, 'platform-tools/adb');
const serial = process.env.ANDROID_SERIAL;
if (!serial) throw new Error('请显式设置 ANDROID_SERIAL 为临时测试模拟器');
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', ...options });
if (run(adb, ['-s', serial, 'emu', 'avd', 'name']).split('\n')[0].trim() !== 'FolioUpdateTest') throw new Error('更新安全测试只能使用 FolioUpdateTest 临时模拟器');
const work = mkdtempSync(join(tmpdir(), 'folio-update-apks-'));
const assets = join(project, '.build/update-test-assets/updates');
mkdirSync(assets, { recursive: true });
try {
  for (const name of ['key', 'other']) run('keytool', ['-genkeypair', '-keystore', join(work, name + '.jks'), '-storepass', 'android', '-keypass', 'android', '-alias', 'test', '-dname', 'CN=Folio Update Test', '-keyalg', 'RSA', '-validity', '2'], { stdio: 'ignore' });
  const fixtures = [
    ['base', 'com.folio.mobile.poc', '0.1.0', 1, 'key'], ['good', 'com.folio.mobile.poc', '9.9.9', 999, 'key'],
    ['wrong-signature', 'com.folio.mobile.poc', '9.9.9', 999, 'other'], ['old-build', 'com.folio.mobile.poc', '9.9.9', 1, 'key'],
    ['wrong-package', 'com.folio.update.fixture', '9.9.9', 999, 'key'], ['wrong-version', 'com.folio.mobile.poc', '9.9.8', 999, 'key'],
  ];
  for (const [name, identity, version, code, key] of fixtures) {
    const folder = join(work, name); mkdirSync(folder);
    const manifest = join(folder, 'AndroidManifest.xml');
    writeFileSync(manifest, `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${identity}" android:versionCode="${code}" android:versionName="${version}"><uses-sdk android:minSdkVersion="28" android:targetSdkVersion="36"/><application android:label="Folio Update Test" android:hasCode="false" /></manifest>`);
    const unsigned = join(folder, 'unsigned.apk'); const signed = join(folder, name + '.apk');
    run(join(sdk, 'build-tools/36.0.0/aapt2'), ['link', '-I', join(sdk, 'platforms/android-36/android.jar'), '--manifest', manifest, '-o', unsigned]);
    run(join(sdk, 'build-tools/36.0.0/apksigner'), ['sign', '--ks', join(work, key + '.jks'), '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', signed, unsigned]);
    if (name === 'base') run(adb, ['-s', serial, 'install', signed], { stdio: 'inherit' });
    else copyFileSync(signed, join(assets, name + '.apk'));
  }
  run(join(project, 'android/gradlew'), [':folio-native:assembleDebugAndroidTest', '-PfolioUpdateTest=true', '--no-daemon', '--console=plain'], { cwd: join(project, 'android'), stdio: 'inherit' });
  const apk = join(project, 'modules/folio-native/android/build/outputs/apk/androidTest/debug/folio-native-debug-androidTest.apk');
  run(adb, ['-s', serial, 'install', '-r', apk], { stdio: 'inherit' });
  const result = run(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', 'com.folio.poc.test/com.folio.poc.FolioUpdateInstrumentation']);
  process.stdout.write(result);
  if (!result.includes('OK:') || result.includes('FAILED:')) throw new Error('更新安全测试失败');
} finally {
  run(adb, ['-s', serial, 'uninstall', 'com.folio.mobile.poc'], { stdio: 'ignore' });
  rmSync(work, { recursive: true, force: true });
  rmSync(join(project, '.build/update-test-assets'), { recursive: true, force: true });
}
