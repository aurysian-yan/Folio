import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { findAndroidTools, listAndroidAvds, startAndroidAvd } from './android-emulator.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'folio-avd-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sdk = join(root, 'Android SDK');
  const state = join(root, 'state.json');
  const invocation = join(root, 'invocation.json');
  const emulator = join(sdk, 'emulator/emulator');
  const adb = join(sdk, 'platform-tools/adb');
  mkdirSync(dirname(emulator), { recursive: true });
  mkdirSync(dirname(adb), { recursive: true });
  const script = `#!${process.execPath}
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
const args = process.argv.slice(2);
if (process.argv[1].endsWith('/adb')) {
  if (args[0] === 'devices') console.log('List of devices attached\\n' + (state.running ? 'emulator-5554\\tdevice' : ''));
  else console.log(state.running + '\\nOK');
} else if (args[0] === '-list-avds') {
  if (state.listFailure) { console.error('list failed'); process.exit(2); }
  console.log(state.avds.join('\\r\\n'));
} else {
  fs.writeFileSync(${JSON.stringify(invocation)}, JSON.stringify({args, avdHome: process.env.ANDROID_AVD_HOME, sdk: process.env.ANDROID_HOME}));
  if (state.crash) { console.error('missing system image'); process.exit(3); }
  setTimeout(() => process.exit(0), 3500);
}
`;
  writeFileSync(emulator, script, { mode: 0o755 });
  writeFileSync(adb, script, { mode: 0o755 });
  const save = (extra = {}) => writeFileSync(state, JSON.stringify({ avds: ['Pixel_10', 'Tablet_API_35'], ...extra }));
  save();
  const env = { ANDROID_HOME: sdk, ANDROID_AVD_HOME: join(root, 'Custom AVDs'), PATH: '' };
  const find = (extra = {}) => findAndroidTools({ env, platform: 'linux', home: root, ...extra });
  return { root, sdk, emulator, env, save, find, invocation };
}

test('SDK 环境变量、空格路径及旧版配置均可发现工具', (t) => {
  const { sdk, emulator, env, find } = fixture(t);
  assert.equal(find().emulator, emulator);
  assert.equal(find({ env: { ANDROID_HOME: '/missing', ANDROID_SDK_ROOT: sdk } }).emulator, emulator);
  assert.equal(find().env.ANDROID_AVD_HOME, env.ANDROID_AVD_HOME);
  assert.equal(find().env.ANDROID_SDK_ROOT, sdk);
  assert.equal(env.ANDROID_SDK_ROOT, undefined);
});

test('项目转义路径、默认 SDK 目录和 PATH 符号链接均可发现工具', (t) => {
  const { root, sdk, emulator, find } = fixture(t);
  const mobileDir = join(root, 'mobile');
  mkdirSync(join(mobileDir, 'android'), { recursive: true });
  writeFileSync(join(mobileDir, 'android/local.properties'), `sdk.dir=${sdk.replaceAll(' ', '\\ ')}\n`);
  assert.equal(find({ env: {}, mobileDir }).emulator, emulator);
  const home = join(root, 'home');
  mkdirSync(join(home, 'Android'), { recursive: true });
  symlinkSync(sdk, join(home, 'Android/Sdk'));
  assert.equal(find({ env: {}, home }).emulator, emulator);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  symlinkSync(emulator, join(bin, 'emulator'));
  assert.equal(find({ env: { PATH: bin } }).emulator, emulator);
  assert.throws(() => find({ env: {} }), /未找到 Android Emulator/);
});

test('AVD 列表处理换行、空列表和命令错误', (t) => {
  const { save, find } = fixture(t);
  assert.deepEqual(listAndroidAvds(find()), ['Pixel_10', 'Tablet_API_35']);
  save({ avds: [] });
  assert.throws(() => listAndroidAvds(find()), /Device Manager/);
  save({ listFailure: true });
  assert.throws(() => listAndroidAvds(find()), /list failed/);
});

test('未知 AVD 拒绝启动；已运行的 AVD 不重复启动', async (t) => {
  const { save, find } = fixture(t);
  await assert.rejects(startAndroidAvd(find(), 'Unknown'), /未找到 AVD/);
  save({ running: 'Pixel_10' });
  assert.deepEqual(await startAndroidAvd(find(), 'Pixel_10'), { alreadyRunning: true, serial: 'emulator-5554' });
});

test('启动使用独立参数并保留 AVD 环境；退出后回收测试进程', async (t) => {
  const { sdk, env, find, invocation } = fixture(t);
  const result = await startAndroidAvd(find(), 'Pixel_10');
  t.after(() => {
    try { process.kill(result.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    rmSync(dirname(result.logFile), { recursive: true, force: true });
  });
  assert.equal(result.alreadyRunning, false);
  assert.deepEqual(JSON.parse(readFileSync(invocation, 'utf8')), {
    args: ['-avd', 'Pixel_10'], avdHome: env.ANDROID_AVD_HOME, sdk,
  });
  process.kill(result.pid, 'SIGTERM');
  await new Promise((resolveExit) => setTimeout(resolveExit, 200));
  assert.throws(() => process.kill(result.pid, 0), { code: 'ESRCH' });
});

test('启动时退出和无法执行均返回错误并提供日志', async (t) => {
  const { save, find, root } = fixture(t);
  save({ crash: true });
  await assert.rejects(startAndroidAvd(find(), 'Pixel_10'), (error) => {
    assert.match(error.message, /退出码 3/);
    const logFile = error.message.split('日志：')[1];
    assert.match(readFileSync(logFile, 'utf8'), /missing system image/);
    rmSync(dirname(logFile), { recursive: true, force: true });
    return true;
  });
  const broken = join(root, 'broken');
  writeFileSync(broken, '#!/missing-interpreter\n', { mode: 0o755 });
  const tools = find();
  tools.adb = broken;
  assert.equal(typeof tools.emulator, 'string');
});

test('命令行列表、指定名称、缺失参数及多 AVD 非交互错误', (t) => {
  const { env, save } = fixture(t);
  const cli = (...args) => spawnSync(process.execPath, [resolve(import.meta.dirname, 'folio.mjs'), 'emulator', ...args], {
    encoding: 'utf8', env, timeout: 10000,
  });
  assert.equal(cli('list').stdout.trim(), 'Pixel_10\nTablet_API_35');
  assert.match(cli('start').stderr, /--avd.*Pixel_10.*Tablet_API_35/);
  assert.equal(cli('start', '--avd', 'Unknown').status, 1);
  assert.match(cli('start', '--avd').stderr, /需要一个值/);
  save({ running: 'Pixel_10' });
  const result = cli('start', '--avd=Pixel_10');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /已在运行/);
});
