import { Button } from "@heroui/react";
import { CaretLeftIcon, CaretRightIcon, ListIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type PointerEvent } from "react";
import type { FamilyDto } from "../types";
import type { EditingPreview } from "../preview-appearance";
import { ClaralightSlider } from "./ClaralightSlider";
import { FontCard } from "./FontCard";

type CardProps = ComponentProps<typeof FontCard>;
type Props = Pick<CardProps, "previewText" | "previewSize" | "textColor" | "backgroundColor" | "showMetadata" | "selectOnHover" | "hoverDelay" | "onSelect" | "onStyleChange" | "onFavorite"> & {
  families: FamilyDto[];
  selectedId?: string;
  styleKey: string | null;
  total: number;
  wheelSpeed: number;
  isLoading?: boolean;
  onLoadMore?: () => void;
  onRequestRange?: (offset: number, limit: number) => Promise<FamilyDto[]>;
  onPreviewSelect?: (family: FamilyDto) => void;
  header?: React.ReactNode;
  emptyState?: React.ReactNode;
  editingPreview?: EditingPreview | null;
};

const ratioKey = "folio-expanded-card-height-ratio";
const pageDuration = 380;

type Motion = { from: number; to: number; phase: "ready" | "moving" };
type WheelGesture = { direction: number; origin: number; progress: number; travel: number };

function loopIndex(index: number, total: number) {
  return (index % total + total) % total;
}

function cardPosition(depth: number, cardWidth: number) {
  if (depth < 0) {
    const distance = Math.min(-depth, 1);
    const scale = 1 - distance * 0.08;
    return { scale, offset: distance * cardWidth * 120 / 410, opacity: 1 - distance, blur: distance, zIndex: 4 + depth };
  }
  if (depth <= 1) {
    const scale = 1 - depth * 0.15;
    return { scale, offset: -depth * cardWidth * 105.25 / 410, opacity: 1 - depth * 0.3, blur: depth * 1.5, zIndex: 3 - depth };
  }
  const distance = Math.min(depth - 1, 1);
  const scale = 0.85 - distance * 0.1;
  return { scale, offset: -(105.25 + distance * 54) * cardWidth / 410, opacity: 0.7 - distance * 0.4, blur: 1.5 + distance * 1.5, zIndex: 3 - depth };
}

function savedRatio() {
  const value = Number(localStorage.getItem(ratioKey));
  return Number.isFinite(value) && value >= 0.45 && value <= 1.4 ? value : 0.68;
}

export function ExpandedFontCarousel({ families, selectedId, styleKey, total, wheelSpeed, isLoading, onLoadMore, onRequestRange, onPreviewSelect, header, emptyState, editingPreview, onSelect, ...cardProps }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(820);
  const [index, setIndex] = useState(() => Math.max(0, families.findIndex((family) => family.id === selectedId)));
  const [motion, setMotion] = useState<Motion | null>(null);
  const [wheelProgress, setWheelProgress] = useState<number | null>(null);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [ratio, setRatio] = useState(savedRatio);
  const [draftRatio, setDraftRatio] = useState<number | null>(null);
  const [draftPage, setDraftPage] = useState<number | null>(null);
  const [requestedFamilies, setRequestedFamilies] = useState<Map<number, FamilyDto>>(() => new Map());
  const [requestError, setRequestError] = useState("");
  const pointerStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const resizeStart = useRef<{ y: number; ratio: number; pointerId: number } | null>(null);
  const wheelGesture = useRef<WheelGesture | null>(null);
  const wheelFrame = useRef(0);
  const wheelSettleTimer = useRef(0);
  const lastWheelInputAt = useRef(-Infinity);
  const suppressWheelUntilIdle = useRef(false);
  const loadingFrom = useRef<number | null>(null);
  const tailRequested = useRef<number | null>(null);
  const requestSerial = useRef(0);
  const scrubRequest = useRef<{ target: number; serial: number; commit: boolean } | null>(null);
  const scrubFetchTimer = useRef(0);
  const startScrubFetch = useRef<(() => void) | null>(null);
  const motionSerial = useRef(0);
  const motionFrames = useRef<number[]>([]);
  const motionTimer = useRef(0);
  const lastSelectedId = useRef(selectedId);
  const familyAt = useCallback((position: number) => families[position] ?? requestedFamilies.get(position), [families, requestedFamilies]);
  const currentIndex = Math.min(index, Math.max(0, total - 1));
  const cardWidth = Math.min(Math.max(viewportWidth * 0.36 + 158, 280), 960, Math.max(viewportWidth - 24, 1));
  const cardHeight = cardWidth * (draftRatio ?? ratio);
  const stackWidth = Math.min(viewportWidth, cardWidth * 518 / 410);
  const visualProgress = wheelProgress ?? (motion ? motion.phase === "ready" ? motion.from : motion.to : currentIndex);
  const visualTarget = motion?.to ?? currentIndex;
  const activeIndexRef = useRef(currentIndex);
  const virtualTargetRef = useRef(visualTarget);
  const movingRef = useRef(motion?.phase === "moving");
  const motionActiveRef = useRef(Boolean(motion));
  activeIndexRef.current = currentIndex;
  virtualTargetRef.current = visualTarget;
  movingRef.current = motion?.phase === "moving";
  motionActiveRef.current = Boolean(motion);
  const seen = new Set<number>();
  const visibleTarget = wheelProgress === null ? visualTarget : Math.round(wheelProgress);
  const visibleCards = total < 1 ? [] : [visibleTarget, visibleTarget - 1, visibleTarget - 2, visibleTarget + 1].flatMap((virtualIndex) => {
    const familyIndex = loopIndex(virtualIndex, total);
    if (seen.has(familyIndex)) return [];
    seen.add(familyIndex);
    const family = familyAt(familyIndex);
    return family ? [{ family, familyIndex, virtualIndex }] : [];
  });

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => setViewportWidth(Math.max(1, element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (pendingIndex === null || pendingIndex >= families.length) return;
    if (selectedId !== families[pendingIndex].id) {
      lastSelectedId.current = families[pendingIndex].id;
      onSelect(families[pendingIndex]);
    }
  }, [pendingIndex, families, selectedId, onSelect]);

  useEffect(() => () => {
    requestSerial.current += 1;
    motionSerial.current += 1;
    motionFrames.current.forEach(window.cancelAnimationFrame);
    window.clearTimeout(motionTimer.current);
    window.cancelAnimationFrame(wheelFrame.current);
    window.clearTimeout(wheelSettleTimer.current);
    window.clearTimeout(scrubFetchTimer.current);
  }, []);

  const cancelWheel = useCallback(() => {
    wheelGesture.current = null;
    window.cancelAnimationFrame(wheelFrame.current);
    window.clearTimeout(wheelSettleTimer.current);
    setWheelProgress(null);
  }, []);

  useEffect(() => {
    if (loadingFrom.current !== null && families.length !== loadingFrom.current) loadingFrom.current = null;
  }, [families.length]);

  useEffect(() => {
    if (!isLoading) loadingFrom.current = null;
  }, [isLoading]);

  useEffect(() => {
    if (!onRequestRange || total < 3 || families.length >= total || tailRequested.current === total) return;
    tailRequested.current = total;
    let active = true;
    void onRequestRange(total - 3, 3).then((result) => {
      if (!active) return;
      setRequestedFamilies((current) => {
        const next = new Map(current);
        result.forEach((family, offset) => next.set(total - 3 + offset, family));
        return next;
      });
    }).catch(() => {});
    return () => { active = false; };
  }, [onRequestRange, total, families.length]);

  const animateTo = useCallback((target: number, requested: number, family: FamilyDto, notify = true, startProgress?: number) => {
    const serial = ++motionSerial.current;
    motionFrames.current.forEach(window.cancelAnimationFrame);
    motionFrames.current = [];
    window.clearTimeout(motionTimer.current);
    const active = activeIndexRef.current;
    const previous = virtualTargetRef.current;
    const step = requested - active;
    const destination = startProgress === undefined
      ? Math.abs(step) <= 1 ? previous + step : target
      : requested;
    const start = startProgress ?? previous;
    const distance = destination - start;
    activeIndexRef.current = target;
    virtualTargetRef.current = destination;
    setIndex(target);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || distance === 0) {
      motionActiveRef.current = false;
      setMotion(null);
      if (notify) {
        lastSelectedId.current = family.id;
        onSelect(family);
      }
      return;
    }
    const from = startProgress ?? (Math.abs(distance) > 1 ? destination - Math.sign(distance) * 0.999 : previous);
    const continuing = startProgress === undefined && movingRef.current && Math.abs(distance) <= 1;
    const next: Motion = { from, to: destination, phase: continuing ? "moving" : "ready" };
    motionActiveRef.current = true;
    setMotion(next);
    const frame = (callback: FrameRequestCallback) => {
      motionFrames.current.push(window.requestAnimationFrame(callback));
    };
    const finish = () => {
      motionTimer.current = window.setTimeout(() => {
        if (motionSerial.current === serial) {
          motionActiveRef.current = false;
          setMotion(null);
        }
      }, pageDuration);
      if (notify) frame(() => {
        if (motionSerial.current !== serial) return;
        lastSelectedId.current = family.id;
        onSelect(family);
      });
    };
    if (continuing) {
      finish();
    } else {
      frame(() => frame(() => {
        if (motionSerial.current !== serial) return;
        movingRef.current = true;
        setMotion({ from, to: destination, phase: "moving" });
        finish();
      }));
    }
  }, [onSelect]);

  useEffect(() => {
    if (selectedId === lastSelectedId.current) return;
    lastSelectedId.current = selectedId;
    const loaded = families.findIndex((family) => family.id === selectedId);
    const target = loaded >= 0 ? loaded : [...requestedFamilies].find(([, family]) => family.id === selectedId)?.[0] ?? -1;
    if (target < 0 || target === activeIndexRef.current) return;
    const family = familyAt(target);
    if (!family) return;
    const frame = window.requestAnimationFrame(() => animateTo(target, target, family, false));
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId, families, requestedFamilies, familyAt, animateTo]);

  const moveTo = useCallback((requested: number, startProgress?: number) => {
    cancelWheel();
    if (scrubRequest.current) {
      scrubRequest.current = null;
      requestSerial.current += 1;
      window.clearTimeout(scrubFetchTimer.current);
      scrubFetchTimer.current = 0;
      startScrubFetch.current = null;
      setPendingIndex(null);
    }
    if (total < 1) return;
    if (requested < 0 && !onRequestRange && families.length < total) return;
    const target = (requested % total + total) % total;
    const known = familyAt(target);
    if (target === currentIndex) {
      if (known && startProgress !== undefined) animateTo(target, requested, known, false, startProgress);
      if (known && selectedId !== known.id) {
        lastSelectedId.current = known.id;
        onSelect(known);
      }
      return;
    }
    if (!known && onRequestRange) {
      const serial = ++requestSerial.current;
      const start = Math.max(0, target - 2);
      setPendingIndex(target);
      setRequestError("");
      void onRequestRange(start, Math.min(5, total - start)).then((result) => {
        if (requestSerial.current !== serial) return;
        const found = result[target - start];
        if (!found) throw new Error("字体不存在");
        setRequestedFamilies((current) => {
          const next = new Map(current);
          result.forEach((family, offset) => next.set(start + offset, family));
          return next;
        });
        setPendingIndex(null);
        animateTo(target, requested, found, true, startProgress);
      }).catch(() => {
        if (requestSerial.current !== serial) return;
        setPendingIndex(null);
        setRequestError("无法加载该位置的字体，请重试。");
      });
      return;
    }
    if (!known) {
      setPendingIndex(target);
      if (!isLoading && loadingFrom.current !== families.length) {
        loadingFrom.current = families.length;
        onLoadMore?.();
      }
      return;
    }
    requestSerial.current += 1;
    setRequestError("");
    setPendingIndex(null);
    animateTo(target, requested, known, true, startProgress);
    if (target < families.length && target >= families.length - 4 && families.length < total && !isLoading && loadingFrom.current !== families.length) {
      loadingFrom.current = families.length;
      onLoadMore?.();
    }
  }, [cancelWheel, currentIndex, families, total, isLoading, onLoadMore, onRequestRange, onSelect, selectedId, familyAt, animateTo]);

  const selectCard = useCallback((family: FamilyDto) => {
    const loaded = families.findIndex((entry) => entry.id === family.id);
    const position = loaded >= 0 ? loaded : [...requestedFamilies].find(([, entry]) => entry.id === family.id)?.[0];
    if (position !== undefined) moveTo(position);
  }, [families, requestedFamilies, moveTo]);

  const scrubTo = useCallback((requested: number, commit: boolean) => {
    if (total < 1) return;
    const target = Math.min(total - 1, Math.max(0, Math.round(requested)));
    cancelWheel();
    motionSerial.current += 1;
    motionFrames.current.forEach(window.cancelAnimationFrame);
    motionFrames.current = [];
    window.clearTimeout(motionTimer.current);
    motionActiveRef.current = false;
    movingRef.current = false;
    setMotion(null);
    const show = (family: FamilyDto, shouldCommit: boolean) => {
      activeIndexRef.current = target;
      virtualTargetRef.current = target;
      setIndex(target);
      setPendingIndex(null);
      setRequestError("");
      lastSelectedId.current = family.id;
      (onPreviewSelect ?? onSelect)(family);
      if (shouldCommit && onPreviewSelect) onSelect(family);
    };
    const known = familyAt(target);
    if (known) {
      requestSerial.current += 1;
      scrubRequest.current = null;
      window.clearTimeout(scrubFetchTimer.current);
      scrubFetchTimer.current = 0;
      startScrubFetch.current = null;
      show(known, commit);
      return;
    }
    setPendingIndex(target);
    if (!onRequestRange) return;
    if (scrubRequest.current?.target === target) {
      scrubRequest.current.commit ||= commit;
      if (commit && scrubFetchTimer.current) {
        window.clearTimeout(scrubFetchTimer.current);
        startScrubFetch.current?.();
      }
      return;
    }
    window.clearTimeout(scrubFetchTimer.current);
    scrubFetchTimer.current = 0;
    const serial = ++requestSerial.current;
    scrubRequest.current = { target, serial, commit };
    const start = Math.max(0, target - 2);
    const fetchTarget = () => {
      scrubFetchTimer.current = 0;
      if (requestSerial.current !== serial || scrubRequest.current?.serial !== serial) return;
      void onRequestRange(start, Math.min(5, total - start)).then((result) => {
        if (requestSerial.current !== serial || scrubRequest.current?.serial !== serial) return;
        const found = result[target - start];
        if (!found) throw new Error("字体不存在");
        setRequestedFamilies((current) => {
          const next = new Map(current);
          result.forEach((family, offset) => next.set(start + offset, family));
          return next;
        });
        const shouldCommit = scrubRequest.current.commit;
        scrubRequest.current = null;
        show(found, shouldCommit);
      }).catch(() => {
        if (requestSerial.current !== serial) return;
        scrubRequest.current = null;
        setPendingIndex(null);
        setRequestError("无法加载该位置的字体，请重试。");
      });
    };
    startScrubFetch.current = fetchTarget;
    if (commit) fetchTarget();
    else scrubFetchTimer.current = window.setTimeout(fetchTarget, 60);
  }, [total, cancelWheel, familyAt, onPreviewSelect, onSelect, onRequestRange]);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (total < 2 || (event.target as HTMLElement).closest(".font-card-actions, .font-style-selector, .carousel-resize-handle")) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (Math.abs(delta) < 1) return;
      event.preventDefault();
      const now = performance.now();
      const gap = now - lastWheelInputAt.current;
      lastWheelInputAt.current = now;
      if (gap > 220) suppressWheelUntilIdle.current = false;
      if (motionActiveRef.current) suppressWheelUntilIdle.current = true;
      if (suppressWheelUntilIdle.current) return;
      const distance = Math.abs(delta) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportWidth : 1);
      const direction = Math.sign(delta);
      let gesture = wheelGesture.current;
      if (!gesture || gap > 220) {
        const origin = virtualTargetRef.current;
        gesture = { direction, origin, progress: origin, travel: 0 };
        wheelGesture.current = gesture;
      }
      // 同一次触控板手势锁定方向，避免尾部反向噪声把卡片拉回。
      if (direction !== gesture.direction) return;
      gesture.travel += distance;
      let availableSteps = 0;
      for (let step = 1; step <= Math.min(total - 1, 6); step += 1) {
        if (!familyAt(loopIndex(activeIndexRef.current + direction * step, total))) break;
        availableSteps = step;
      }
      if (availableSteps > 0) {
        const travelPerCard = Math.max(viewportWidth * 0.72, 260) / Math.min(2, Math.max(0.5, wheelSpeed));
        gesture.progress = gesture.origin + direction * Math.min(availableSteps - 0.001, gesture.travel / travelPerCard);
        window.cancelAnimationFrame(wheelFrame.current);
        wheelFrame.current = window.requestAnimationFrame(() => setWheelProgress(gesture.progress));
      }
      window.clearTimeout(wheelSettleTimer.current);
      wheelSettleTimer.current = window.setTimeout(() => {
        if (wheelGesture.current !== gesture) return;
        const steps = gesture.travel >= 8
          ? Math.max(1, Math.ceil(Math.abs(gesture.progress - gesture.origin) - 0.001))
          : 0;
        const target = activeIndexRef.current + gesture.direction * steps;
        moveTo(target, gesture.progress);
      }, 150);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [moveTo, familyAt, total, viewportWidth, wheelSpeed]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const source = event.target as HTMLElement;
    if (source !== scroll.current && !source.classList.contains("font-card-select")) return;
    const target = event.key === "ArrowLeft" || event.key === "ArrowUp" ? currentIndex - 1
      : event.key === "ArrowRight" || event.key === "ArrowDown" ? currentIndex + 1
      : event.key === "Home" ? 0 : event.key === "End" ? total - 1 : null;
    if (target === null) return;
    event.preventDefault();
    moveTo(target);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(".font-card-actions, .font-style-selector, .carousel-resize-handle")) return;
    pointerStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(event.clientY - start.y)) return;
    event.preventDefault();
    moveTo(currentIndex + (dx < 0 ? 1 : -1));
  };

  const beginResize = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    resizeStart.current = { y: event.clientY, ratio: draftRatio ?? ratio, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const updateResize = (event: PointerEvent<HTMLButtonElement>) => {
    const start = resizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setDraftRatio(Math.min(1.4, Math.max(0.45, start.ratio + (event.clientY - start.y) / cardWidth)));
  };
  const finishResize = () => {
    if (!resizeStart.current) return;
    resizeStart.current = null;
    if (draftRatio !== null) {
      setRatio(draftRatio);
      localStorage.setItem(ratioKey, String(draftRatio));
      setDraftRatio(null);
    }
  };

  return <div ref={scroll} className="font-grid expanded-carousel-scroll mode-expanded" role="region" aria-label="字体浏览" onKeyDown={onKeyDown}>
    <div className="font-grid-header">{header}</div>
    {families.length ? <div className="expanded-carousel" role="group" aria-label="展开卡片">
      <div ref={stage} className={`expanded-carousel-stage${motion?.phase === "moving" ? " is-moving" : ""}`} style={{ height: cardHeight }} onPointerDownCapture={onPointerDown} onPointerUpCapture={onPointerUp} onPointerCancelCapture={() => { pointerStart.current = null; }}>
        <div className="expanded-carousel-stack" role="list" aria-label="字体卡片" style={{ width: stackWidth, height: cardHeight }}>
          {visibleCards.map(({ family, familyIndex, virtualIndex }) => {
            const depth = visualProgress - virtualIndex;
            const { scale, offset, opacity, blur, zIndex } = cardPosition(depth, cardWidth);
            const current = familyIndex === currentIndex;
            return <div key={family.id} className="expanded-carousel-card" inert={!current} aria-hidden={!current} data-depth={depth} style={{ width: cardWidth, height: cardHeight, transform: `translateX(${offset}px) scale(${scale})`, opacity, filter: `blur(${blur}px)`, zIndex, pointerEvents: current ? "auto" : "none" }}>
              <FontCard {...cardProps} family={family} mode="expanded" selected={selectedId === family.id} styleKey={selectedId === family.id ? styleKey : null}
                selectOnHover={cardProps.selectOnHover && wheelProgress === null && motion === null}
                previewSize={editingPreview?.familyId === family.id ? editingPreview.appearance.size : cardProps.previewSize}
                textColor={editingPreview?.familyId === family.id ? editingPreview.appearance.textColor : cardProps.textColor}
                backgroundColor={editingPreview?.familyId === family.id ? editingPreview.appearance.backgroundColor : cardProps.backgroundColor}
                onSelect={selectCard} position={familyIndex + 1} total={total} />
              {current && <button type="button" role="slider" className="carousel-resize-handle" aria-label="调整卡片高度" aria-valuemin={45} aria-valuemax={140} aria-valuenow={Math.round((draftRatio ?? ratio) * 100)} aria-valuetext={`${Math.round((draftRatio ?? ratio) * 100)}%`} onPointerDown={beginResize} onPointerMove={updateResize} onPointerUp={finishResize} onPointerCancel={finishResize}
                onKeyDown={(event) => { if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return; event.preventDefault(); const next = Math.min(1.4, Math.max(0.45, ratio + (event.key === "ArrowDown" ? 0.05 : -0.05))); setRatio(next); localStorage.setItem(ratioKey, String(next)); }}><ListIcon /></button>}
            </div>;
          })}
        </div>
      </div>
      <div className="expanded-carousel-pager" aria-label="字体位置">
        <div className="expanded-carousel-pager-row">
          <Button isIconOnly size="sm" variant="ghost" aria-label="上一个字体" isDisabled={total < 2 || !onRequestRange && currentIndex === 0 && families.length < total} onPress={() => moveTo(currentIndex - 1)}><CaretLeftIcon /></Button>
          <output aria-live="polite">{draftPage ?? (pendingIndex !== null && pendingIndex >= families.length ? pendingIndex + 1 : currentIndex + 1)}</output>
          <Button isIconOnly size="sm" variant="ghost" aria-label="下一个字体" isDisabled={total < 2 || !onRequestRange && isLoading && currentIndex >= families.length - 1} onPress={() => moveTo(currentIndex + 1)}><CaretRightIcon /></Button>
        </div>
        <ClaralightSlider className="folio-slider" min={1} max={Math.max(1, onRequestRange ? total : families.length)} step={1} value={draftPage ?? currentIndex + 1}
          disabled={total < 2} aria-label="字体位置" aria-valuetext={`第 ${draftPage ?? currentIndex + 1} 个，共 ${total} 个`}
          onValueChangeStart={() => setDraftPage(currentIndex + 1)}
          onValueChange={(value) => { setDraftPage(value); scrubTo(value - 1, false); }}
          onValueChangeEnd={(value) => { setDraftPage(null); scrubTo(value - 1, true); }} />
        <div className="expanded-carousel-pager-ends"><span>1</span><span>{total}</span></div>
        {requestError && <p className="expanded-carousel-error" role="status">{requestError}</p>}
      </div>
    </div> : emptyState}
  </div>;
}
