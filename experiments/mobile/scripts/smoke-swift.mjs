import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('Swift 主机冒烟验证需要 macOS');
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(project, '../..');
const generated = join(project, 'modules/folio-native/ios/generated');
const output = join(project, '.build/host-smoke');
mkdirSync(dirname(output), { recursive: true });
execFileSync('swiftc', ['-I', generated, '-L', join(repository, 'target/debug'), '-lfolio_ffi',
  join(generated, 'folio_ffi.swift'), join(project, 'tests/SwiftSmoke.swift'), '-o', output],
{ cwd: project, stdio: 'inherit' });
execFileSync(output, [join(project, 'samples')], {
  stdio: 'inherit', env: { ...process.env, DYLD_LIBRARY_PATH: join(repository, 'target/debug') },
});
