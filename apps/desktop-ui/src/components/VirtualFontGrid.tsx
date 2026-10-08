import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { gridGeometry, visibleRows } from "../grid-layout";
import type { FamilyDto } from "../types";
import type { EditingPreview } from "../preview-appearance";
import { FontCard } from "./FontCard";
import { ExpandedFontCarousel } from "./ExpandedFontCarousel";

type CardProps = ComponentProps<typeof FontCard>;
type Props = Pick<CardProps, "mode" | "previewText" | "previewSize" | "textColor" | "backgroundColor" | "showMetadata" | "selectOnHover" | "hoverDelay" | "onSelect" | "onStyleChange" | "onFavorite" | "onDownload"> & {
  families: FamilyDto[];
  selectedId?: string;
  styleKey: string | null;
  total: number;
  wheelSpeed: number;
  isLoading?: boolean;
  onLoadMore?: () => void;
  onRequestRange?: (offset: number, limit: number) => Promise<FamilyDto[]>;
  onPreviewSelect?: (family: FamilyDto) => void;
  header?: ReactNode;
  emptyState?: ReactNode;
  editingPreview?: EditingPreview | null;
};

export const VirtualFontGrid = memo(function VirtualFontGrid({ families, selectedId, styleKey, total, wheelSpeed, isLoading, onLoadMore, onRequestRange, onPreviewSelect, header, emptyState, editingPreview, ...props }: Props) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const headerRoot = useRef<HTMLDivElement>(null);
  const contentRoot = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 640, height: 0, scrollTop: 0, top: 10 });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const positions = useMemo(() => new Map(families.map((family, index) => [family.id, index])), [families]);
  const geometry = gridGeometry(viewport.width, props.mode);
  const measured = useRef({ geometry, top: viewport.top, width: 0, mode: props.mode });
  const pendingFocus = useRef<{ id: string; last: boolean } | null>(null);
  const restoreScroll = useRef<number | null>(null);
  const focusedControl = useRef(0);
  const frame = useRef(0);
  const lastLoad = useRef<{ first: FamilyDto; count: number } | null>(null);
  const mode = props.mode;
  const gridHeight = Math.max(0, Math.ceil(families.length / geometry.columns) * geometry.stride - geometry.gap);

  useLayoutEffect(() => {
    const element = root.current;
    const content = contentRoot.current;
    if (!element || !content) return;
    const measure = () => {
      const css = getComputedStyle(content);
      const width = Math.max(1, content.clientWidth - parseFloat(css.paddingLeft || "0") - parseFloat(css.paddingRight || "0"));
      const top = (headerRoot.current?.offsetHeight ?? 0) + parseFloat(css.paddingTop || "0");
      const previous = measured.current;
      const next = gridGeometry(width, mode);
      let scrollTop = element.scrollTop;
      // Hero 高度与视图变化后保留卡片锚点，浏览 Hero 时保持原位置。
      if (previous.width && element.scrollTop >= previous.top && (previous.width !== width || previous.mode !== mode || previous.top !== top)) {
        const index = Math.floor(Math.max(0, element.scrollTop - previous.top) / previous.geometry.stride) * previous.geometry.columns;
        const fraction = Math.max(0, element.scrollTop - previous.top) % previous.geometry.stride / previous.geometry.stride;
        scrollTop = top + (Math.floor(index / next.columns) + fraction) * next.stride;
        restoreScroll.current = scrollTop;
      }
      measured.current = { geometry: next, top, width, mode };
      const value = { width, top, height: element.clientHeight, scrollTop };
      setViewport((current) => Object.keys(value).every((key) => current[key as keyof typeof current] === value[key as keyof typeof value]) ? current : value);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(content);
    if (headerRoot.current) observer.observe(headerRoot.current);
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame.current); frame.current = 0; };
  }, [mode]);

  useEffect(() => {
    if (mode === "expanded" || !onLoadMore || isLoading || !families.length || families.length >= total || viewport.height <= 0) return;
    const remaining = viewport.top + gridHeight - viewport.scrollTop - viewport.height;
    if (remaining > Math.max(viewport.height * 2, geometry.stride * 3)) return;
    // 提前两屏补页；同一页只触发一次，首屏替换后允许重新加载。
    if (lastLoad.current?.first === families[0] && lastLoad.current.count === families.length) return;
    lastLoad.current = { first: families[0], count: families.length };
    onLoadMore();
  }, [families, total, isLoading, onLoadMore, gridHeight, geometry.stride, viewport.top, viewport.scrollTop, viewport.height, mode]);

  const gridScrollTop = viewport.scrollTop - viewport.top;
  const rows = visibleRows(families.length, geometry.columns, geometry.stride, gridScrollTop,
    Math.max(0, viewport.height + Math.min(0, gridScrollTop)), focusedId ? positions.get(focusedId) ?? -1 : -1);
  const focusIndex = (index: number, last = false) => {
    const element = root.current;
    const family = families[index];
    if (!element || !family) return;
    pendingFocus.current = { id: family.id, last };
    setFocusedId(family.id);
    const top = viewport.top + Math.floor(index / geometry.columns) * geometry.stride;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + geometry.cardHeight > element.scrollTop + element.clientHeight)
      element.scrollTop = top + geometry.cardHeight - element.clientHeight;
    setViewport((current) => ({ ...current, scrollTop: element.scrollTop }));
  };

  useLayoutEffect(() => {
    if (root.current && restoreScroll.current !== null) {
      root.current.scrollTop = restoreScroll.current;
      restoreScroll.current = null;
    }
    const target = pendingFocus.current ?? (focusedId && document.activeElement === document.body ? { id: focusedId, last: false } : null);
    if (!target) return;
    const card = [...(root.current?.querySelectorAll<HTMLElement>(".font-card") ?? [])].find((card) => card.dataset.familyId === target.id);
    const buttons = card ? focusableButtons(card) : [];
    const button = pendingFocus.current ? target.last ? buttons.at(-1) : buttons[0] : buttons[focusedControl.current] ?? buttons[0];
    if (button) { pendingFocus.current = null; button.focus({ preventScroll: true }); }
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const button = event.target as HTMLElement;
    const card = button.closest<HTMLElement>(".font-card");
    if (!card || event.altKey || event.ctrlKey || event.metaKey) return;
    const index = positions.get(card.dataset.familyId ?? "") ?? -1;
    if (event.key === "Tab") {
      const buttons = focusableButtons(card);
      if (button !== (event.shiftKey ? buttons[0] : buttons.at(-1))) return;
      const next = index + (event.shiftKey ? -1 : 1);
      if (next < 0 || next >= families.length) return;
      const mounted = [...(root.current?.querySelectorAll<HTMLElement>(".font-card") ?? [])].some((card) => card.dataset.familyId === families[next].id);
      if (!mounted) { event.preventDefault(); focusIndex(next, event.shiftKey); }
      return;
    }
    if (!button.classList.contains("font-card-select")) return;
    const step = event.key === "ArrowDown" ? geometry.columns : event.key === "ArrowUp" ? -geometry.columns : event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? families.length - 1 : index + step;
    if (step || event.key === "Home" || event.key === "End") { event.preventDefault(); focusIndex(Math.max(0, Math.min(families.length - 1, next))); }
  };

  if (mode === "expanded") return <ExpandedFontCarousel {...props} families={families} selectedId={selectedId} styleKey={styleKey} total={total}
    wheelSpeed={wheelSpeed} isLoading={isLoading} onLoadMore={onLoadMore} onRequestRange={onRequestRange} onPreviewSelect={onPreviewSelect} header={header} emptyState={emptyState} editingPreview={editingPreview} />;

  return <div ref={root} className={`font-grid virtual-font-grid mode-${mode}`} tabIndex={-1} role="region" aria-label={t("desktop.fontBrowse")}
    onKeyDownCapture={onKeyDown}
    onFocusCapture={(event) => {
      const card = (event.target as HTMLElement).closest<HTMLElement>(".font-card");
      focusedControl.current = card && event.target instanceof HTMLButtonElement ? Math.max(0, focusableButtons(card).indexOf(event.target)) : 0;
      setFocusedId(card?.dataset.familyId ?? null);
    }}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedId(null); }}
    onScroll={() => {
      if (frame.current) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = 0;
        if (root.current) setViewport((current) => ({ ...current, scrollTop: root.current!.scrollTop }));
      });
    }}>
    <div ref={headerRoot} className="font-grid-header">{header}</div>
    <div ref={contentRoot} className="font-grid-content">
      {families.length ? <div className="font-grid-rows" style={{ height: gridHeight }} role="list" aria-label={t("desktop.fontList")}>
        {rows.map((row) => <div key={row} className="font-grid-row" style={{ top: row * geometry.stride, height: geometry.cardHeight, gap: geometry.gap, gridTemplateColumns: `repeat(${geometry.columns}, minmax(0, 1fr))` }}>
          {families.slice(row * geometry.columns, (row + 1) * geometry.columns).map((family, column) => <FontCard
            {...props} key={family.id} family={family} selected={selectedId === family.id} styleKey={selectedId === family.id ? styleKey : null}
            previewSize={editingPreview?.familyId === family.id ? editingPreview.appearance.size : props.previewSize}
            textColor={editingPreview?.familyId === family.id ? editingPreview.appearance.textColor : props.textColor}
            backgroundColor={editingPreview?.familyId === family.id ? editingPreview.appearance.backgroundColor : props.backgroundColor}
            position={row * geometry.columns + column + 1} total={total} />)}
        </div>)}
      </div> : emptyState}
    </div>
  </div>;
});

function focusableButtons(card: HTMLElement) {
  return [...card.querySelectorAll<HTMLButtonElement>("button")].filter((button) => !button.disabled && button.tabIndex >= 0);
}
