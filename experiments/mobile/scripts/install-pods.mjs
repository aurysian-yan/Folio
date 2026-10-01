import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('pod', ['install'], {
  cwd: resolve(project, 'ios'), stdio: 'inherit',
  env: { ...process.env, RUBYOPT: [process.env.RUBYOPT, '-r../scripts/cocoapods-utf8.rb'].filter(Boolean).join(' ') },
});

// Expo Constants 的预编译脚本需按完整路径执行，避免空格被二次 shell 拆分。
const podsProject = resolve(project, 'ios/Pods/Pods.xcodeproj/project.pbxproj');
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
