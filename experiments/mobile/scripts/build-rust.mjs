import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(project, '../..');
const native = join(project, 'modules/folio-native');
const manifest = join(repository, 'Cargo.toml');
const command = process.argv[2];
const argumentsAfterCommand = process.argv.slice(3);
const cargo = process.env.CARGO ?? 'cargo';

function run(executable, args, env = process.env) {
  execFileSync(executable, args, { cwd: project, env, stdio: 'inherit' });
}

function build(target, output, env = process.env) {
  run(cargo, ['build', '--locked', '--manifest-path', manifest, '-p', 'folio-ffi',
    '--lib', '--release', '--target', target, '--target-dir', output], env);
}

function bindings() {
  if (argumentsAfterCommand.some((language) => !['swift', 'kotlin'].includes(language))) {
    throw new Error('bindings 只接受 swift 或 kotlin');
  }
  const output = join(repository, 'target');
  run(cargo, ['build', '--locked', '--manifest-path', manifest, '-p', 'folio-ffi',
    '--lib', '--target-dir', output]);
  const libraryName = process.platform === 'darwin' ? 'libfolio_ffi.dylib'
    : process.platform === 'win32' ? 'folio_ffi.dll' : 'libfolio_ffi.so';
  for (const [language, directory] of [
    ['swift', join(native, 'ios/generated')],
    ['kotlin', join(native, 'android/generated')],
  ]) {
    if (argumentsAfterCommand.length && !argumentsAfterCommand.includes(language)) continue;
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    run(cargo, ['run', '--locked', '--manifest-path', manifest, '-p', 'folio-ffi',
      '--bin', 'uniffi-bindgen', '--target-dir', output, '--', 'generate',
      '--library', join(output, 'debug', libraryName), '--language', language,
      '--config', join(project, 'uniffi.toml'), '--out-dir', directory, '--no-format']);
  }
  if (!argumentsAfterCommand.length || argumentsAfterCommand.includes('swift')) {
    copyFileSync(join(native, 'ios/generated/folio_ffiFFI.modulemap'),
      join(native, 'ios/generated/module.modulemap'));
  }
}

function android() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
    ?? join(homedir(), process.platform === 'darwin' ? 'Library/Android/sdk' : 'Android/Sdk');
  const ndk = process.env.ANDROID_NDK_HOME ?? join(sdk, 'ndk/29.0.13846066');
  const toolchains = join(ndk, 'toolchains/llvm/prebuilt');
  if (!existsSync(toolchains)) throw new Error('请配置 ANDROID_NDK_HOME（已验证 NDK 29.0.13846066）');
  const host = readdirSync(toolchains).find((name) => name.startsWith(
    process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux'));
  if (!host) throw new Error('NDK 中没有当前主机的 LLVM 工具链');
  const bin = join(toolchains, host, 'bin');
  const suffix = process.platform === 'win32' ? '.cmd' : '';
  const targets = {
    'arm64-v8a': ['aarch64-linux-android', 'aarch64-linux-android'],
    'x86_64': ['x86_64-linux-android', 'x86_64-linux-android'],
    'armeabi-v7a': ['armv7-linux-androideabi', 'armv7a-linux-androideabi'],
    'x86': ['i686-linux-android', 'i686-linux-android'],
  };
  const abis = argumentsAfterCommand.length ? argumentsAfterCommand : ['arm64-v8a', 'x86_64'];
  const output = join(project, '.build/rust-android');
  for (const abi of abis) {
    const entry = targets[abi];
    if (!entry) throw new Error(`不支持的 Android ABI：${abi}`);
    const [target, clangTarget] = entry;
    const key = target.replaceAll('-', '_');
    const linker = join(bin, `${clangTarget}28-clang${suffix}`);
    build(target, output, {
      ...process.env,
      [`CARGO_TARGET_${key.toUpperCase()}_LINKER`]: linker,
      [`CC_${key}`]: linker,
      [`AR_${key}`]: join(bin, process.platform === 'win32' ? 'llvm-ar.exe' : 'llvm-ar'),
      [`CARGO_TARGET_${key.toUpperCase()}_RUSTFLAGS`]: '-C link-arg=-Wl,-z,max-page-size=16384',
    });
    const destination = join(native, 'android/src/main/jniLibs', abi);
    mkdirSync(destination, { recursive: true });
    copyFileSync(join(output, target, 'release/libfolio_ffi.so'), join(destination, 'libfolio_ffi.so'));
  }
}

function ios() {
  if (process.platform !== 'darwin') throw new Error('iOS 打包需要 macOS 与 Xcode');
  const generated = join(native, 'ios/generated');
  if (!existsSync(join(generated, 'module.modulemap'))) throw new Error('请先运行 pnpm bindings');
  const output = join(project, '.build/rust-ios');
  const libraries = [];
  const targets = argumentsAfterCommand.includes('--simulator-only')
    ? [['aarch64-apple-ios-sim', 'iphonesimulator']]
    : [['aarch64-apple-ios', 'iphoneos'], ['aarch64-apple-ios-sim', 'iphonesimulator']];
  for (const [target, sdk] of targets) {
    const env = { ...process.env,
      SDKROOT: execFileSync('xcrun', ['--sdk', sdk, '--show-sdk-path'], { encoding: 'utf8' }).trim(),
      IPHONEOS_DEPLOYMENT_TARGET: '16.4',
    };
    delete env.MACOSX_DEPLOYMENT_TARGET;
    build(target, output, env);
    libraries.push('-library', join(output, target, 'release/libfolio_ffi.a'), '-headers', generated);
  }
  const frameworks = join(native, 'ios/Frameworks');
  mkdirSync(frameworks, { recursive: true });
  const framework = join(frameworks, 'FolioFFI.xcframework');
  rmSync(framework, { recursive: true, force: true });
  run('xcodebuild', ['-create-xcframework', ...libraries, '-output', framework]);
}

try {
  if (command === 'bindings') bindings();
  else if (command === 'android') android();
  else if (command === 'ios') ios();
  else throw new Error('用法：build-rust.mjs bindings | android [ABI…] | ios [--simulator-only]');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
