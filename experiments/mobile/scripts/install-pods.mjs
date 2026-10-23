import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ios = resolve(project, 'ios');
const reactCore = resolve(ios, 'Pods/React-Core-prebuilt');
const reactCoreEntries = [
  'Info.plist',
  'Headers',
  'Modules',
  'ios-arm64',
  'ios-arm64_x86_64-simulator',
];

// React Native 切换 Debug/Release 时会用 tarball 重建预编译核心；仓库位于外置卷时
// 跨卷移动可能因构建中断留下缺少 Info.plist 或切片的目录，导致后续 pod install 失败。
function repairReactCore() {
  if (!existsSync(reactCore)) return;
  const framework = resolve(reactCore, 'React.xcframework');
  if (reactCoreEntries.every((entry) => existsSync(resolve(framework, entry)))) return;
  rmSync(reactCore, { recursive: true, force: true });
  process.stdout.write('检测到 React Native 预编译核心不完整，重新安装。\n');
}

repairReactCore();
execFileSync('pod', ['install'], {
  cwd: ios, stdio: 'inherit',
  env: { ...process.env, RUBYOPT: [process.env.RUBYOPT, '-r../scripts/cocoapods-utf8.rb'].filter(Boolean).join(' ') },
});

// 安装后确认预编译核心与 ZIPFoundation 头文件完整，避免把半成品状态带入 Xcode 构建。
const reactFramework = resolve(reactCore, 'React.xcframework');
if (!reactCoreEntries.every((entry) => existsSync(resolve(reactFramework, entry)))) {
  throw new Error('React Native 预编译核心仍不完整，请清理 ios/Pods 后重试');
}
const zipFoundationModuleMap = resolve(ios, 'Pods/Headers/Public/ZIPFoundation/ZIPFoundation.modulemap');
if (!existsSync(zipFoundationModuleMap)) {
  throw new Error('ZIPFoundation 头文件未生成，请检查 pod install 输出后重试');
}

// Expo Constants 的预编译脚本需按完整路径执行，避免空格被二次 shell 拆分。
const podsProject = resolve(ios, 'Pods/Pods.xcodeproj/project.pbxproj');
const contents = readFileSync(podsProject, 'utf8');
const unsafe = JSON.stringify('bash -l -c "$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh"');
const safe = JSON.stringify('bash "$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh"');
const patched = contents.replaceAll(unsafe, safe);
if (patched !== contents) writeFileSync(podsProject, patched);

// React Native 打包入口同样按完整路径调用。工程名随变体为 FolioDev 或 Folio。
const applicationProject = ['FolioDev', 'Folio']
  .map((name) => resolve(project, `ios/${name}.xcodeproj/project.pbxproj`))
  .find((file) => existsSync(file));
if (!applicationProject) throw new Error('未找到 iOS 应用工程，请先执行 prebuild');
const applicationContents = readFileSync(applicationProject, 'utf8');
const quotedBundleScript = applicationContents.replace(
  /`([^`\n]*react-native-xcode\.sh[^`\n]*)`/g, '\\"$($1)\\"',
);
if (quotedBundleScript !== applicationContents) writeFileSync(applicationProject, quotedBundleScript);
