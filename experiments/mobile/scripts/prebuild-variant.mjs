#!/usr/bin/env node
// 按 APP_VARIANT 生成原生工程；仅当已生成的应用身份与目标不一致时使用 --clean，
// 避免 applicationId/namespace、图标与 URL scheme 残留导致安装或启动失败。

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const PROJECT_ROOT = process.cwd();

const variant = process.env.APP_VARIANT === 'production' ? 'production' : 'development';
const platform = process.argv[2];
const identity = variant === 'production' ? 'com.folio.mobile.poc' : 'com.folio.mobile.poc.dev';

if (platform !== 'android' && platform !== 'ios') {
  process.stderr.write(
    '用法：APP_VARIANT=development|production node scripts/prebuild-variant.mjs android|ios\n',
  );
  process.exit(1);
}

// 读取当前原生工程已生成的应用身份，工程不存在时返回 null（首次生成无需 --clean）。
function currentIdentity() {
  if (platform === 'android') {
    const file = join(PROJECT_ROOT, 'android/app/build.gradle');
    if (!existsSync(file)) return null;
    const match = readFileSync(file, 'utf8').match(/applicationId\s*=?\s*['"]([^'"]+)['"]/);
    return match ? match[1] : null;
  }
  const file = join(PROJECT_ROOT, 'ios/Folio.xcodeproj/project.pbxproj');
  if (!existsSync(file)) return null;
  const match = readFileSync(file, 'utf8').match(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/);
  return match ? match[1].trim() : null;
}

const current = currentIdentity();
const clean = current !== null && current !== identity;
const mode = clean ? '--clean' : '--no-clean';

process.stdout.write(
  clean
    ? `应用身份由 ${current} 切换为 ${identity}，先清理原生工程再生成。\n`
    : `应用身份保持 ${identity}，增量更新原生工程。\n`,
);

const result = spawnSync(
  PNPM,
  ['exec', 'expo', 'prebuild', '--platform', platform, '--no-install', mode],
  { cwd: PROJECT_ROOT, stdio: 'inherit', env: process.env },
);

process.exit(result.status ?? 1);
