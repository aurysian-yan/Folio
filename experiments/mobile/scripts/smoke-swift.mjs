import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('Swift 主机冒烟验证需要 macOS');
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(project, '../..');
const generated = join(project, 'modules/folio-native/ios/generated');
const output = join(project, '.build/host-smoke');
mkdirSync(dirname(output), { recursive: true });
const zipSources = join(project, 'ios/Pods/ZIPFoundation/Sources/ZIPFoundation');
if (!existsSync(zipSources)) throw new Error('请先执行 pnpm pods 安装 ZIPFoundation 0.9.20');
const libraries = join(project, '.build/host-libraries');
mkdirSync(libraries, { recursive: true });
execFileSync('swiftc', ['-swift-version', '5', '-module-name', 'ZIPFoundation', '-emit-library', '-emit-module',
  ...readdirSync(zipSources).filter((name) => name.endsWith('.swift')).map((name) => join(zipSources, name)),
  '-emit-module-path', join(libraries, 'ZIPFoundation.swiftmodule'), '-o', join(libraries, 'libZIPFoundation.dylib')],
{ cwd: project, stdio: 'inherit' });
execFileSync('swiftc', ['-I', generated, '-I', libraries, '-L', libraries, '-lZIPFoundation',
  '-L', join(repository, 'target/debug'), '-lfolio_ffi', join(generated, 'folio_ffi.swift'),
  join(project, 'modules/folio-native/ios/src/FolioFontImporter.swift'),
  join(project, 'modules/folio-native/ios/src/FolioLibraryMapper.swift'),
  join(project, 'tests/SwiftLibrarySmoke.swift'),
  join(project, 'tests/SwiftImportSmoke.swift'), join(project, 'tests/SwiftSmoke.swift'), '-o', output],
{ cwd: project, stdio: 'inherit' });
execFileSync(output, [join(project, 'samples')], {
  stdio: 'inherit', env: { ...process.env, DYLD_LIBRARY_PATH: [join(repository, 'target/debug'), libraries].join(':') },
});
