// 复用生产构建的共享服务及扩展，仅生成隔离模拟器验证宿主。
import {execFileSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../..');
const mobile = join(root, 'experiments/mobile');
const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], {
  encoding: 'utf8',
}).trim();
const compileOptions = {stdio: 'inherit', env: {...process.env, SDKROOT: sdk}};

if (process.argv.includes('--caller')) {
  const app = join(mobile, '.build/file-workflows/FolioFileCaller.app');
  mkdirSync(app, {recursive: true});
  const info = {
    CFBundleIdentifier: 'com.folio.filecaller',
    CFBundleExecutable: 'FolioFileCaller',
    CFBundleName: 'FolioFileCaller',
    CFBundlePackageType: 'APPL',
    CFBundleVersion: '1',
    CFBundleShortVersionString: '1.0',
    UIDeviceFamily: [1, 2],
    LSRequiresIPhoneOS: true,
    MinimumOSVersion: '16.4',
    UILaunchScreen: {},
    UIApplicationSceneManifest: {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{
          UISceneClassName: 'UIWindowScene',
          UISceneDelegateClassName: 'FolioFileCaller.FileCallerScene',
          UISceneConfigurationName: 'FolioFileCaller',
        }],
      },
    },
  };
  writeFileSync(join(app, 'Info.plist'), JSON.stringify(info));
  execFileSync('plutil', ['-convert', 'xml1', join(app, 'Info.plist')]);
  cpSync(join(mobile, 'samples/Lato-Regular.ttf'), join(app, 'Lato-Regular.ttf'));
  const main = join(dirname(app), 'caller.swift');
  cpSync(join(directory, 'CallerApp.swift'), main);
  execFileSync('xcrun', [
    'swiftc', '-swift-version', '5', '-target', 'arm64-apple-ios16.4-simulator',
    '-sdk', sdk, main, '-framework', 'UIKit', '-o', join(app, 'FolioFileCaller'),
  ], compileOptions);
  execFileSync('codesign', ['--force', '--sign', '-', app], {stdio: 'inherit'});
  console.log(app);
  process.exit(0);
}

const products = join(mobile, '.build/ios-derived/Build/Products/Release-iphonesimulator');
const app = join(mobile, '.build/file-workflows/FolioFileSmoke.app');
mkdirSync(app, {recursive: true});
const identity = 'com.folio.mobile.poc.dev';
const info = {
  CFBundleIdentifier: identity,
  CFBundleExecutable: 'FolioFileSmoke',
  CFBundleName: 'Folio',
  CFBundleDisplayName: 'Folio',
  CFBundlePackageType: 'APPL',
  CFBundleVersion: '1',
  CFBundleShortVersionString: '1.1.0',
  UIDeviceFamily: [1, 2],
  LSRequiresIPhoneOS: true,
  MinimumOSVersion: '16.4',
  FolioApplicationIdentifier: identity,
  UILaunchScreen: {},
  UIApplicationSceneManifest: {
    UIApplicationSupportsMultipleScenes: true,
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [{
        UISceneClassName: 'UIWindowScene',
        UISceneDelegateClassName: 'FolioFileSmoke.FileSmokeScene',
        UISceneConfigurationName: 'Folio',
      }],
    },
  },
  UIFileSharingEnabled: true,
  LSSupportsOpeningDocumentsInPlace: true,
};
writeFileSync(join(app, 'Info.plist'), JSON.stringify(info));
execFileSync('plutil', ['-convert', 'xml1', join(app, 'Info.plist')]);
for (const name of ['FolioFiles', 'FolioShare']) {
  cpSync(join(products, `${name}.appex`), join(app, 'PlugIns', `${name}.appex`), {
    recursive: true,
  });
}
cpSync(join(mobile, 'samples/Lato-Regular.ttf'), join(app, 'Lato-Regular.ttf'));
const strings = join(products, 'FolioFileServices/FolioFileStrings.bundle');
if (existsSync(strings)) {
  cpSync(strings, join(app, 'FolioFileStrings.bundle'), {recursive: true});
}
const main = join(dirname(app), 'main.swift');
cpSync(join(directory, 'SmokeApp.swift'), main);
const entitlements = join(dirname(app), 'test.entitlements');
cpSync(join(mobile,
  '.build/ios-derived/Build/Intermediates.noindex/FolioDev.build/Release-iphonesimulator/FolioDev.build/FolioDev.app-Simulated.xcent',
), entitlements);
execFileSync('xcrun', [
  'swiftc', '-swift-version', '5', '-target', 'arm64-apple-ios16.4-simulator',
  '-sdk', sdk,
  '-I', join(products, 'FolioFileServices'),
  '-I', join(mobile, 'modules/folio-native/ios/generated'),
  '-L', join(products, 'FolioFileServices'), '-lFolioFileServices',
  '-Xcc', `-fmodule-map-file=${join(mobile, 'ios/Pods/Headers/Public/FolioFileServices/FolioFileServices.modulemap')}`,
  '-I', join(mobile, 'ios/Pods/Headers/Public/FolioFileServices'),
  main, join(mobile, 'modules/folio-native/ios/extensions/FolioFileProvider.swift'),
  join(products, 'XCFrameworkIntermediates/FolioFileServices/libfolio_ffi.a'),
  '-framework', 'UIKit', '-framework', 'FileProvider', '-framework', 'Security',
  '-framework', 'SystemConfiguration', '-framework', 'CoreFoundation',
  '-lsqlite3', '-liconv', '-lz',
  '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__entitlements',
  '-Xlinker', entitlements, '-o', join(app, 'FolioFileSmoke'),
], compileOptions);
execFileSync('codesign', ['--force', '--sign', '-', app], {stdio: 'inherit'});
console.log(app);
