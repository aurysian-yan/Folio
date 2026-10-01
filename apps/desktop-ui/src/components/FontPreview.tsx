import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { acquireNativePreview, acquirePreviewFont, coversCodepoint, type PreviewFont, type PreviewStyle } from "../font-preview";
import type { PreviewPriority } from "../preview-cache";
import { previewCacheRevision, subscribePreviewCache } from "../preview-cache-events";
import { observePreviewVisibility } from "../preview-visibility";
import { startMetric } from "../performance-metrics";

export const FontPreview = memo(function FontPreview({ style, text, size, color, lines, align = "center", label, priority = "visible" }: {
  style?: PreviewStyle;
  text: string;
  size: number;
  color?: string | null;
  lines: number;
  align?: "center" | "left" | "top";
  label: string;
  priority?: PreviewPriority;
}) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const request = useRef<ReturnType<typeof acquirePreviewFont> | null>(null);
  const nativeRequest = useRef<ReturnType<typeof acquireNativePreview> | null>(null);
  const priorityRef = useRef(priority);
  const revision = useSyncExternalStore(subscribePreviewCache, previewCacheRevision);
  const [visibility, setVisibility] = useState<PreviewPriority | null>(null);
  priorityRef.current = priority === "selected" ? "selected" : visibility ?? "nearby";
  const [loaded, setLoaded] = useState<{ id: string; revision: number; font?: PreviewFont; failed?: boolean } | null>(null);
  const [fallback, setFallback] = useState<{ key: string; image: string | null } | null>(null);
  const face = style?.face;
  const current = loaded?.id === face?.id && loaded?.revision === revision ? loaded : null;
  const font = current?.font;
  const family = font?.family;
  const failed = Boolean(face && current?.failed);
  const { sample, sampleNote } = useMemo(() => {
    const supports = (character: string) => !font || /\s/u.test(character) ||
      [0x200c, 0x200d, 0xfe0e, 0xfe0f].includes(character.codePointAt(0)!) || coversCodepoint(font.coverage, character.codePointAt(0)!);
    const characters = Array.from(text || "Aa");
    const hasSupportedText = characters.some((character) => !/\s/u.test(character) && supports(character));
    const hasMissingText = characters.some((character) => !supports(character));
    return {
      sample: font && !hasSupportedText ? font.sample : characters.map((character) => supports(character) ? character : "□").join(""),
      sampleNote: font && !hasSupportedText ? t("font.missingGlyphNote") : hasMissingText ? t("font.boxGlyphNote") : undefined,
    };
  }, [font, text, t]);
  const fallbackKey = JSON.stringify([revision, face?.id, sample, size]);

  useEffect(() => {
    const element = container.current;
    if (!element || !face) return;
    let active = true;
    let generation = 0;
    const stop = observePreviewVisibility(element, (visibility) => {
      setVisibility(visibility);
      if (!visibility) {
        generation += 1;
        request.current?.release();
        request.current = null;
        setLoaded(null);
        return;
      }
      const effective = priorityRef.current === "selected" ? "selected" : visibility;
      if (request.current) { request.current.setPriority(effective); return; }
      const token = ++generation;
      const finish = startMetric("preview-ready");
      const acquired = acquirePreviewFont(face, effective);
      request.current = acquired;
      void acquired.promise.then(
        (font) => {
          if (active && generation === token) {
            setLoaded({ id: face.id, revision, font });
            window.requestAnimationFrame(() => window.requestAnimationFrame(() => { if (active && generation === token) finish(); }));
          }
        },
        (error: unknown) => {
          if (active && generation === token && !(error instanceof DOMException && error.name === "AbortError"))
            setLoaded({ id: face.id, revision, failed: true });
        },
      );
    });
    return () => { active = false; stop(); request.current?.release(); request.current = null; };
  }, [face, revision]);

  useEffect(() => {
    const effective = priority === "selected" ? "selected" : visibility ?? "nearby";
    request.current?.setPriority(effective);
    nativeRequest.current?.setPriority(effective);
  }, [priority, visibility]);

  const visible = visibility !== null;
  const faceId = face?.id;
  // 浏览器拒绝旧字体时使用共享的原生预览队列，离屏或输入变化时释放请求。
  useEffect(() => {
    if (!failed || !faceId || !visible) return;
    let active = true;
    const acquired = acquireNativePreview(faceId, sample, size, priorityRef.current);
    nativeRequest.current = acquired;
    void acquired.promise.then(
      (image) => { if (active) setFallback({ key: fallbackKey, image }); },
      (error: unknown) => {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) setFallback({ key: fallbackKey, image: null });
      },
    );
    return () => { active = false; acquired.release(); nativeRequest.current = null; };
  }, [failed, faceId, visible, sample, size, fallbackKey]);

  const coordinates = style?.coordinates;
  const variation = Object.entries(coordinates ?? {}).map(([tag, value]) => `"${tag}" ${value}`).join(", ") || "normal";
  const weight = coordinates?.wght ?? face?.weight ?? 400;

  // 严格使用设置字号，超出的文字由样式换行和截断。
  const fontStyle: CSSProperties = {
    fontFamily: family ? `"${family}"` : undefined,
    fontWeight: weight,
    fontVariationSettings: variation,
    fontSize: size,
    WebkitLineClamp: lines,
  };
  const fallbackImage = fallback?.key === fallbackKey ? fallback.image : undefined;
  return (
    <div ref={container} className={`font-preview align-${align}`} style={{ color: color ?? undefined }} role="img" aria-label={sampleNote ? `${label}，${sampleNote}` : label} title={sampleNote} aria-busy={Boolean(face) && !family && fallbackImage === undefined}>
      {family ? <span className="font-preview-text" style={fontStyle} aria-hidden="true">{sample}</span>
        : fallbackImage ? <span className="font-preview-colored-fallback" style={{ maskImage: `url("${fallbackImage}")` }} aria-hidden="true">
          <img src={fallbackImage} alt="" className="font-preview-fallback" />
        </span>
        : <span className="preview-unavailable">{fallbackImage === null || !face ? t("preview.unavailableShort") : t("common.loadingFont")}</span>}
    </div>
  );
});
