import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { renderPreviews } from "../api";
import { acquirePreviewFont, type PreviewFont, type PreviewStyle } from "../font-preview";

export function FontPreview({ style, text, size, lines, align = "center", label }: {
  style?: PreviewStyle;
  text: string;
  size: number;
  lines: number;
  align?: "center" | "left" | "top";
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const [loaded, setLoaded] = useState<{ id: string; font?: PreviewFont; failed?: boolean } | null>(null);
  const [fallback, setFallback] = useState<{ key: string; image: string | null } | null>(null);
  const face = style?.face;
  const font = loaded?.id === face?.id ? loaded?.font : undefined;
  const family = font?.family;
  const failed = !face || (loaded?.id === face.id && loaded.failed);
  const input = text || "Aa";
  const supports = (character: string) => !font || /\s/u.test(character) || [0x200c, 0x200d, 0xfe0e, 0xfe0f].includes(character.codePointAt(0)!) || font.coverage.some(([start, end]) => {
    const codepoint = character.codePointAt(0)!;
    return codepoint >= start && codepoint <= end;
  });
  const characters = Array.from(input);
  const hasSupportedText = characters.some((character) => !/\s/u.test(character) && supports(character));
  const hasMissingText = characters.some((character) => !supports(character));
  const sample = font && !hasSupportedText ? font.sample : characters.map((character) => supports(character) ? character : "□").join("");
  const sampleNote = font && !hasSupportedText ? "字体未包含输入的字符，显示可用字形" : hasMissingText ? "方框表示字体未包含的字符" : undefined;
  const fallbackKey = `${face?.id}:${sample}:${size}`;

  useEffect(() => {
    const element = container.current;
    if (!element || !face) return;
    let active = true;
    let generation = 0;
    let release: (() => void) | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) {
        generation += 1;
        release?.();
        release = undefined;
        setLoaded(null);
        return;
      }
      if (release) return;
      const request = ++generation;
      const acquired = acquirePreviewFont(face);
      release = acquired.release;
      void acquired.promise.then(
        (font) => { if (active && generation === request) setLoaded({ id: face.id, font }); },
        () => { if (active && generation === request) setLoaded({ id: face.id, failed: true }); },
      );
    }, { root: element.closest(".font-grid"), rootMargin: "100px" });
    observer.observe(element);
    return () => { active = false; observer.disconnect(); release?.(); };
  }, [face]);

  // 浏览器拒绝旧字体时仍可用原生栅格器预览，错误只影响当前字面。
  useEffect(() => {
    if (!failed || !face) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void renderPreviews([face.id], sample, size).then(
        ([preview]) => { if (active) setFallback({ key: fallbackKey, image: preview?.dataUrl ?? null }); },
        () => { if (active) setFallback({ key: fallbackKey, image: null }); },
      );
    }, 100);
    return () => { active = false; window.clearTimeout(timer); };
  }, [failed, face, sample, size, fallbackKey]);

  const coordinates = style?.coordinates;
  useLayoutEffect(() => {
    const element = container.current;
    const span = content.current;
    if (!element || !span || !family) return;
    const fit = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!width || !height) return;
      span.style.webkitLineClamp = "unset";
      const fits = (fontSize: number) => {
        span.style.fontSize = `${fontSize}px`;
        return span.scrollWidth <= width + 1 && span.scrollHeight <= Math.min(height, lines * fontSize * 1.15) + 1;
      };
      let low = Math.min(size, 16, height / 1.15);
      let high = Math.min(size, height / 1.15);
      if (!fits(high)) {
        for (let step = 0; step < 8; step += 1) {
          const middle = (low + high) / 2;
          if (fits(middle)) low = middle; else high = middle;
        }
        high = low;
      }
      span.style.fontSize = `${Math.floor(high * 10) / 10}px`;
      span.style.webkitLineClamp = String(lines);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [family, sample, size, lines, coordinates]);

  const fontStyle: CSSProperties = {
    fontFamily: family ? `"${family}"` : undefined,
    fontWeight: coordinates?.wght ?? face?.weight ?? 400,
    fontVariationSettings: Object.entries(coordinates ?? {}).map(([tag, value]) => `"${tag}" ${value}`).join(", ") || "normal",
    fontSize: size,
    WebkitLineClamp: lines,
  };
  const fallbackImage = fallback?.key === fallbackKey ? fallback.image : undefined;
  return (
    <div ref={container} className={`font-preview align-${align}`} role="img" aria-label={sampleNote ? `${label}，${sampleNote}` : label} title={sampleNote} aria-busy={Boolean(face) && !family && fallbackImage === undefined}>
      {family ? <span ref={content} className="font-preview-text" style={fontStyle} aria-hidden="true">{sample}</span>
        : fallbackImage ? <img src={fallbackImage} alt="" className="font-preview-fallback" />
        : <span className="preview-unavailable">{fallbackImage === null || !face ? "预览不可用" : "正在载入字体…"}</span>}
    </div>
  );
}
