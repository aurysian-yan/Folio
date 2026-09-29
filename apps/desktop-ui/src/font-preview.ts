import { loadPreviewFont } from "./api";
import type { FaceDto, FamilyDto, PreviewFontDto } from "./types";

export interface PreviewStyle {
  key: string;
  name: string;
  face: FaceDto;
  coordinates: Record<string, number>;
}

export function preferredFace(family: FamilyDto) {
  const matches = family.faces.filter((face) => family.matchedFaceIds.includes(face.id));
  const faces = matches.length > 0 ? matches : family.faces;
  return faces.find((face) => /^(regular|normal|常规)$/i.test(face.styleName)) ??
    faces.reduce<FaceDto | undefined>((nearest, face) =>
      !nearest || Math.abs((face.weight ?? 400) - 400) < Math.abs((nearest.weight ?? 400) - 400)
        ? face : nearest, undefined);
}

export function previewStyles(family: FamilyDto): PreviewStyle[] {
  return family.faces.flatMap((face) => {
    const defaults = Object.fromEntries(face.variableAxes.map((axis) => [axis.tag, axis.defaultValue]));
    return [
      { key: face.id, name: face.styleName, face, coordinates: defaults },
      ...face.namedInstances.flatMap((instance, index) =>
        Object.entries(instance.coordinates).every(([tag, value]) => defaults[tag] === value) ? [] : [{
          key: `${face.id}:${index}`, name: instance.name, face, coordinates: instance.coordinates,
        }]),
    ];
  }).sort((a, b) => (a.coordinates.wght ?? a.face.weight ?? 400) - (b.coordinates.wght ?? b.face.weight ?? 400));
}

export function currentPreviewStyle(family: FamilyDto, key?: string | null) {
  const styles = previewStyles(family);
  return styles.find((style) => style.key === key) ??
    styles.find((style) => style.key === preferredFace(family)?.id) ?? styles[0];
}

export type PreviewFont = { family: string; font: FontFace; coverage: PreviewFontDto["coverage"]; sample: string };
type CacheEntry = { promise: Promise<PreviewFont>; users: number; usedAt: number; font?: FontFace };
const cache = new Map<string, CacheEntry>();
const pending: (() => void)[] = [];
let loading = 0;
let sequence = 0;

async function scheduledLoad(face: FaceDto): Promise<PreviewFont> {
  if (loading >= 4) await new Promise<void>((resolve) => pending.push(resolve));
  loading += 1;
  try {
    const source = await loadPreviewFont(face.id);
    const family = `folio-preview-${++sequence}`;
    const axis = face.variableAxes.find((axis) => axis.tag === "wght");
    const font = new FontFace(family, `url("${source.dataUrl}")`, {
      weight: axis ? `${axis.minValue} ${axis.maxValue}` : String(face.weight ?? 400),
    });
    await font.load();
    document.fonts.add(font);
    return { family, font, coverage: source.coverage, sample: source.sample };
  } finally {
    loading -= 1;
    pending.shift()?.();
  }
}

function trimCache() {
  const unused = [...cache.entries()].filter(([, entry]) => entry.users === 0 && entry.font)
    .sort((a, b) => a[1].usedAt - b[1].usedAt);
  while (cache.size > 64 && unused.length) {
    const [id, entry] = unused.shift()!;
    document.fonts.delete(entry.font!);
    cache.delete(id);
  }
}

// 按可见卡片加载，同一字面共享字体；闲置缓存有界，避免重复传输大字体。
export function acquirePreviewFont(face: FaceDto) {
  let entry = cache.get(face.id);
  if (!entry) {
    const promise = scheduledLoad(face);
    entry = { promise, users: 0, usedAt: Date.now() };
    cache.set(face.id, entry);
    const created = entry;
    void promise.then(({ font }) => { created.font = font; trimCache(); }, () => {
      if (cache.get(face.id) === created) cache.delete(face.id);
    });
  }
  entry.users += 1;
  entry.usedAt = Date.now();
  const acquired = entry;
  return {
    promise: acquired.promise,
    release: () => { acquired.users -= 1; acquired.usedAt = Date.now(); trimCache(); },
  };
}
