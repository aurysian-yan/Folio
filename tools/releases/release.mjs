import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');
const version = /^version\s*=\s*"([^"]+)"/m.exec(read('Cargo.toml').split('[workspace.package]')[1] ?? '')?.[1];
const assert = (value, message) => { if (!value) throw new Error(message); };
export const targets = [
  ['macos','arm64',['dmg']], ['windows','x64',['exe']], ['windows','arm64',['exe']],
  ['linux','x64',['AppImage','deb','rpm']], ['linux','arm64',['AppImage','deb','rpm']], ['android','universal',['apk']],
];
const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
export function verifyVersions(tag) {
  assert(version && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), '仓库版本必须为正式语义版本');
  if (tag) assert(tag === `v${version}`, '标签与仓库版本不一致');
  for (const path of ['package.json','apps/desktop-ui/package.json','apps/desktop-ui/src-tauri/tauri.conf.json','experiments/mobile/package.json']) {
    const declared = JSON.parse(read(path)).version;
    if (path !== 'package.json') assert(declared === version, `${path} 版本不一致`);
  }
  assert(/^version\s*=\s*"([^"]+)"/m.exec(read('apps/desktop-ui/src-tauri/Cargo.toml'))?.[1] === version, 'Tauri 版本不一致');
  const marketing = [...read('apps/macos/Folio.xcodeproj/project.pbxproj').matchAll(/MARKETING_VERSION = ([^;]+);/g)];
  assert(marketing.length && marketing.every((match) => match[1] === version), 'macOS 工程版本不一致');
  assert(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(read('apps/macos/Folio/Info.plist'))?.[1] === version, 'macOS 应用版本不一致');
  return version;
}
export function stage(platform, arch, directory, output) {
  const target = targets.find(([p,a]) => p === platform && a === arch); assert(target, '未知构建目标'); verifyVersions();
  mkdirSync(output, { recursive: true });
  const files = walk(directory);
  for (const format of target[2]) {
    const matches = files.filter((file) => file.endsWith(`.${format}`));
    assert(matches.length === 1, `安装包数量错误：${platform}/${arch}/${format}，实际 ${matches.length}`);
    const file = matches[0]; assert(statSync(file).size > 0, '安装包为空');
    // 校验文件头，避免将日志或错误页面作为安装包发布。
    const bytes = readFileSync(file); const magic = bytes.subarray(0,4);
    if (format === 'exe') assert(magic.subarray(0,2).toString() === 'MZ', 'EXE 文件头错误');
    if (format === 'AppImage') { assert(bytes.readUInt16LE(18) === (arch === 'arm64' ? 183 : 62), 'AppImage 架构错误'); }
    if (format === 'AppImage') assert(magic.equals(Buffer.from([0x7f,0x45,0x4c,0x46])) && bytes.subarray(8,11).equals(Buffer.from([0x41,0x49,0x02])), 'AppImage 文件头错误');
    if (format === 'deb') assert(bytes.subarray(0,8).toString() === '!<arch>\n', 'deb 文件头错误');
    if (format === 'rpm') assert(magic.equals(Buffer.from([0xed,0xab,0xee,0xdb])), 'rpm 文件头错误');
    if (format === 'deb') assert(execFileSync('dpkg-deb',['-f',file,'Architecture'],{encoding:'utf8'}).trim() === (arch === 'arm64' ? 'arm64' : 'amd64'), 'deb 架构错误');
    if (format === 'rpm') assert(execFileSync('rpm',['-qp','--qf','%{ARCH}',file],{encoding:'utf8'}).trim() === (arch === 'arm64' ? 'aarch64' : 'x86_64'), 'rpm 架构错误');
    if (format === 'apk') assert(magic.subarray(0,2).toString() === 'PK', 'APK 文件头错误');
    if (format === 'dmg') assert(bytes.subarray(bytes.length-512,bytes.length-508).toString() === 'koly', 'DMG 文件尾错误');
    copyFileSync(file, join(output, `Folio-v${version}-${platform}-${arch}.${format}`));
  }
}
export function aggregate(directory, output) {
  verifyVersions(); mkdirSync(output, { recursive: true });
  const all = walk(directory); const artifacts = [];
  for (const [platform,arch,formats] of targets) for (const format of formats) {
    const name = `Folio-v${version}-${platform}-${arch}.${format}`; const files = all.filter((file) => basename(file) === name);
    assert(files.length === 1, `发布矩阵不完整或产物重复：${name}`);
    const bytes = readFileSync(files[0]); assert(bytes.length > 0, `空产物：${name}`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    copyFileSync(files[0], join(output, name));
    artifacts.push({ platform, arch, format, url: `https://github.com/aurysian-yan/Folio/releases/download/v${version}/${name}`, size: bytes.length, sha256 });
  }
  assert(all.filter((file) => /\.(dmg|exe|AppImage|deb|rpm|apk)$/.test(file)).length === artifacts.length, '存在矩阵以外的安装包');
  copyFileSync(join(root,'shared/about/licenses.json'),join(output,'folio-licenses.json'));
  copyFileSync(join(root,'LICENSE'),join(output,'LICENSE.txt'));
  const files = readdirSync(output).filter((file) => file !== 'SHA256SUMS.txt' && file !== 'folio-release.json');
  const manifest = { schemaVersion: 1, version, publishedAt: new Date().toISOString(), releaseUrl: `https://github.com/aurysian-yan/Folio/releases/tag/v${version}`, artifacts };
  writeFileSync(join(output,'folio-release.json'),JSON.stringify(manifest,null,2)+'\n');
  files.push('folio-release.json');
  writeFileSync(join(output,'SHA256SUMS.txt'),files.sort().map((name) => `${createHash('sha256').update(readFileSync(join(output,name))).digest('hex')}  ${name}`).join('\n')+'\n');
  return manifest;
}
function publish(directory) {
  verifyVersions(process.env.GITHUB_REF_NAME);
  assert(process.env.GITHUB_REPOSITORY === 'aurysian-yan/Folio', '只能发布到登记的项目');
  assert(existsSync(join(directory,'folio-release.json')), '发布清单不存在');
  const repository = process.env.GITHUB_REPOSITORY; const tag = `v${version}`;
  // 先建立草稿，上传完整产物后才公开；已有正式版本禁止覆盖。
  let existing;
  try { existing = JSON.parse(execFileSync('gh',['api',`repos/${repository}/releases/tags/${tag}`],{encoding:'utf8',stdio:['ignore','pipe','pipe']})); }
  catch (error) { if (!String(error.stderr).includes('404')) throw new Error('无法确认发行版状态，已停止发布'); }
  if (existing) assert(existing.draft, '正式发行版已存在，禁止覆盖');
  if (existing) throw new Error('存在同名草稿，请先检查并删除失败草稿后重试');
  const notes = join(directory,'release-notes.md');
  writeFileSync(notes,`Folio ${version}\n\n安装方式、Android 签名与桌面系统验证提示见 [发布说明](https://github.com/aurysian-yan/Folio/blob/v${version}/docs/releases.md)。\n\nSHA-256 校验值见 SHA256SUMS.txt；完整开源许可见 folio-licenses.json。\n`);
  execFileSync('gh',['release','create',tag,'--repo',repository,'--verify-tag','--draft','--title',`Folio ${version}`,'--notes-file',notes],{stdio:'inherit'});
  const files = readdirSync(directory).filter((file) => file !== 'release-notes.md').map((file) => join(directory,file));
  execFileSync('gh',['release','upload',tag,'--repo',repository,...files],{stdio:'inherit'});
  const uploaded = JSON.parse(execFileSync('gh',['api',`repos/${repository}/releases/tags/${tag}`],{encoding:'utf8'}));
  assert(files.length === uploaded.assets.length && files.every((file) => uploaded.assets.some((asset) => asset.name === basename(file) && asset.size === statSync(file).size && asset.digest === `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`)), '上传产物不完整');
  execFileSync('gh',['release','edit',tag,'--repo',repository,'--draft=false'],{stdio:'inherit'});
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode,...args] = process.argv.slice(2);
  if (mode === 'verify') console.log(verifyVersions(args[0]));
  else if (mode === 'stage') stage(...args);
  else if (mode === 'aggregate') console.log(JSON.stringify(aggregate(...args),null,2));
  else if (mode === 'publish') publish(args[0]);
  else throw new Error('用法：release.mjs verify [tag] | stage platform arch input output | aggregate input output | publish output');
}
