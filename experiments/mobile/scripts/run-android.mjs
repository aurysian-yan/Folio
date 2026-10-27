import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const project = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const release = args.includes('--release');
if (release) args.splice(args.indexOf('--release'), 1);
const environment = { ...process.env, APP_VARIANT: release ? 'production' : 'development' };
const studioJava = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
const javaHomes = [environment.JAVA_HOME, studioJava].filter(Boolean);
const javaHome = javaHomes.find((home) => {
  if (!existsSync(join(home, 'bin/java'))) return false;
  const result = spawnSync(join(home, 'bin/java'), ['-version'], { encoding: 'utf8' });
  return /version "21[.\"]/.test(result.stderr);
});
if (!javaHome) throw new Error('Android 构建需要 JDK 21，请设置 JAVA_HOME');
environment.JAVA_HOME = javaHome;
const sdk = environment.ANDROID_HOME ?? environment.ANDROID_SDK_ROOT ?? join(environment.HOME, 'Library/Android/sdk');
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const read = (values) => execFileSync(adb, values, { encoding: 'utf8', env: environment }).trim();
const devices = read(['devices']).split('\n').slice(1).filter((line) => /\tdevice$/.test(line)).map((line) => line.split('\t')[0]);
const deviceIndex = args.indexOf('--device');
const serial = deviceIndex >= 0 ? args[deviceIndex + 1] : environment.ANDROID_SERIAL ?? (devices.length === 1 ? devices[0] : undefined);
if (!serial || !devices.includes(serial)) throw new Error('请启动模拟器，或通过 --device 指定已连接设备的序列号');
const sdkInt = Number(read(['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk']));
if (!Number.isInteger(sdkInt) || sdkInt < 30) throw new Error('Folio 需要 Android 11 或更新版本');
const tier = sdkInt >= 33 ? 'glasmio' : 'legacy';
const variantIndex = args.indexOf('--variant');
if (variantIndex < 0) args.push('--variant', tier + (release ? 'Release' : 'Debug'));
else if (['debug', 'release'].includes(args[variantIndex + 1])) args[variantIndex + 1] = tier + args[variantIndex + 1][0].toUpperCase() + args[variantIndex + 1].slice(1);
if (deviceIndex < 0) args.push('--device', serial);
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
for (const command of [[process.execPath, ['scripts/prebuild-variant.mjs', 'android']], [pnpm, ['exec', 'expo', 'run:android', ...args]]]) {
  const result = spawnSync(command[0], command[1], { cwd: project, env: environment, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
