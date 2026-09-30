import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = resolve(project, '../../fixtures/fonts');
const output = join(project, 'samples');
mkdirSync(join(output, 'licenses'), { recursive: true });
const files = ['Lato-Regular.ttf', 'Lato-Bold.ttf', 'SourceSerif4-Regular.otf', 'Inter-Variable.ttf', 'not-a-font.ttf'];
for (const file of files) copyFileSync(join(fixtures, file), join(output, file));
for (const license of ['Lato-OFL.txt', 'Inter-OFL.txt', 'SourceSerif-OFL.txt']) {
  copyFileSync(join(fixtures, 'licenses', license), join(output, 'licenses', license));
}

// 按核心测试的集合规则重定位表偏移，保留原字体名称和轮廓。
const fonts = ['Lato-Regular.ttf', 'Lato-Bold.ttf'].map((name) => readFileSync(join(fixtures, name)));
const header = Buffer.alloc(12 + fonts.length * 4);
header.write('ttcf');
header.writeUInt32BE(0x00010000, 4);
header.writeUInt32BE(fonts.length, 8);
const parts = [header];
let base = header.length;
for (const [index, original] of fonts.entries()) {
  header.writeUInt32BE(base, 12 + index * 4);
  const font = Buffer.from(original);
  for (let table = 0; table < font.readUInt16BE(4); table++) {
    const record = 12 + table * 16;
    const offset = font.readUInt32BE(record + 8);
    if (font.toString('ascii', record, record + 4) === 'head') font.fill(0, offset + 8, offset + 12);
    font.writeUInt32BE(offset + base, record + 8);
  }
  parts.push(font);
  base += font.length;
  const padding = (4 - base % 4) % 4;
  parts.push(Buffer.alloc(padding));
  base += padding;
}
writeFileSync(join(output, 'Lato-Collection.ttc'), Buffer.concat(parts));
files.push('Lato-Collection.ttc');
const manifest = files.map((name) => ({
  name, sha256: createHash('sha256').update(readFileSync(join(output, name))).digest('hex'),
}));
writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`已生成 ${files.length} 个测试样本及许可：${output}`);
