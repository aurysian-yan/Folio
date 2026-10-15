import type { FontFace } from './library';

// 网格宽度扣除页面缩进和格间距，始终保留完整字符格。
export function characterGridLayout(width: number) {
  const available = Math.max(0, width - 24);
  const columns = Math.max(2, Math.floor((available + 8) / 88));
  return { columns, cellWidth: Math.max(0, (available - (columns - 1) * 8) / columns) };
}

// 收起高度覆盖摘要，展开不超过标题下可用区域的七成。
export function characterSheetLayout(summary: number, controls: number, height: number, top: number, bottom: number) {
  const maximum = Math.max(44, (height - top - bottom) * 0.7);
  const collapsed = Math.min(maximum, summary + 24);
  const expanded = Math.min(maximum, collapsed + controls + 16);
  return { collapsed, snapPoints: expanded > collapsed + 1 ? [collapsed, expanded] : [collapsed] };
}

// 来源名称不改变路径值，重名只补充区分所需的末级目录。
export function fontSourceOptions(face: FontFace, t: (key: string) => string) {
  const local = face.location?.files.flatMap((file) => file.localSources) ?? [];
  const paths = [...new Set([face.sourcePath, ...local.map((item) => item.path)].filter((path): path is string => !!path))];
  return paths.map((path) => {
    const parts = path.split(/[\\/]/).filter(Boolean);
    const filename = parts.at(-1) ?? path;
    const peers = paths.filter((other) => other !== path && other.split(/[\\/]/).at(-1) === filename);
    let depth = 1;
    while (depth < parts.length && peers.some((other) => other.split(/[\\/]/).filter(Boolean).slice(-depth).join('/') === parts.slice(-depth).join('/'))) depth++;
    const kind = local.find((item) => item.path === path)?.kind ?? 'managed';
    const source = ['managed', 'installed', 'system', 'reference'].includes(kind) ? t(`fontLocation.source.${kind}`) : t('inspector.source');
    return { value: path, label: `${parts.slice(-depth).join('/')} · ${source}` };
  });
}
