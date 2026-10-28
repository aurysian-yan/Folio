import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { androidOutputs } from './android.mjs';
import { stage, verifyVersions } from './release.mjs';

const [directory, output] = process.argv.slice(2);
if (!directory || !output) throw new Error('用法：stage-android.mjs apk-directory output');
const packages = androidOutputs(directory, verifyVersions(), process.env.FOLIO_BUILD_NUMBER);
const temporary = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'folio-android-'));
try {
  for (const { variant, arch, file } of packages) {
    const input = join(temporary, `${variant}-${arch}`); mkdirSync(input);
    copyFileSync(file, join(input, basename(file)));
    execFileSync(process.execPath, [fileURLToPath(new URL('./check-native.mjs', import.meta.url)), 'android', input, arch, variant], { stdio: 'inherit' });
    stage('android', arch, input, output, variant);
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
