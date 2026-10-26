import type { OnlineEntry } from './online';

export type ImportSelection = 'variable' | 'static' | 'all' | 'none';
export interface ImportFamily { id: string; name: string; entries: OnlineEntry[] }

export function isVariableEntry(entry: OnlineEntry): boolean {
  return entry.analysis?.faces.some((face) => face.isVariable) ?? false;
}

export function importSelection(entries: OnlineEntry[], kind: ImportSelection): string[] {
  return entries.filter((entry) => entry.eligible && !entry.duplicate && kind !== 'none'
    && (kind === 'all' || isVariableEntry(entry) === (kind === 'variable'))).map((entry) => entry.id);
}

// 集合文件保持整文件选择，同一字族的不同字重按元数据归类。
export function importFamilies(entries: OnlineEntry[]): ImportFamily[] {
  const groups = new Map<string, ImportFamily>();
  for (const entry of entries) {
    const names = [...new Set(entry.analysis?.faces.map((face) => face.family?.trim()).filter((name): name is string => !!name) ?? [])].sort();
    const name = names.join(' / ') || entry.name.split('/').at(-1) || entry.name;
    const id = JSON.stringify(names.length ? names.map((value) => value.normalize('NFKC').toLowerCase()) : [entry.id]);
    const group = groups.get(id) ?? { id, name, entries: [] };
    group.entries.push(entry); groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)).map((group) => ({ ...group,
    entries: group.entries.sort((a, b) => Number(isVariableEntry(b)) - Number(isVariableEntry(a))
      || (a.analysis?.faces[0]?.weight ?? 400) - (b.analysis?.faces[0]?.weight ?? 400) || a.name.localeCompare(b.name)),
  }));
}
