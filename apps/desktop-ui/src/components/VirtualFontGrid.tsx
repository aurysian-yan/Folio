import { memo, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { gridGeometry, visibleRows } from "../grid-layout";
import type { FamilyDto } from "../types";
import { FontCard } from "./FontCard";

type CardProps = ComponentProps<typeof FontCard>;
type Props = Pick<CardProps, "mode" | "previewText" | "previewSize" | "showMetadata" | "selectOnHover" | "hoverDelay" | "onSelect" | "onStyleChange" | "onFavorite"> & {
  families: FamilyDto[];
  selectedId?: string;
  styleKey: string | null;
  total: number;
};

export const VirtualFontGrid = memo(function VirtualFontGrid({ families, selectedId, styleKey, total, ...props }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 640, height: 480, scrollTop: 0, top: 10 });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const positions = useMemo(() => new Map(families.map((family, index) => [family.id, index])), [families]);
  const geometry = gridGeometry(viewport.width, props.mode);
  const measured = useRef({ geometry, top: viewport.top, width: 0, mode: props.mode });
  const pendingFocus = useRef<{ id: string; last: boolean } | null>(null);
  const restoreScroll = useRef<number | null>(null);
  const focusedControl = useRef(0);
  const frame = useRef(0);
  const mode = props.mode;

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const css = getComputedStyle(element);
      const width = Math.max(1, element.clientWidth - parseFloat(css.paddingLeft || "0") - parseFloat(css.paddingRight || "0"));
      const top = parseFloat(css.paddingTop || "0");
      const previous = measured.current;
      const next = gridGeometry(width, mode);
      let scrollTop = element.scrollTop;
      if (previous.width && (previous.width !== width || previous.mode !== mode)) {
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
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame.current); frame.current = 0; };
  }, [mode]);

  const rows = visibleRows(families.length, geometry.columns, geometry.stride, viewport.scrollTop - viewport.top,
    viewport.height, focusedId ? positions.get(focusedId) ?? -1 : -1);
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

  return <div ref={root} className={`font-grid virtual-font-grid mode-${mode}`} tabIndex={-1} role="list" aria-label="字体列表"
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
    <div className="font-grid-rows" style={{ height: Math.max(0, Math.ceil(families.length / geometry.columns) * geometry.stride - geometry.gap) }}>
      {rows.map((row) => <div key={row} className="font-grid-row" style={{ top: row * geometry.stride, height: geometry.cardHeight, gap: geometry.gap, gridTemplateColumns: `repeat(${geometry.columns}, minmax(0, 1fr))` }}>
        {families.slice(row * geometry.columns, (row + 1) * geometry.columns).map((family, column) => <FontCard
          {...props} key={family.id} family={family} selected={selectedId === family.id} styleKey={selectedId === family.id ? styleKey : null}
          position={row * geometry.columns + column + 1} total={total} />)}
      </div>)}
    </div>
  </div>;
});

function focusableButtons(card: HTMLElement) {
  return [...card.querySelectorAll<HTMLButtonElement>("button")].filter((button) => !button.disabled && button.tabIndex >= 0);
}
