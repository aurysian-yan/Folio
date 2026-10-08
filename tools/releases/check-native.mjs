import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const [platform, directory, arch] = process.argv.slice(2);
const fail = (message) => { throw new Error(message); };
if (platform === 'macos') {
  const embedded = readFileSync(join(directory,'Contents/Resources/About/licenses.json'));
  const expected = readFileSync('shared/about/licenses.json');
  if (!embedded.equals(expected)) fail('macOS 许可资料缺失或过期');
  execFileSync('codesign',['--verify','--deep','--strict',directory],{stdio:'inherit'});
  const arch = execFileSync('lipo',['-archs',join(directory,'Contents/MacOS/Folio')],{encoding:'utf8'}).trim();
  if (arch !== 'arm64') fail('macOS 包必须仅包含 arm64');
} else if (platform === 'windows' || platform === 'linux') {
  const binary = readFileSync(join(directory, platform === 'windows' ? 'folio-desktop.exe' : 'folio-desktop'));
  if (platform === 'windows') {
    const header = binary.readUInt32LE(0x3c);
    if (binary.subarray(header,header+4).toString() !== 'PE\0\0' || binary.readUInt16LE(header+4) !== (arch === 'arm64' ? 0xaa64 : 0x8664)) fail('Windows 应用架构错误');
  } else if (binary.readUInt16LE(18) !== (arch === 'arm64' ? 183 : 62)) fail('Linux 应用架构错误');
  const catalog = readFileSync('shared/about/licenses.json');
  if (!binary.includes(catalog)) fail('桌面原生许可目录缺失或过期');
  const id = JSON.parse(catalog).entries.find((entry) => entry.name === 'Folio').id;
  const assets = 'apps/desktop-ui/dist/assets';
  if (!readdirSync(assets).filter((name) => name.endsWith('.js')).some((name) => readFileSync(join(assets,name)).includes(Buffer.from(id)))) fail('桌面页面未包含离线许可目录');
} else if (platform === 'android') {
  const files = readdirSync(directory).filter((file) => file.endsWith('.apk'));
  if (files.length !== 1) fail('Android 产物数量错误');
  const apk = join(directory,files[0]);
  const python = `import sys,zipfile,json\nz=zipfile.ZipFile(sys.argv[1])\nabis={p.split('/')[1] for p in z.namelist() if p.startswith('lib/') and p.endswith('.so')}\nassert abis=={'arm64-v8a','x86_64'},abis\nfor abi in abis: assert 'lib/'+abi+'/libfolio_ffi.so' in z.namelist()\nbundle=z.read('assets/index.android.bundle')\ncatalog=json.load(open('shared/about/licenses.json'))\nfor entry in catalog['entries']: assert entry['id'].encode() in bundle,'APK 许可目录缺失或过期: '+entry['name']\nfor key in catalog['texts']: assert key.encode() in bundle,'APK 许可原文缺失'\n`;
  execFileSync('python3',['-c',python,apk],{stdio:'inherit'});
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk) fail('未配置 Android SDK');
  const metadata = execFileSync(join(sdk,'build-tools/36.0.0/aapt2'),['dump','badging',apk],{encoding:'utf8'});
  const identity = /package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/.exec(metadata);
  const version = JSON.parse(readFileSync('experiments/mobile/package.json')).version;
  if (!identity || identity[1] !== 'com.folio.mobile.poc' || identity[3] !== version || process.env.FOLIO_BUILD_NUMBER && identity[2] !== process.env.FOLIO_BUILD_NUMBER) fail('Android 应用身份或版本不一致');
  const verified = spawnSync(join(sdk,'build-tools/36.0.0/apksigner'),['verify','--print-certs',apk],{encoding:'utf8'});
  if (verified.error || verified.status !== 0 && process.env.FOLIO_BUILD_ONLY !== '1') fail('APK 签名验证失败');
  const signing = verified.stdout ?? '';
  if (/CN=Android Debug/i.test(signing)) fail('禁止发布调试签名 APK');
  if (process.env.FOLIO_BUILD_ONLY !== '1') {
    const expected = execFileSync('keytool',['-list','-v','-keystore',process.env.FOLIO_KEYSTORE_PATH,'-alias',process.env.FOLIO_KEY_ALIAS,'-storepass:env','FOLIO_KEYSTORE_PASSWORD'],{encoding:'utf8'});
    const expectedHash = /SHA256:\s*([A-F0-9:]+)/i.exec(expected)?.[1]?.replaceAll(':','').toLowerCase();
    const actualHash = /certificate SHA-256 digest:\s*([a-f0-9]+)/i.exec(signing)?.[1]?.toLowerCase();
    if (!expectedHash || expectedHash !== actualHash) fail('APK 签名与固定发布密钥不一致');
  }
} else fail('未知原生产物类型');
console.log(`${platform} 原生产物与许可检查通过`);
