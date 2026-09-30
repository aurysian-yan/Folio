import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv[2];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (process.platform !== 'darwin') fail('此 IDE 启动脚本仅适用于 macOS。');

if (platform === 'ios') {
  const workspace = resolve(project, 'ios/Folio.xcworkspace');
  if (!existsSync(workspace)) fail('请先生成 iOS 工程并执行 pnpm pods。');
  execFileSync('open', ['-a', 'Xcode', workspace], { stdio: 'inherit' });
} else if (platform === 'android') {
  const application = process.env.ANDROID_STUDIO_APP ?? '/Applications/Android Studio.app';
  const android = resolve(project, 'android');
  if (!existsSync(application)) fail('未找到 Android Studio；可通过 ANDROID_STUDIO_APP 指定应用路径。');
  if (!existsSync(resolve(android, 'gradlew'))) fail('请先生成 Android 工程。');

  let running = false;
  try {
    execFileSync('pgrep', ['-x', 'studio'], { stdio: 'ignore' });
    running = true;
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  if (running) fail('请先用 ⌘Q 退出 Android Studio，再执行 pnpm ide:android，以加载 Node 环境。');

  // IDE 和 Gradle 新进程使用启动此脚本的 Node，避免依赖 Dock 的 PATH。
  const nodePath = dirname(process.execPath);
  const environment = {
    ...process.env,
    PATH: [nodePath, process.env.PATH].filter(Boolean).join(':'),
    NODE_BINARY: process.execPath,
  };
  execFileSync('./gradlew', ['--stop'], { cwd: android, env: environment, stdio: 'inherit' });
  execFileSync('open', [
    '-a', application,
    '--env', `PATH=${environment.PATH}`,
    '--env', `NODE_BINARY=${environment.NODE_BINARY}`,
    '--args', android,
  ], { env: environment, stdio: 'inherit' });
} else {
  fail('请选择 android 或 ios。');
}
