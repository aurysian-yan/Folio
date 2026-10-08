import { locallyAvailable } from "../../../shared/font-location";
import { loadPreviewFont, renderPreviews } from "./api";
import i18n from "./i18n";
import { PreviewCache, PreviewScheduler, type PreviewPriority } from "./preview-cache";
import { subscribePreviewCache } from "./preview-cache-events";
import { startMetric } from "./performance-metrics";
import type { FaceDto, FamilyDto, PreviewFontDto } from "./types";

export interface PreviewStyle {
  key: string;
  name: string;
  face: FaceDto;
  coordinates: Record<string, number>;
}

export function preferredFace(family: FamilyDto) {
  const matches = family.faces.filter((face) => family.matchedFaceIds.includes(face.id));
  const candidates = matches.length > 0 ? matches : family.faces;
  const local = candidates.filter(locallyAvailable);
  const faces = local.length > 0 ? local : candidates;
  return faces.find((face) => /^(regular|normal|常规)$/i.test(face.styleName)) ??
    faces.reduce<FaceDto | undefined>((nearest, face) =>
      !nearest || Math.abs((face.weight ?? 400) - 400) < Math.abs((nearest.weight ?? 400) - 400)
        ? face : nearest, undefined);
}

const styleCache = new WeakMap<FamilyDto, PreviewStyle[]>();

export function previewStyles(family: FamilyDto): PreviewStyle[] {
  const cached = styleCache.get(family);
  if (cached) return cached;
  const styles = family.faces.flatMap((face) => {
    const defaults = Object.fromEntries(face.variableAxes.map((axis) => [axis.tag, axis.defaultValue]));
    return [
      { key: face.id, name: face.styleName, face, coordinates: defaults },
      ...face.namedInstances.flatMap((instance, index) =>
        Object.entries(instance.coordinates).every(([tag, value]) => defaults[tag] === value) ? [] : [{
          key: `${face.id}:${index}`, name: instance.name, face, coordinates: instance.coordinates,
        }]),
    ];
  }).sort((a, b) => (a.coordinates.wght ?? a.face.weight ?? 400) - (b.coordinates.wght ?? b.face.weight ?? 400));
  styleCache.set(family, styles);
  return styles;
}

export function currentPreviewStyle(family: FamilyDto, key?: string | null) {
  const styles = previewStyles(family);
  const chosen = styles.find((style) => style.key === key);
  if (chosen) return chosen;
  const preferredId = preferredFace(family)?.id;
  return styles.find((style) => style.key === preferredId) ?? styles[0];
}

export type PreviewFont = { family: string; font: FontFace; coverage: PreviewFontDto["coverage"]; sample: string };
const scheduler = new PreviewScheduler();
const cache = new PreviewCache<PreviewFont>(scheduler, 128 * 1024 * 1024, 64, ({ font }) => { document.fonts.delete(font); });
const images = new PreviewCache<string | null>(scheduler, 32 * 1024 * 1024, 256, () => {});
const browserRejected = new Set<string>();
let sequence = 0;
subscribePreviewCache(() => { cache.invalidate(); images.invalidate(); browserRejected.clear(); });

export function acquirePreviewFont(face: FaceDto, priority: PreviewPriority = "visible") {
  return cache.acquire(face.id, priority, async (wanted) => {
    if (browserRejected.has(face.id)) throw new Error(i18n.t("preview.nativePreview"));
    const source = await loadPreviewFont(face.id);
    if (!wanted()) throw new DOMException(i18n.t("preview.requestCancelled"), "AbortError");
    const family = `folio-preview-${++sequence}`;
    const axis = face.variableAxes.find((axis) => axis.tag === "wght");
    const finish = startMetric("font-face-load");
    let font: FontFace;
    try {
      font = new FontFace(family, source.bytes, {
        weight: axis ? `${axis.minValue} ${axis.maxValue}` : String(face.weight ?? 400),
      });
      await font.load();
    } catch (error) {
      browserRejected.add(face.id);
      if (browserRejected.size > 64) browserRejected.delete(browserRejected.values().next().value!);
      throw error;
    } finally { finish(); }
    if (!wanted()) throw new DOMException(i18n.t("preview.requestCancelled"), "AbortError");
    document.fonts.add(font);
    return { value: { family, font, coverage: source.coverage, sample: source.sample }, bytes: source.bytes.byteLength };
  });
}

export function acquireNativePreview(faceId: string, sample: string, size: number, priority: PreviewPriority) {
  return images.acquire(JSON.stringify([faceId, sample, size]), priority, async () => {
    const [preview] = await renderPreviews([faceId], sample, size);
    const image = preview?.dataUrl ?? null;
    return { value: image, bytes: (image?.length ?? 0) * 2 };
  });
}

export function previewCacheStats() { return { fonts: cache.snapshot(), images: images.snapshot() }; }

export function coversCodepoint(coverage: PreviewFontDto["coverage"], codepoint: number) {
  let low = 0;
  let high = coverage.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const [start, end] = coverage[middle];
    if (codepoint < start) high = middle - 1;
    else if (codepoint > end) low = middle + 1;
    else return true;
  }
  return false;
}
