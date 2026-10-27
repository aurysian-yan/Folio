import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateNotes } from './notes.mjs';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');
const version = /^version\s*=\s*"([^"]+)"/m.exec(read('Cargo.toml').split('[workspace.package]')[1] ?? '')?.[1];
const assert = (value, message) => { if (!value) throw new Error(message); };
export const targets = [
  ['macos','arm64',['dmg']], ['windows','x64',['exe']], ['windows','arm64',['exe']],
  ['linux','x64',['AppImage','deb','rpm']], ['linux','arm64',['AppImage','deb','rpm']],
  ['android','arm64',['apk']], ['android','x64',['apk']],
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
export function aggregate(directory, output, notesFile, previousManifestFile) {
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
  if (notesFile) manifest.releaseNotes = validateNotes(JSON.parse(readFileSync(notesFile, 'utf8')));
  if (previousManifestFile) {
    const previous = JSON.parse(readFileSync(previousManifestFile, 'utf8'));
    assert(previous.version === version && JSON.stringify(previous.artifacts) === JSON.stringify(artifacts)
      && JSON.stringify(previous.releaseNotes) === JSON.stringify(manifest.releaseNotes), '草稿清单与本次安装包不一致，请重跑原工作流的失败任务');
    manifest.publishedAt = previous.publishedAt;
  }
  writeFileSync(join(output,'folio-release.json'),JSON.stringify(manifest,null,2)+'\n');
  files.push('folio-release.json');
  writeFileSync(join(output,'SHA256SUMS.txt'),files.sort().map((name) => `${createHash('sha256').update(readFileSync(join(output,name))).digest('hex')}  ${name}`).join('\n')+'\n');
  return manifest;
}
export function verifyRelease(directory) {
  const names = targets.flatMap(([platform,arch,formats]) => formats.map((format) => `Folio-v${version}-${platform}-${arch}.${format}`));
  names.push('folio-licenses.json','LICENSE.txt','folio-release.json','SHA256SUMS.txt');
  const files = readdirSync(directory);
  assert(files.length === names.length && names.every((name) => files.includes(name) && statSync(join(directory,name)).isFile()), '发布附件不完整或包含额外文件');
  const checksum = (name) => createHash('sha256').update(readFileSync(join(directory,name))).digest('hex');
  const expected = names.filter((name) => name !== 'SHA256SUMS.txt').sort().map((name) => `${checksum(name)}  ${name}`).join('\n')+'\n';
  assert(readFileSync(join(directory,'SHA256SUMS.txt'),'utf8') === expected, '发布附件校验值不一致');
  const manifest = JSON.parse(readFileSync(join(directory,'folio-release.json'),'utf8'));
  if (manifest.releaseNotes !== undefined) validateNotes(manifest.releaseNotes);
  assert(manifest.schemaVersion === 1 && manifest.version === version && manifest.releaseUrl === `https://github.com/aurysian-yan/Folio/releases/tag/v${version}`, '发布清单版本或来源错误');
  const artifacts = targets.flatMap(([platform,arch,formats]) => formats.map((format) => ({platform,arch,format})));
  assert(Array.isArray(manifest.artifacts) && manifest.artifacts.length === artifacts.length, '发布清单矩阵不完整');
  for (const {platform,arch,format} of artifacts) {
    const name = `Folio-v${version}-${platform}-${arch}.${format}`;
    const matches = manifest.artifacts.filter((item) => item.platform === platform && item.arch === arch && item.format === format);
    assert(matches.length === 1, `发布清单产物重复或缺失：${name}`);
    const item = matches[0]; const size = statSync(join(directory,name)).size;
    assert(size > 0 && item.size === size && item.sha256 === checksum(name) && item.url === `https://github.com/aurysian-yan/Folio/releases/download/v${version}/${name}`, `发布清单与附件不一致：${name}`);
  }
  assert(readFileSync(join(directory,'folio-licenses.json')).equals(readFileSync(join(root,'shared/about/licenses.json'))), '发布许可目录不一致');
  assert(readFileSync(join(directory,'LICENSE.txt')).equals(readFileSync(join(root,'LICENSE'))), '发布许可原文不一致');
  return names;
}
export function publish(directory, { env = process.env, exec = execFileSync } = {}) {
  assert(env.GITHUB_REF_NAME, '缺少发布标签');
  verifyVersions(env.GITHUB_REF_NAME);
  assert(env.GITHUB_REPOSITORY === 'aurysian-yan/Folio', '只能发布到登记的项目');
  assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? ''), '缺少发布提交');
  const files = verifyRelease(directory).map((name) => join(directory,name));
  const repository = env.GITHUB_REPOSITORY; const tag = `v${version}`;
  const marker = `<!-- folio-release:${env.GITHUB_SHA} -->`;
  const manifest = JSON.parse(readFileSync(join(directory, 'folio-release.json'), 'utf8'));
  const releaseNotes = manifest.releaseNotes ? validateNotes(manifest.releaseNotes) : undefined;
  const notesBody = releaseNotes ? `## 中文\n\n${releaseNotes['zh-CN']}\n\n## English\n\n${releaseNotes.en}\n\n` : '';
  const notesData = releaseNotes ? `\n<!-- folio-notes:start -->\n${JSON.stringify(releaseNotes).replaceAll('-->', '--\\u003e')}\n<!-- folio-notes:end -->\n` : '';
  // 草稿无法按标签查询，改为分页列出全部发行版后定位；同一提交的失败草稿可重试，正式版禁止覆盖。
  const list = () => {
    let pages;
    try { pages = JSON.parse(exec('gh',['api','--paginate','--slurp',`repos/${repository}/releases?per_page=100`],{encoding:'utf8',stdio:['ignore','pipe','pipe']})); }
    catch { throw new Error('无法确认发行版状态，已停止发布'); }
    return pages.flat();
  };
  const existing = list().filter((release) => release.tag_name === tag);
  assert(!existing.some((release) => !release.draft), '正式发行版已存在，禁止覆盖');
  assert(existing.length <= 1, '同名草稿数量异常，禁止覆盖');
  if (existing.length) {
    const draft = existing[0];
    // 不带 --target 创建草稿时 target_commitish 为默认分支名，改用发布提交标记确认归属。
    assert(draft.body?.includes(marker), '同名草稿不属于当前发布提交，禁止覆盖');
    if (releaseNotes) assert(draft.body.includes(notesBody) && draft.body.includes(notesData), '草稿日志与清单不一致，禁止覆盖');
    assert(draft.assets.every((asset) => files.some((file) => basename(file) === asset.name)), '同名草稿含有未知附件，禁止覆盖');
  } else {
    const notes = `Folio ${version}\n\n${notesBody}安装方式、Android 签名与桌面系统验证提示见 [发布说明](https://github.com/aurysian-yan/Folio/blob/v${version}/docs/releases.md)。\n\nSHA-256 校验值见 SHA256SUMS.txt；完整开源许可见 folio-licenses.json。\n\n${marker}\n${notesData}`;
    // 标签已存在，不再传 --target，避免默认令牌被要求额外的 workflows 权限。
    exec('gh',['release','create',tag,'--repo',repository,'--verify-tag','--draft','--title',`Folio ${version}`,'--notes-file','-'],{stdio:['pipe','inherit','inherit'],input:notes});
  }
  exec('gh',['release','upload',tag,'--repo',repository,'--clobber',...files],{stdio:'inherit'});
  const uploaded = list().filter((release) => release.tag_name === tag);
  assert(uploaded.length === 1 && uploaded[0].draft, '无法确认发布草稿');
  const draft = uploaded[0];
  assert(files.length === draft.assets.length && files.every((file) => draft.assets.some((asset) => asset.name === basename(file) && asset.size === statSync(file).size && asset.digest === `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`)), '上传产物不完整');
  const published = JSON.parse(exec('gh',['api','-X','PATCH',`repos/${repository}/releases/${draft.id}`,'-F','draft=false'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  assert(published.draft === false && published.tag_name === tag, '发行版公开失败');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode,...args] = process.argv.slice(2);
  if (mode === 'verify') console.log(verifyVersions(args[0]));
  else if (mode === 'stage') stage(...args);
  else if (mode === 'aggregate') {
    const previous = args[2] ? join(resolve(args[2], '..'), 'previous-manifest.json') : undefined;
    console.log(JSON.stringify(aggregate(args[0], args[1], args[2], previous && existsSync(previous) ? previous : undefined),null,2));
  }
  else if (mode === 'publish') publish(args[0]);
  else throw new Error('用法：release.mjs verify [tag] | stage platform arch input output | aggregate input output | publish output');
}
