// Android 模拟器发现、已有 AVD 列表与后台启动。
import { spawn, spawnSync } from 'node:child_process';
import {
  accessSync, closeSync, constants, existsSync, mkdtempSync, openSync,
  readFileSync, realpathSync, statSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, win32 } from 'node:path';

function executable(file, platform) {
  try {
    accessSync(file, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function findAndroidTools({
  env = process.env, platform = process.platform, home = homedir(), mobileDir,
} = {}) {
  const paths = platform === 'win32' ? win32 : { join, dirname, resolve };
  const suffix = platform === 'win32' ? '.exe' : '';
  let projectSdk;
  const properties = mobileDir && join(mobileDir, 'android/local.properties');
  if (properties && existsSync(properties)) {
    const value = readFileSync(properties, 'utf8').match(/^\s*sdk\.dir\s*[=:]\s*(.+?)\s*$/m)?.[1];
    // local.properties 使用 Java properties 的转义规则。
    if (value) projectSdk = paths.resolve(mobileDir, 'android', value.replace(/\\u([\da-f]{4})|\\(.)/gi,
      (_, hex, character) => hex ? String.fromCharCode(parseInt(hex, 16)) : character));
  }
  const defaults = platform === 'darwin' ? [paths.join(home, 'Library/Android/sdk')]
    : platform === 'win32' ? [paths.join(env.LOCALAPPDATA || paths.join(home, 'AppData/Local'), 'Android/Sdk')]
      : [paths.join(home, 'Android/Sdk'), paths.join(home, 'Android/sdk')];
  const roots = [...new Set([env.ANDROID_HOME, env.ANDROID_SDK_ROOT, projectSdk, ...defaults].filter(Boolean))];
  const pathEntries = (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  let emulator = roots.map((root) => paths.join(root, 'emulator', `emulator${suffix}`))
    .find((file) => executable(file, platform));
  if (!emulator) emulator = pathEntries.map((entry) => paths.join(entry, `emulator${suffix}`))
    .find((file) => executable(file, platform));
  if (!emulator) {
    throw new Error('未找到 Android Emulator。请在 Android Studio 的 SDK Manager 中安装 Android Emulator，并设置 ANDROID_HOME 或将 emulator 加入 PATH。');
  }
  emulator = realpathSync(emulator);
  const sdk = paths.dirname(paths.dirname(emulator));
  const adb = [paths.join(sdk, 'platform-tools', `adb${suffix}`),
    ...pathEntries.map((entry) => paths.join(entry, `adb${suffix}`))]
    .find((file) => executable(file, platform));
  return { emulator, adb, env: { ...env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk } };
}

export function listAndroidAvds(tools) {
  const result = spawnSync(tools.emulator, ['-list-avds'], {
    env: tools.env, encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`无法读取 Android 模拟器列表：${result.error?.message || result.stderr?.trim() || `退出码 ${result.status}`}。`);
  }
  const avds = [...new Set(result.stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean))];
  if (!avds.length) throw new Error('未找到已有的 AVD。请先在 Android Studio 的 Device Manager 中创建 Android 虚拟设备。');
  return avds;
}

function runningAvd(tools, name) {
  if (!tools.adb) return null;
  const read = (args) => spawnSync(tools.adb, args, {
    env: tools.env, encoding: 'utf8', timeout: 3000, windowsHide: true,
  });
  const devices = read(['devices']);
  if (devices.error || devices.status !== 0) return null;
  for (const line of devices.stdout.split(/\r?\n/)) {
    const serial = line.match(/^(emulator-\d+)\s+device\b/)?.[1];
    if (!serial) continue;
    const result = read(['-s', serial, 'emu', 'avd', 'name']);
    if (!result.error && result.status === 0 && result.stdout.split(/\r?\n/)[0].trim() === name) return serial;
  }
  return null;
}

export async function startAndroidAvd(tools, name) {
  if (!listAndroidAvds(tools).includes(name)) throw new Error(`未找到 AVD「${name}」，请先列出已有的模拟器。`);
  const serial = runningAvd(tools, name);
  if (serial) return { alreadyRunning: true, serial };

  const logFile = join(mkdtempSync(join(tmpdir(), 'folio-emulator-')), 'emulator.log');
  const output = openSync(logFile, 'a', 0o600);
  try {
    // 独立进程保留窗口；短暂观察启动结果，及时报告缺少镜像等错误。
    const child = spawn(tools.emulator, ['-avd', name], {
      env: tools.env, detached: true, stdio: ['ignore', output, output], windowsHide: false,
    });
    await new Promise((resolveStart, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        child.off('error', onError);
        child.off('exit', onExit);
      };
      const onError = (error) => {
        cleanup();
        reject(new Error(`无法启动 Android 模拟器：${error.message}。日志：${logFile}`));
      };
      const onExit = (code, signal) => {
        cleanup();
        reject(new Error(`Android 模拟器启动后退出（${signal || `退出码 ${code}`}）。请检查系统镜像与硬件加速。日志：${logFile}`));
      };
      child.once('error', onError);
      child.once('exit', onExit);
      child.once('spawn', () => {
        timer = setTimeout(() => {
          cleanup();
          child.unref();
          resolveStart();
        }, 2000);
      });
    });
    return { alreadyRunning: false, pid: child.pid, logFile };
  } finally {
    closeSync(output);
  }
}
