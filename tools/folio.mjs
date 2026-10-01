#!/usr/bin/env node
// Folio 跨平台管理脚本：多框架版本调试、构建与版本号批量提高。
// 仅使用 Node.js 实现，不产出也不依赖 cmd/ps1；Windows 下通过 pnpm、gradle 等标准入口调用外部工具。
// 交互式 TUI 基于 @clack/prompts；无参数运行进入 TUI，带参数运行则作为命令行工具直接执行。

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 仓库根目录由脚本位置推导，保证在任意工作目录下运行结果一致。
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.platform; // darwin | win32 | linux
const HOST_ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
const PNPM = HOST === 'win32' ? 'pnpm.cmd' : 'pnpm';
const GRADLEW = HOST === 'win32' ? 'gradlew.bat' : './gradlew';
// 在系统文件管理器中打开目录：macOS 用 open，Windows 用 explorer，Linux 用 xdg-open。
const LIST_DIR = HOST === 'darwin' ? 'open' : HOST === 'win32' ? 'explorer.exe' : 'xdg-open';

const MACOS_DIR = join(REPO_ROOT, 'apps/macos');
const DESKTOP_DIR = join(REPO_ROOT, 'apps/desktop-ui');
const MOBILE_DIR = join(REPO_ROOT, 'experiments/mobile');

const WINDOWS_TARGETS = {
  x64: 'x86_64-pc-windows-msvc',
  arm64: 'aarch64-pc-windows-msvc',
};
const LINUX_TARGETS = {
  x64: 'x86_64-unknown-linux-gnu',
  arm64: 'aarch64-unknown-linux-gnu',
};

const BACK = '__back__';

// 可被 TUI 捕获的用户/环境错误，命令行模式下会转为退出码 1。
class FolioError extends Error {}

// ---------------------------------------------------------------------------
// 通用进程与输出封装
// ---------------------------------------------------------------------------

function log(message = '') {
  process.stdout.write(`${message}\n`);
}

function warn(message) {
  process.stderr.write(`警告：${message}\n`);
}

function fail(message) {
  throw new FolioError(message);
}

function shorten(target) {
  const path = relative(REPO_ROOT, target);
  return path.startsWith('..') ? target : path;
}

// 统一的命令执行入口；默认继承标准输入输出并同步等待。
function run(command, args, options = {}) {
  const shown = [command, ...args].join(' ');
  const location = options.cwd && options.cwd !== REPO_ROOT ? `  (${shorten(options.cwd)})` : '';
  log(`\n$ ${shown}${location}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.error) {
    if (options.allowFailure) return result;
    fail(`无法执行 ${command}：${result.error.message}`);
  }
  // 被信号中断（例如开发服务器收到 Ctrl-C）视为正常结束。
  if (result.signal) {
    log(`\n已中断（${result.signal}）。`);
    return result;
  }
  if (result.status !== 0 && !options.allowFailure) {
    fail(`命令失败（退出码 ${result.status}）：${shown}`);
  }
  return result;
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.error || result.status !== 0) return null;
  return (result.stdout ?? '').trim();
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return !result.error;
}

// 在系统文件管理器中打开已存在的产物目录。
function openDirectory(target, label) {
  if (!existsSync(target)) {
    fail(`${label}尚不存在，请先执行对应的构建。\n  预期路径：${shorten(target)}`);
  }
  const result = run(LIST_DIR, [target], { allowFailure: true });
  if (result.error) fail(`无法调用 ${LIST_DIR} 打开目录：${result.error.message}`);
  log(`已在文件管理器中打开：${shorten(target)}`);
}

function parseArgs(args, spec = {}) {
  const values = new Set(spec.values ?? []);
  const booleans = new Set(spec.booleans ?? []);
  const parsed = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--') {
      parsed._.push(...args.slice(i + 1));
      break;
    }
    if (!token.startsWith('--')) {
      parsed._.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      parsed[body.slice(0, eq)] = body.slice(eq + 1);
    } else if (values.has(body)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`--${body} 需要一个值。`);
      parsed[body] = value;
      i += 1;
    } else if (booleans.has(body)) {
      parsed[body] = true;
    } else {
      parsed[body] = true;
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// 版本号清单：权威来源为 Cargo.toml 的 [workspace.package] 版本
// ---------------------------------------------------------------------------

const PBXPROJ = 'apps/macos/Folio.xcodeproj/project.pbxproj';
const INFO_PLIST = 'apps/macos/Folio/Info.plist';
const TAURI_LOCK = 'apps/desktop-ui/src-tauri/Cargo.lock';

// 版本号写入点；read/write 均为字段级精确替换，避免误伤 SWIFT_VERSION 等相邻字段。
const VERSION_MANIFESTS = [
  {
    label: 'Cargo.toml（workspace）',
    path: 'Cargo.toml',
    read: (text) => sectionVersion(text, '[workspace.package]'),
    write: (text, value) => replaceSectionVersion(text, '[workspace.package]', value),
  },
  {
    label: 'src-tauri/Cargo.toml（package）',
    path: 'apps/desktop-ui/src-tauri/Cargo.toml',
    read: (text) => sectionVersion(text, '[package]'),
    write: (text, value) => replaceSectionVersion(text, '[package]', value),
  },
  {
    label: 'desktop-ui/package.json',
    path: 'apps/desktop-ui/package.json',
    read: (text) => jsonValue(text, 'version'),
    write: (text, value) => jsonReplace(text, 'version', value),
  },
  {
    label: 'tauri.conf.json',
    path: 'apps/desktop-ui/src-tauri/tauri.conf.json',
    read: (text) => jsonValue(text, 'version'),
    write: (text, value) => jsonReplace(text, 'version', value),
  },
  {
    label: 'macOS MARKETING_VERSION',
    path: PBXPROJ,
    read: (text) => pbxprojValue(text, 'MARKETING_VERSION'),
    write: (text, value) => replacePbxproj(text, 'MARKETING_VERSION', value),
  },
  {
    label: 'macOS Info.plist',
    path: INFO_PLIST,
    read: (text) => plistValue(text, 'CFBundleShortVersionString'),
    write: (text, value) => replacePlist(text, 'CFBundleShortVersionString', value),
  },
  {
    label: 'mobile/package.json',
    path: 'experiments/mobile/package.json',
    read: (text) => jsonValue(text, 'version'),
    write: (text, value) => jsonReplace(text, 'version', value),
  },
];

// 构建号写入点，仅在 bump 时使用 --build 递增。
const BUILD_MANIFESTS = [
  {
    label: 'macOS CURRENT_PROJECT_VERSION',
    path: PBXPROJ,
    read: (text) => pbxprojValue(text, 'CURRENT_PROJECT_VERSION'),
    write: (text, value) => replacePbxproj(text, 'CURRENT_PROJECT_VERSION', value),
  },
  {
    label: 'macOS CFBundleVersion',
    path: INFO_PLIST,
    read: (text) => plistValue(text, 'CFBundleVersion'),
    write: (text, value) => replacePlist(text, 'CFBundleVersion', value),
  },
];

function readManifest(manifest) {
  const text = readFileSync(join(REPO_ROOT, manifest.path), 'utf8');
  return { text, value: manifest.read(text) };
}

function sectionVersion(text, section) {
  const lines = text.split('\n');
  let inside = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      inside = trimmed === section;
      continue;
    }
    if (inside) {
      const match = trimmed.match(/^version\s*=\s*"([^"]*)"/);
      if (match) return match[1];
    }
  }
  return null;
}

function replaceSectionVersion(text, section, value) {
  const lines = text.split('\n');
  let inside = false;
  let replaced = false;
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      inside = trimmed === section;
      return line;
    }
    if (!replaced && inside && /^version\s*=\s*"[^"]*"/.test(trimmed)) {
      replaced = true;
      return line.replace(/version\s*=\s*"[^"]*"/, `version = "${value}"`);
    }
    return line;
  });
  if (!replaced) fail(`未在 ${section} 中找到 version 字段。`);
  return out.join('\n');
}

function jsonValue(text, keyPath) {
  let node = JSON.parse(text);
  for (const key of keyPath.split('.')) node = node?.[key];
  return node ?? null;
}

// 只替换目标键所在行，保留原始排版，避免数组被整体重排。
function jsonReplace(text, keyPath, value) {
  const keys = keyPath.split('.');
  const key = keys[keys.length - 1];
  const indent = ' '.repeat(keys.length * 2);
  const pattern = new RegExp(`^${indent}"${key}":\\s*"[^"]*"`, 'm');
  if (!pattern.test(text)) fail(`未在 JSON 中找到 ${keyPath} 字段。`);
  return text.replace(pattern, `${indent}"${key}": "${value}"`);
}

function pbxprojValue(text, key) {
  const match = text.match(new RegExp(`${key} = ([^;]+);`));
  return match ? match[1].trim() : null;
}

function replacePbxproj(text, key, value) {
  if (!new RegExp(`${key} = [^;]+;`).test(text)) fail(`未在 project.pbxproj 中找到 ${key}。`);
  return text.replace(new RegExp(`${key} = [^;]+;`, 'g'), `${key} = ${value};`);
}

function plistValue(text, key) {
  const match = text.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return match ? match[1] : null;
}

function replacePlist(text, key, value) {
  const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  if (!pattern.test(text)) fail(`未在 Info.plist 中找到 ${key}。`);
  return text.replace(pattern, `$1${value}$2`);
}

function readWorkspaceVersion() {
  const { value } = readManifest(VERSION_MANIFESTS[0]);
  if (!value) fail('无法从 Cargo.toml 读取 workspace 版本。');
  return value;
}

function computeNextVersion(current, spec) {
  if (/^\d+\.\d+\.\d+$/.test(spec)) return spec;
  const [major, minor, patch] = current.split('.').map((part) => Number.parseInt(part, 10));
  if (spec === 'major') return `${major + 1}.0.0`;
  if (spec === 'minor') return `${major}.${minor + 1}.0`;
  if (spec === 'patch') return `${major}.${minor}.${patch + 1}`;
  fail('版本参数需为 major、minor、patch 或 x.y.z（可用 --to 指定）。');
}

function showVersions() {
  const authoritative = readWorkspaceVersion();
  log(`权威版本（Cargo.toml [workspace.package]）：${authoritative}\n`);
  const rows = VERSION_MANIFESTS.map((manifest) => {
    const { value } = readManifest(manifest);
    return [manifest.label, String(value), value === authoritative ? '一致' : '不一致'];
  });
  for (const manifest of BUILD_MANIFESTS) {
    rows.push([manifest.label, String(readManifest(manifest).value), '-']);
  }
  const width = Math.max(...rows.map((row) => widthOf(row[0])));
  for (const [name, value, status] of rows) {
    log(`${name}${' '.repeat(width - widthOf(name) + 2)}${value.padEnd(10)}${status}`);
  }
}

// 中文标签按显示宽度对齐，避免表格错位。
function widthOf(text) {
  let width = 0;
  for (const char of text) width += char.charCodeAt(0) > 0x2e7f ? 2 : 1;
  return width;
}

function planVersionBump(args) {
  const current = readWorkspaceVersion();
  const spec = args._[0] ?? args.to;
  if (!spec) fail('请指定版本参数：major、minor、patch 或 x.y.z。');
  const next = computeNextVersion(current, spec);
  const buildManifests = args.build ? BUILD_MANIFESTS : [];
  const buildCurrent = args.build ? Number.parseInt(readManifest(BUILD_MANIFESTS[0]).value, 10) || 0 : null;
  const buildNext = args.build ? buildCurrent + 1 : null;
  return { current, next, buildManifests, buildCurrent, buildNext };
}

function formatVersionPlan(plan) {
  const lines = [
    `版本：${plan.current} → ${plan.next}` +
      (plan.buildNext != null ? `，构建号：${plan.buildCurrent} → ${plan.buildNext}` : ''),
  ];
  for (const manifest of VERSION_MANIFESTS) {
    lines.push(`  ${manifest.label}：${readManifest(manifest).value} → ${plan.next}`);
  }
  for (const manifest of plan.buildManifests) {
    lines.push(`  ${manifest.label}：${readManifest(manifest).value} → ${plan.buildNext}`);
  }
  return lines;
}

function applyManifests(manifests, valueOf) {
  const originals = new Map();
  for (const manifest of manifests) {
    const absolute = join(REPO_ROOT, manifest.path);
    const text = readFileSync(absolute, 'utf8');
    originals.set(manifest.path, text);
    writeFileSync(absolute, manifest.write(text, valueOf(manifest)));
  }
  return originals;
}

function verifyManifests(manifests, expectedOf) {
  const problems = [];
  for (const manifest of manifests) {
    const { value } = readManifest(manifest);
    if (String(value) !== String(expectedOf(manifest))) {
      problems.push(`${manifest.label}（当前 ${value}）`);
    }
  }
  return problems;
}

function syncCargoLocks() {
  for (const cwd of [REPO_ROOT, join(DESKTOP_DIR, 'src-tauri')]) {
    const result = spawnSync('cargo', ['update', '--workspace'], { cwd, stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      warn(`同步 ${shorten(join(cwd, 'Cargo.lock'))} 失败，构建时会自动更新。`);
    }
  }
}

function executeVersionBump(plan, args) {
  if (!args['no-git']) {
    const existing = capture('git', ['tag', '--list', `v${plan.next}`]);
    if (existing) fail(`标签 v${plan.next} 已存在，请先处理后再执行。`);
  }

  const versionOriginals = applyManifests(VERSION_MANIFESTS, () => plan.next);
  const buildOriginals = applyManifests(plan.buildManifests, () => plan.buildNext);

  const problems = [
    ...verifyManifests(VERSION_MANIFESTS, () => plan.next),
    ...verifyManifests(plan.buildManifests, () => plan.buildNext),
  ];
  if (problems.length > 0) {
    for (const [path, text] of [...versionOriginals, ...buildOriginals]) {
      writeFileSync(join(REPO_ROOT, path), text);
    }
    fail(`版本校验失败，已回滚：${problems.join('、')}`);
  }

  syncCargoLocks();
  log('\n已将全部版本字段更新为一致值。');

  if (args['no-git']) {
    log('（--no-git：未提交、未打标签）');
    return;
  }

  const files = [
    ...VERSION_MANIFESTS.map((manifest) => manifest.path),
    ...BUILD_MANIFESTS.map((manifest) => manifest.path),
    'Cargo.lock',
    TAURI_LOCK,
  ];
  run('git', ['add', ...new Set(files)]);
  run('git', ['commit', '-m', `chore: 发布 v${plan.next}`]);
  run('git', ['tag', `v${plan.next}`]);
  log(`\n已提交并创建标签 v${plan.next}（未推送远端）。`);
}

function bumpVersion(args) {
  const plan = planVersionBump(args);
  for (const line of formatVersionPlan(plan)) log(line);
  if (args['dry-run']) {
    log('\n（--dry-run：未写入任何文件）');
    return;
  }
  executeVersionBump(plan, args);
}

// ---------------------------------------------------------------------------
// SwiftUI（macOS 原生客户端，仅 macOS 主机）
// ---------------------------------------------------------------------------

function requireDarwin(feature) {
  if (HOST !== 'darwin') fail(`${feature} 仅支持 macOS 主机，当前主机为 ${HOST}。`);
}

function swiftuiDerivedData() {
  return join(MACOS_DIR, '.build/DerivedData');
}

function swiftuiDev() {
  requireDarwin('SwiftUI 调试');
  const derivedData = swiftuiDerivedData();
  run(
    'xcodebuild',
    [
      '-project', 'Folio.xcodeproj',
      '-scheme', 'Folio',
      '-configuration', 'Debug',
      '-destination', 'platform=macOS',
      '-derivedDataPath', derivedData,
      'build',
    ],
    { cwd: MACOS_DIR },
  );
  const app = join(derivedData, 'Build/Products/Debug/Folio.app');
  if (!existsSync(app)) fail(`未找到构建产物：${shorten(app)}`);
  log(`\n启动 ${shorten(app)}`);
  run('open', [app]);
}

function swiftuiBuild(args) {
  requireDarwin('SwiftUI 构建');
  const derivedData = swiftuiDerivedData();
  run(
    'xcodebuild',
    [
      '-project', 'Folio.xcodeproj',
      '-scheme', 'Folio',
      '-configuration', 'Release',
      '-destination', 'platform=macOS',
      '-derivedDataPath', derivedData,
      'build',
    ],
    { cwd: MACOS_DIR },
  );
  const app = join(derivedData, 'Build/Products/Release/Folio.app');
  if (!existsSync(app)) fail(`未找到构建产物：${shorten(app)}`);
  log(`\n应用产物：${shorten(app)}`);
  if (args.dmg) createDmg(app, readWorkspaceVersion());
}

function createDmg(app, version) {
  const staging = join(MACOS_DIR, '.build/dmg-staging');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  cpSync(app, join(staging, 'Folio.app'), { recursive: true });
  symlinkSync('/Applications', join(staging, 'Applications'));
  const dmg = join(MACOS_DIR, `.build/Folio-${version}.dmg`);
  run('hdiutil', ['create', '-volname', 'Folio', '-srcfolder', staging, '-ov', '-format', 'UDZO', dmg]);
  log(`安装镜像：${shorten(dmg)}`);
}

function swiftuiOpen() {
  requireDarwin('SwiftUI 打开产物目录');
  openDirectory(join(swiftuiDerivedData(), 'Build/Products/Release'), 'SwiftUI 构建产物目录');
}

// ---------------------------------------------------------------------------
// Tauri（Windows/Linux 共用桌面客户端，明确不含 macOS）
// ---------------------------------------------------------------------------

function tauriDev(args) {
  if (HOST === 'darwin') {
    fail('Tauri 客户端不将 macOS 纳入支持范围，无法在本机运行调试；请在 Windows 或 Linux 主机执行。');
  }
  const supported = HOST === 'win32' ? 'windows' : 'linux';
  if ((args.platform ?? supported) !== supported) {
    fail(`本机只能调试 ${supported} 版本，跨目标构建请使用 build。`);
  }
  run(PNPM, ['exec', 'tauri', 'dev'], { cwd: DESKTOP_DIR });
}

function tauriBuild(args) {
  const platform = args.platform ?? (HOST === 'win32' ? 'windows' : HOST === 'linux' ? 'linux' : 'windows');
  if (platform === 'macos' || platform === 'darwin') fail('Tauri 不支持 macOS 目标。');
  if (platform !== 'windows' && platform !== 'linux') fail('--platform 仅支持 windows 或 linux。');

  const arch = args.arch ?? (HOST === 'linux' && platform === 'linux' ? HOST_ARCH : 'x64');
  const target = platform === 'windows' ? WINDOWS_TARGETS[arch] : LINUX_TARGETS[arch];
  if (!target) fail('--arch 仅支持 x64 或 arm64。');

  const tauriArgs = ['exec', 'tauri', 'build', '--target', target];
  if (platform === 'windows') {
    if (HOST !== 'win32') {
      ensureCrossWindowsTools();
      tauriArgs.push('--runner', 'cargo-xwin');
    }
  } else if (HOST !== 'linux') {
    fail('Tauri 的 Linux 版本需要在 Linux 主机上构建。');
  } else if (arch !== HOST_ARCH) {
    warn('非本机架构的 Linux 构建需要额外交叉工具链支持。');
  }

  run(PNPM, tauriArgs, { cwd: DESKTOP_DIR });
  log(`\n产物目录：${shorten(join(DESKTOP_DIR, 'src-tauri/target', target, 'release/bundle'))}`);
}

// 产物可能位于带目标三元组的目录，也可能位于本机构建的 target/release/bundle。
function tauriOutputCandidates(platform, arch) {
  const table = platform === 'windows' ? WINDOWS_TARGETS : LINUX_TARGETS;
  if (arch && !table[arch]) fail('--arch 仅支持 x64 或 arm64。');
  const arches = arch ? [arch] : Object.keys(table);
  const dirs = arches.map((name) => join(DESKTOP_DIR, 'src-tauri/target', table[name], 'release/bundle'));
  dirs.push(join(DESKTOP_DIR, 'src-tauri/target/release/bundle'));
  return dirs;
}

function tauriOpen(args) {
  const platform = args.platform ?? (HOST === 'win32' ? 'windows' : HOST === 'linux' ? 'linux' : 'windows');
  if (platform === 'macos' || platform === 'darwin') fail('Tauri 不支持 macOS 目标。');
  if (platform !== 'windows' && platform !== 'linux') fail('--platform 仅支持 windows 或 linux。');

  const candidates = tauriOutputCandidates(platform, args.arch);
  const target = candidates.find((dir) => existsSync(dir));
  if (!target) {
    fail(`未找到 Tauri ${platform} 构建产物，请先执行构建。\n  预期路径：${shorten(candidates[0])}`);
  }
  openDirectory(target, `Tauri ${platform} 构建产物目录`);
}

function ensureCrossWindowsTools() {
  const missing = [];
  if (!commandExists('cargo-xwin') && !capture('cargo', ['xwin', '--version'])) {
    missing.push('cargo-xwin（cargo install --locked cargo-xwin）');
  }
  if (!commandExists('makensis')) {
    missing.push('NSIS（macOS: brew install nsis；Ubuntu: sudo apt install nsis）');
  }
  if (!commandExists('llvm-rc')) {
    missing.push('LLVM/llvm-rc（macOS: brew install llvm；Ubuntu: sudo apt install lld llvm）');
  }
  const installed = (capture('rustup', ['target', 'list', '--installed']) ?? '').split('\n');
  if (!installed.includes('x86_64-pc-windows-msvc') && !installed.includes('aarch64-pc-windows-msvc')) {
    missing.push('Windows Rust 目标（rustup target add x86_64-pc-windows-msvc）');
  }
  if (missing.length > 0) {
    fail(`交叉编译 Windows 缺少以下前置：\n  - ${missing.join('\n  - ')}`);
  }
}

// ---------------------------------------------------------------------------
// Expo React Native（仅 Android 与 iOS，主机不限；iOS 编译需要 macOS）
// ---------------------------------------------------------------------------

function expoPlatform(args) {
  const platform = args.platform;
  if (platform !== 'ios' && platform !== 'android') {
    fail('请通过 --platform ios 或 --platform android 指定目标。');
  }
  if (platform === 'ios') requireDarwin('iOS 构建');
  return platform;
}

// variant 决定应用身份，prebuild-variant 会在身份变化时自动清理原生工程。
function expoPrepare(platform, args, variant) {
  if (!args['no-rust']) {
    run(PNPM, [platform === 'ios' ? 'rust:ios' : 'rust:android'], { cwd: MOBILE_DIR });
  }
  if (!args['no-prebuild']) {
    run('node', ['scripts/prebuild-variant.mjs', platform], {
      cwd: MOBILE_DIR,
      env: { APP_VARIANT: variant },
    });
  }
  if (platform === 'ios') run(PNPM, ['pods'], { cwd: MOBILE_DIR });
}

function expoDev(args) {
  const platform = expoPlatform(args);
  expoPrepare(platform, args, 'development');
  run(PNPM, [platform, ...(args._ ?? [])], {
    cwd: MOBILE_DIR,
    env: { APP_VARIANT: 'development' },
  });
}

function expoBuild(args) {
  const platform = expoPlatform(args);
  expoPrepare(platform, args, 'production');

  if (platform === 'android') {
    const task = args.aab ? 'bundleRelease' : 'assembleRelease';
    run(GRADLEW, [task], { cwd: join(MOBILE_DIR, 'android') });
    const output = args.aab ? 'android/app/build/outputs/bundle/release' : 'android/app/build/outputs/apk/release';
    log(`\n产物目录：${shorten(join(MOBILE_DIR, output))}`);
    return;
  }

  const archive = join(MOBILE_DIR, '.build/Folio.xcarchive');
  run(
    'xcodebuild',
    [
      '-workspace', 'ios/Folio.xcworkspace',
      '-scheme', 'Folio',
      '-configuration', 'Release',
      '-archivePath', archive,
      'archive',
    ],
    { cwd: MOBILE_DIR },
  );
  log(`\n归档产物：${shorten(archive)}`);
}

function expoOpen(args) {
  const platform = expoPlatform(args);
  const target = platform === 'android'
    ? join(MOBILE_DIR, 'android/app/build/outputs')
    : join(MOBILE_DIR, '.build');
  openDirectory(target, `Expo ${platform} 构建产物目录`);
}

// ---------------------------------------------------------------------------
// 环境自检
// ---------------------------------------------------------------------------

function doctor() {
  const checks = [];
  const add = (name, ok, hint) => checks.push({ name, ok, hint });

  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  add('Node.js ≥ 20.19', nodeMajor >= 20, '升级 Node.js 至 20.19 或 22.12 以上');
  add('pnpm', commandExists(PNPM), '安装 pnpm（corepack enable pnpm）');
  add('cargo', commandExists('cargo'), '安装 Rust 工具链');
  if (HOST === 'darwin') add('xcodebuild', commandExists('xcodebuild'), '安装 Xcode 与命令行工具');

  const installed = (capture('rustup', ['target', 'list', '--installed']) ?? '').split('\n');
  add(
    'Windows Rust 目标（交叉编译 Tauri）',
    installed.includes('x86_64-pc-windows-msvc'),
    'rustup target add x86_64-pc-windows-msvc',
  );
  if (HOST !== 'win32') {
    add(
      'cargo-xwin',
      commandExists('cargo-xwin') || Boolean(capture('cargo', ['xwin', '--version'])),
      'cargo install --locked cargo-xwin',
    );
    add('NSIS（makensis）', commandExists('makensis'), 'macOS: brew install nsis；Ubuntu: sudo apt install nsis');
  }

  add('Android SDK（ANDROID_HOME）', Boolean(process.env.ANDROID_HOME), '设置 ANDROID_HOME 指向 Android SDK');
  add('JDK（Java 17）', commandExists('java'), '安装 JDK 17 并加入 PATH');

  let failed = 0;
  for (const check of checks) {
    if (!check.ok) failed += 1;
    log(`${check.ok ? '✔' : '✘'} ${check.name}${check.ok ? '' : `  → ${check.hint}`}`);
  }
  log('');
  if (failed > 0) warn(`${failed} 项前置条件未满足；对应平台的命令可能无法执行。`);
  else log('全部前置条件满足。');
  return failed;
}

// ---------------------------------------------------------------------------
// 交互式 TUI（@clack/prompts）
// ---------------------------------------------------------------------------

let clack = null;

// 动态加载，保证未安装依赖时命令行用法仍然可用。
async function loadClack() {
  if (clack) return clack;
  try {
    clack = await import('@clack/prompts');
  } catch {
    fail('未找到 @clack/prompts，请先在仓库根目录执行 pnpm install。');
  }
  return clack;
}

// 单个菜单：返回所选值，Esc/Ctrl-C 取消时返回 BACK。
async function choose(c, message, options) {
  const result = await c.select({ message, options });
  return c.isCancel(result) ? BACK : result;
}

// 执行外部动作并捕获可预期的错误，避免中断 TUI。
async function runAction(c, label, action) {
  c.log.step(label);
  try {
    return action();
  } catch (error) {
    if (error instanceof FolioError) {
      c.log.error(error.message);
      return undefined;
    }
    throw error;
  }
}

async function tuiSwiftui(c) {
  const choice = await choose(c, 'SwiftUI（macOS 客户端）', [
    { value: 'dev', label: '调试运行' },
    { value: 'build', label: '构建（Release）' },
    { value: 'dmg', label: '构建并生成 DMG' },
    { value: 'open', label: '打开构建产物目录' },
    { value: BACK, label: '返回主菜单' },
  ]);
  if (choice === BACK) return;
  if (choice === 'dev') await runAction(c, 'SwiftUI 调试', () => swiftuiDev());
  else if (choice === 'build') await runAction(c, 'SwiftUI 构建', () => swiftuiBuild({}));
  else if (choice === 'dmg') await runAction(c, 'SwiftUI 构建（DMG）', () => swiftuiBuild({ dmg: true }));
  else if (choice === 'open') await runAction(c, 'SwiftUI 产物目录', () => swiftuiOpen());
}

async function tuiTauri(c) {
  const choice = await choose(c, 'Tauri（Windows / Linux 客户端）', [
    { value: 'dev', label: '调试运行（当前主机）' },
    { value: 'windows', label: '构建 Windows 版本', hint: 'MSVC 工具链' },
    { value: 'linux', label: '构建 Linux 版本' },
    { value: 'open-windows', label: '打开 Windows 构建产物目录' },
    { value: 'open-linux', label: '打开 Linux 构建产物目录' },
    { value: BACK, label: '返回主菜单' },
  ]);
  if (choice === BACK) return;
  if (choice === 'dev') {
    await runAction(c, 'Tauri 调试', () => tauriDev({}));
    return;
  }
  if (choice === 'open-windows' || choice === 'open-linux') {
    const platform = choice === 'open-windows' ? 'windows' : 'linux';
    await runAction(c, `Tauri ${platform} 产物目录`, () => tauriOpen({ platform }));
    return;
  }
  const arch = await choose(c, `Tauri · ${choice === 'windows' ? 'Windows' : 'Linux'} 目标架构`, [
    { value: 'x64', label: 'x64', hint: '64 位' },
    { value: 'arm64', label: 'arm64', hint: 'ARM 64 位' },
    { value: BACK, label: '返回' },
  ]);
  if (arch === BACK) return;
  await runAction(c, `Tauri 构建 ${choice}`, () => tauriBuild({ platform: choice, arch }));
}

async function tuiExpo(c) {
  const platform = await choose(c, 'Expo（Android / iOS 移动端）', [
    { value: 'android', label: 'Android' },
    { value: 'ios', label: 'iOS', hint: '需要 macOS 主机' },
    { value: BACK, label: '返回主菜单' },
  ]);
  if (platform === BACK) return;

  const options = [
    { value: 'dev', label: '调试运行' },
    { value: 'build', label: '构建', hint: platform === 'android' ? 'APK' : '归档' },
  ];
  if (platform === 'android') options.push({ value: 'aab', label: '构建 AAB' });
  options.push({ value: 'open', label: '打开构建产物目录' });
  options.push({ value: BACK, label: '返回' });

  const action = await choose(c, `Expo · ${platform === 'ios' ? 'iOS' : 'Android'}`, options);
  if (action === BACK) return;
  if (action === 'dev') await runAction(c, 'Expo 调试', () => expoDev({ platform }));
  else if (action === 'build') await runAction(c, 'Expo 构建', () => expoBuild({ platform }));
  else if (action === 'aab') await runAction(c, 'Expo 构建 AAB', () => expoBuild({ platform, aab: true }));
  else if (action === 'open') await runAction(c, 'Expo 产物目录', () => expoOpen({ platform }));
}

async function tuiVersionBump(c) {
  const kind = await choose(c, '选择提升方式', [
    { value: 'patch', label: 'patch', hint: '修订号 +1' },
    { value: 'minor', label: 'minor', hint: '次版本号 +1' },
    { value: 'major', label: 'major', hint: '主版本号 +1' },
    { value: 'custom', label: '自定义版本号' },
    { value: BACK, label: '返回' },
  ]);
  if (kind === BACK) return;

  let spec = kind;
  if (kind === 'custom') {
    const input = await c.text({
      message: '请输入版本号',
      placeholder: 'x.y.z',
      validate: (value) => (/^\d+\.\d+\.\d+$/.test(value.trim()) ? undefined : '请使用 x.y.z 形式'),
    });
    if (c.isCancel(input)) return;
    spec = input.trim();
  }

  const withBuild = await c.confirm({ message: '是否同时递增 macOS 构建号？', initialValue: true });
  if (c.isCancel(withBuild)) return;

  const args = { _: [spec], build: withBuild };
  let plan;
  try {
    plan = planVersionBump(args);
  } catch (error) {
    if (error instanceof FolioError) {
      c.log.error(error.message);
      return;
    }
    throw error;
  }
  c.note(formatVersionPlan(plan).join('\n'), '版本改动计划');

  const confirmed = await c.confirm({ message: '确认写入并提交、打标签？', initialValue: true });
  if (c.isCancel(confirmed) || !confirmed) return;
  await runAction(c, '提高版本号', () => executeVersionBump(plan, args));
}

async function tuiVersion(c) {
  const choice = await choose(c, '版本管理', [
    { value: 'show', label: '查看当前版本' },
    { value: 'bump', label: '提高版本号' },
    { value: BACK, label: '返回主菜单' },
  ]);
  if (choice === BACK) return;
  if (choice === 'show') await runAction(c, '版本信息', () => showVersions());
  else if (choice === 'bump') await tuiVersionBump(c);
}

async function tuiMain(c) {
  for (;;) {
    const choice = await choose(c, '选择要管理的目标', [
      { value: 'swiftui', label: 'SwiftUI', hint: 'macOS 客户端' },
      { value: 'tauri', label: 'Tauri', hint: 'Windows / Linux 客户端' },
      { value: 'expo', label: 'Expo', hint: 'Android / iOS 移动端' },
      { value: 'version', label: '版本管理', hint: '查看或提高版本号' },
      { value: 'doctor', label: '环境自检', hint: '检查构建前置条件' },
    ]);
    if (choice === BACK) return;
    if (choice === 'swiftui') await tuiSwiftui(c);
    else if (choice === 'tauri') await tuiTauri(c);
    else if (choice === 'expo') await tuiExpo(c);
    else if (choice === 'version') await tuiVersion(c);
    else if (choice === 'doctor') await runAction(c, '环境自检', () => doctor());
  }
}

async function runTui() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail('当前环境不是交互式终端，无法启动 TUI；请改用命令行参数。');
  }
  const c = await loadClack();
  c.intro('Folio 管理脚本');
  try {
    await tuiMain(c);
  } catch (error) {
    if (error instanceof FolioError) c.log.error(error.message);
    else throw error;
  }
  c.outro('已退出');
}

// ---------------------------------------------------------------------------
// 命令行入口
// ---------------------------------------------------------------------------

function printHelp() {
  log(`Folio 管理脚本

用法：
  node tools/folio.mjs                进入交互式 TUI
  node tools/folio.mjs <框架> <动作> [选项]

框架与动作：
  swiftui dev                         在 macOS 上调试运行 SwiftUI 客户端
  swiftui build [--dmg]               构建 SwiftUI 客户端（可选生成 DMG）
  swiftui open                        在文件管理器中打开 SwiftUI 构建产物目录
  tauri dev                           在 Windows/Linux 上调试 Tauri 客户端
  tauri build [--platform windows|linux] [--arch x64|arm64]
                                      构建 Tauri 客户端（Windows 走 MSVC）
  tauri open [--platform windows|linux] [--arch x64|arm64]
                                      打开 Tauri 构建产物目录
  expo dev --platform ios|android     调试运行 Expo 移动端
  expo build --platform ios|android [--aab]
                                      构建移动端（Android 出 APK/AAB，iOS 出归档）
  expo open --platform ios|android    打开 Expo 构建产物目录
  version show                        查看各文件当前版本
  version bump <major|minor|patch|x.y.z> [--build] [--dry-run] [--no-git]
                                      批量提高版本号
  doctor                              检查当前主机的构建前置条件

环境变量：
  ANDROID_HOME                        Android SDK 路径
  ANDROID_NDK_HOME                    非默认 NDK 路径`);
}

function dispatch(group, action, rest) {
  switch (group) {
    case 'swiftui':
      if (action === 'dev') return swiftuiDev();
      if (action === 'build') return swiftuiBuild(parseArgs(rest, { booleans: ['dmg'] }));
      if (action === 'open') return swiftuiOpen();
      break;
    case 'tauri':
      if (action === 'dev') return tauriDev(parseArgs(rest, { values: ['platform'] }));
      if (action === 'build') return tauriBuild(parseArgs(rest, { values: ['platform', 'arch'] }));
      if (action === 'open') return tauriOpen(parseArgs(rest, { values: ['platform', 'arch'] }));
      break;
    case 'expo':
      if (action === 'dev') {
        return expoDev(parseArgs(rest, { values: ['platform'], booleans: ['no-rust', 'no-prebuild'] }));
      }
      if (action === 'build') {
        return expoBuild(parseArgs(rest, { values: ['platform'], booleans: ['no-rust', 'no-prebuild', 'aab'] }));
      }
      if (action === 'open') return expoOpen(parseArgs(rest, { values: ['platform'] }));
      break;
    case 'version':
      if (action === 'show') return showVersions();
      if (action === 'bump') {
        return bumpVersion(parseArgs(rest, { values: ['to'], booleans: ['build', 'dry-run', 'no-git'] }));
      }
      break;
    case 'doctor':
      if (doctor() > 0) process.exitCode = 1;
      return;
    default:
      break;
  }
  fail(`无法识别的命令：${[group, action].filter(Boolean).join(' ')}。运行 node tools/folio.mjs help 查看用法。`);
}

async function bootstrap() {
  const [group, action, ...rest] = process.argv.slice(2);
  if (!group) {
    if (process.stdin.isTTY && process.stdout.isTTY) return runTui();
    printHelp();
    return;
  }
  if (group === 'tui') return runTui();
  if (group === 'help' || group === '--help' || group === '-h') return printHelp();
  return dispatch(group, action, rest);
}

bootstrap().catch((error) => {
  if (error instanceof FolioError) {
    process.stderr.write(`错误：${error.message}\n`);
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});
