// 基于 Claralight 官方 Slider，来源与适配说明见 docs/claralight-slider.md。

import {
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ClaralightSliderProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue"> {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  onValueChangeStart?: () => void;
  onValueChangeEnd?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  snapPoints?: number[];
  snapRadius?: number;
  activeColor?: string;
  keyboardStep?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}

const TRACK_HEIGHT = 6;
const THUMB_WIDTH = 20;
const THUMB_HEIGHT = 12;
const HOVER_LINE_WIDTH = 3;
const HOVER_LINE_HEIGHT = 20;
const PRESS_LINE_WIDTH = 2.5;
const PRESS_LINE_HEIGHT = 18;
const GAP = 4;
const SNAP_DOT_DIAMETER = 2.5;
const HOVER_WIDTH = 28;
const HIT_HEIGHT = 32;
const DEFAULT_SNAP_RADIUS = 14;
const SNAP_HOLD_SHARE = 0.5;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function quantize(value: number, min: number, max: number, step?: number): number {
  if (step == null || step <= 0) return value;
  const last = Math.floor((max - min) / step);
  const index = clamp(Math.round((value - min) / step), 0, last);
  const onGrid = min + index * step;
  return Math.abs(max - value) < Math.abs(value - onGrid) ? max : onGrid;
}

interface SpringState {
  x: number;
  v: number;
}

function solveSpring(
  x0: number,
  v0: number,
  target: number,
  dt: number,
  mass: number,
  stiffness: number,
  damping: number,
): SpringState {
  const p0 = x0 - target;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const c1 = p0;
    const c2 = (v0 + zeta * w0 * p0) / wd;
    const exp = Math.exp(-zeta * w0 * dt);
    const cos = Math.cos(wd * dt);
    const sin = Math.sin(wd * dt);
    const x = target + exp * (c1 * cos + c2 * sin);
    const v = -zeta * w0 * exp * (c1 * cos + c2 * sin) + exp * (-c1 * wd * sin + c2 * wd * cos);
    return { x, v };
  } else if (Math.abs(zeta - 1) < 1e-4) {
    const c1 = p0;
    const c2 = v0 + w0 * p0;
    const exp = Math.exp(-w0 * dt);
    const x = target + exp * (c1 + c2 * dt);
    const v = exp * (c2 - w0 * (c1 + c2 * dt));
    return { x, v };
  } else {
    const gamma = w0 * Math.sqrt(zeta * zeta - 1);
    const r1 = -zeta * w0 + gamma;
    const r2 = -zeta * w0 - gamma;
    const c2 = (v0 - r1 * p0) / (r2 - r1);
    const c1 = p0 - c2;
    const x = target + c1 * Math.exp(r1 * dt) + c2 * Math.exp(r2 * dt);
    const v = c1 * r1 * Math.exp(r1 * dt) + c2 * r2 * Math.exp(r2 * dt);
    return { x, v };
  }
}

export function ClaralightSlider({
  value: controlledValue,
  defaultValue,
  onValueChange,
  onValueChangeStart,
  onValueChangeEnd,
  min = 0,
  max = 1,
  step,
  snapPoints,
  snapRadius = DEFAULT_SNAP_RADIUS,
  activeColor,
  keyboardStep,
  disabled = false,
  autoFocus = false,
  className,
  ...restProps
}: ClaralightSliderProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(
    () => defaultValue ?? min,
  );
  const isControlled = controlledValue !== undefined;
  const rawValue = isControlled ? controlledValue : uncontrolledValue;
  const currentValue = clamp(rawValue, min, max);

  const containerRef = useRef<HTMLDivElement>(null);
  const focusOnMount = useRef(autoFocus && !disabled);
  useEffect(() => {
    if (focusOnMount.current) containerRef.current?.focus();
  }, []);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const animationRef = useRef({ hover: 0, focus: 0 });
  const [layoutWidth, setLayoutWidth] = useState(300);

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [tracking, setTracking] = useState(false);

  const [hoverAnim, setHoverAnim] = useState(0);
  const [pressAnim, setPressAnim] = useState(0);
  const [focusAnim, setFocusAnim] = useState(0);

  const currentFraction = (currentValue - min) / (max - min || 1);
  const [visualFraction, setVisualFraction] = useState(currentFraction);

  const visualSpringRef = useRef({ x: currentFraction, v: 0, target: currentFraction });
  const pressSpringRef = useRef({ x: 0, v: 0, target: 0 });
  const lastTimeRef = useRef<number | null>(null);
  const isPointerDownRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const isEditingRef = useRef(false);
  const latestValueRef = useRef(currentValue);
  const beginInteraction = () => {
    if (isEditingRef.current) return;
    isEditingRef.current = true;
    latestValueRef.current = currentValue;
    onValueChangeStart?.();
  };
  const endInteraction = () => {
    if (!isEditingRef.current) return;
    isEditingRef.current = false;
    onValueChangeEnd?.(latestValueRef.current);
  };
  const finishInteraction = useEffectEvent(() => {
    isPointerDownRef.current = false;
    pointerIdRef.current = null;
    setPressed(false);
    setTracking(false);
    endInteraction();
  });
  useEffect(() => {
    const finish = () => finishInteraction();
    window.addEventListener("blur", finish);
    return () => { window.removeEventListener("blur", finish); finishInteraction(); };
  }, []);

  // 轨道尺寸跟随容器变化。
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateSize = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setLayoutWidth(width);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const changeValue = useCallback(
    (nextVal: number) => {
      if (disabled) return;
      latestValueRef.current = nextVal;
      if (!isControlled) {
        setUncontrolledValue(nextVal);
      }
      onValueChange?.(nextVal);
    },
    [disabled, isControlled, onValueChange],
  );

  useEffect(() => {
    const target = clamp((currentValue - min) / (max - min || 1), 0, 1);
    visualSpringRef.current.target = target;
    if (tracking && step == null) {
      visualSpringRef.current.x = target;
      visualSpringRef.current.v = 0;
    }
  }, [currentValue, min, max, tracking, step]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // 保留官方胶囊形变与松手弹簧，减少动态效果时直接到达目标。
  useEffect(() => {
    let animId: number;
    lastTimeRef.current = null;

    const frame = (time: number) => {
      if (lastTimeRef.current == null) {
        lastTimeRef.current = time;
      }
      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = time;

      const hoverTarget = hovered && !disabled ? 1 : 0;
      const focusTarget = focused && !disabled ? 1 : 0;
      const ease = (value: number, target: number) =>
        reducedMotion || Math.abs(value - target) < 0.01 ? target : value + (target - value) * Math.min(1, dt * 12);
      animationRef.current.hover = ease(animationRef.current.hover, hoverTarget);
      setHoverAnim(animationRef.current.hover);

      animationRef.current.focus = ease(animationRef.current.focus, focusTarget);
      setFocusAnim(animationRef.current.focus);

      if (reducedMotion) {
        pressSpringRef.current.x = pressed && !disabled ? 1 : 0;
        pressSpringRef.current.v = 0;
        setPressAnim(pressSpringRef.current.x);
      } else if (pressed && !disabled) {
        pressSpringRef.current.x = Math.min(1, pressSpringRef.current.x + dt * 14);
        pressSpringRef.current.v = 0;
        pressSpringRef.current.target = 1;
        setPressAnim(pressSpringRef.current.x);
      } else {
        pressSpringRef.current.target = 0;
        const res = solveSpring(
          pressSpringRef.current.x,
          pressSpringRef.current.v,
          0,
          dt,
          1,
          520,
          18,
        );
        pressSpringRef.current.x = res.x;
        pressSpringRef.current.v = res.v;
        if (Math.abs(res.x) < 0.001 && Math.abs(res.v) < 0.001) {
          pressSpringRef.current.x = 0;
          pressSpringRef.current.v = 0;
        }
        setPressAnim(pressSpringRef.current.x);
      }

      const vTarget = visualSpringRef.current.target;
      if (reducedMotion || (tracking && step == null)) {
        visualSpringRef.current.x = vTarget;
        visualSpringRef.current.v = 0;
        setVisualFraction(vTarget);
      } else {
        const dist = Math.abs(vTarget - visualSpringRef.current.x);
        const damping =
          step != null ? 32 : 24 + 24 * Math.min(1, dist / 0.35);
        const sRes = solveSpring(
          visualSpringRef.current.x,
          visualSpringRef.current.v,
          vTarget,
          dt,
          1,
          520,
          damping,
        );
        visualSpringRef.current.x = sRes.x;
        visualSpringRef.current.v = sRes.v;
        if (Math.abs(sRes.x - vTarget) < 0.0005 && Math.abs(sRes.v) < 0.001) {
          visualSpringRef.current.x = vTarget;
          visualSpringRef.current.v = 0;
        }
        setVisualFraction(visualSpringRef.current.x);
      }

      const moving = animationRef.current.hover !== hoverTarget ||
        animationRef.current.focus !== focusTarget ||
        pressSpringRef.current.x !== (pressed && !disabled ? 1 : 0) ||
        pressSpringRef.current.v !== 0 ||
        visualSpringRef.current.x !== visualSpringRef.current.target ||
        visualSpringRef.current.v !== 0;
      if (moving) animId = requestAnimationFrame(frame);
    };

    animId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animId);
  }, [
    disabled,
    hovered,
    focused,
    pressed,
    tracking,
    step,
    currentValue,
    min,
    max,
    reducedMotion,
    layoutWidth,
  ]);

  const lineState = Math.max(hoverAnim, focusAnim, pressAnim);
  const handleWidth = lerp(
    lerp(THUMB_WIDTH, HOVER_LINE_WIDTH, lineState),
    PRESS_LINE_WIDTH,
    pressAnim,
  );
  const handleHeight = lerp(
    lerp(THUMB_HEIGHT, HOVER_LINE_HEIGHT, lineState),
    PRESS_LINE_HEIGHT,
    pressAnim,
  );

  const clampedFraction = clamp(visualFraction, 0, 1);
  const handleCenter =
    handleWidth / 2 + (layoutWidth - handleWidth) * clampedFraction;
  const handleLeft = handleCenter - handleWidth / 2;

  const usableWidth = Math.max(1, layoutWidth - PRESS_LINE_WIDTH);
  const snapPositions = useMemo(() => {
    if (step != null || !snapPoints || snapPoints.length === 0) return [];
    const span = max - min || 1;
    return snapPoints.map(
      (p) => ((clamp(p, min, max) - min) / span) * usableWidth,
    );
  }, [step, snapPoints, min, max, usableWidth]);

  const magnetize = useCallback(
    (x: number): number => {
      if (snapPositions.length === 0) return x;
      const first = snapPositions[0];
      if (first === undefined) return x;
      let nearest = first;
      let minDist = Math.abs(x - nearest);
      for (let i = 1; i < snapPositions.length; i++) {
        const p = snapPositions[i];
        if (p === undefined) continue;
        const d = Math.abs(x - p);
        if (d < minDist) {
          minDist = d;
          nearest = p;
        }
      }
      if (minDist >= snapRadius) return x;
      const hold = snapRadius * SNAP_HOLD_SHARE;
      if (minDist <= hold) return nearest;
      const offset =
        ((snapRadius * (minDist - hold)) / (snapRadius - hold)) *
        (x < nearest ? -1 : 1);
      return Math.abs(offset) < 0.5 ? nearest : nearest + offset;
    },
    [snapPositions, snapRadius],
  );

  const updateFromPointer = useCallback(
    (clientX: number) => {
      if (disabled) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const localX = clientX - rect.left - PRESS_LINE_WIDTH / 2;
      const magnetizedX = magnetize(localX);
      const frac = clamp(magnetizedX / usableWidth, 0, 1);
      const raw = min + frac * (max - min);
      const quantized = quantize(raw, min, max, step);
      changeValue(quantized);
    },
    [disabled, magnetize, usableWidth, min, max, step, changeValue],
  );

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0 || isPointerDownRef.current) return;
    e.currentTarget.focus({ preventScroll: true });
    beginInteraction();
    isPointerDownRef.current = true;
    pointerIdRef.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPressed(true);
    setTracking(true);
    updateFromPointer(e.clientX);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current || pointerIdRef.current !== e.pointerId) return;
    updateFromPointer(e.clientX);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current || pointerIdRef.current !== e.pointerId) return;
    isPointerDownRef.current = false;
    pointerIdRef.current = null;
    endInteraction();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // 取消拖拽时，浏览器可能已释放指针捕获。
    }
    setPressed(false);
    setTracking(false);

    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const localX = e.clientX - rect.left;
      const isOver =
        localX >= handleCenter - HOVER_WIDTH / 2 &&
        localX <= handleCenter + HOVER_WIDTH / 2;
      setHovered(isOver);
    }
  };

  const stepValue = useCallback(
    (direction: number, isLarge = false) => {
      if (disabled) return;
      const span = max - min;
      let next: number;

      if (step != null) {
        const last = Math.floor(span / step);
        const stops: number[] = [];
        for (let i = 0; i <= last; i++) stops.push(min + i * step);
        if (Math.abs(min + last * step - max) > 1e-6) stops.push(max);

        const count = isLarge
          ? Math.max(1, Math.round((span * 0.2) / step))
          : 1;
        if (direction > 0) {
          const higher = stops.filter((s) => s > currentValue + 1e-6);
          if (higher.length === 0) next = max;
          else next = higher[Math.min(count - 1, higher.length - 1)] ?? max;
        } else {
          const lower = stops.filter((s) => s < currentValue - 1e-6);
          if (lower.length === 0) next = min;
          else next = lower[Math.max(0, lower.length - count)] ?? min;
        }
      } else {
        const singleStep = keyboardStep ?? span * 0.05;
        const amount = isLarge ? Math.max(singleStep, span * 0.2) : singleStep;
        const raw = clamp(currentValue + amount * direction, min, max);
        const clean = Math.round(raw * 1e6) / 1e6;

        let target = clean;
        if (snapPoints && snapPoints.length > 0) {
          const holdShare =
            (snapRadius * SNAP_HOLD_SHARE / usableWidth) * span;
          for (const p of snapPoints) {
            const clampedP = clamp(p, min, max);
            if (
              Math.abs(clean - clampedP) <= holdShare &&
              Math.abs(currentValue - clampedP) > 1e-6
            ) {
              target = clampedP;
              break;
            }
          }
        }
        next = target;
      }

      if (Math.abs(next - currentValue) > 1e-9) {
        changeValue(next);
      }
    },
    [
      disabled,
      min,
      max,
      step,
      currentValue,
      keyboardStep,
      snapPoints,
      snapRadius,
      usableWidth,
      changeValue,
    ],
  );

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) return;
    beginInteraction();
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      stepValue(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      stepValue(-1);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      stepValue(1, true);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      stepValue(-1, true);
    } else if (e.key === "Home") {
      e.preventDefault();
      changeValue(min);
    } else if (e.key === "End") {
      e.preventDefault();
      changeValue(max);
    }
  };

  const { breaks, dots } = useMemo(() => {
    const span = max - min || 1;
    const b: Array<[number, number]> = [
      [handleLeft - GAP, handleLeft + handleWidth + GAP],
    ];
    const d: number[] = [];

    // 密集步长保留连续轨道，数值仍按步长取整。
    if (step == null && snapPoints && snapPoints.length > 0) {
      for (const p of snapPoints) {
        const f = (clamp(p, min, max) - min) / span;
        const x = PRESS_LINE_WIDTH / 2 + (layoutWidth - PRESS_LINE_WIDTH) * f;
        d.push(x);
        b.push([
          x - SNAP_DOT_DIAMETER / 2 - GAP,
          x + SNAP_DOT_DIAMETER / 2 + GAP,
        ]);
      }
    }

    b.sort((a, b) => a[0] - b[0]);
    return { breaks: b, dots: d };
  }, [max, min, handleLeft, handleWidth, step, snapPoints, layoutWidth]);

  const segments = useMemo(() => {
    const segs: Array<{
      start: number;
      length: number;
      fill: number;
      isLeading: boolean;
    }> = [];
    let from = 0;

    const allBreaks = [...breaks, [layoutWidth, layoutWidth] as [number, number]];
    for (const [start, end] of allBreaks) {
      const s = clamp(from, 0, layoutWidth);
      const to = clamp(start, 0, layoutWidth);
      const len = to - s;
      if (len > 0) {
        const fill = Math.min(len, TRACK_HEIGHT);
        const mid = (s + to) / 2;
        segs.push({
          start: s,
          length: len,
          fill,
          isLeading: mid < handleCenter,
        });
      }
      from = Math.max(from, end);
    }
    return segs;
  }, [breaks, layoutWidth, handleCenter]);

  const capsuleCenter =
    THUMB_WIDTH / 2 + (layoutWidth - THUMB_WIDTH) * clampedFraction;
  const lineCenter =
    HOVER_LINE_WIDTH / 2 + (layoutWidth - HOVER_LINE_WIDTH) * clampedFraction;
  const hoverBoxLeft =
    Math.min(capsuleCenter, lineCenter) - HOVER_WIDTH / 2;
  const hoverBoxRight =
    Math.max(capsuleCenter, lineCenter) + HOVER_WIDTH / 2;
  const hoverBoxWidth = hoverBoxRight - hoverBoxLeft;

  const resolvedActiveColor = activeColor ?? "var(--color-accent)";
  const trackColor = "var(--color-track)";
  const effectiveActiveColor = disabled
    ? "color-mix(in srgb, " + resolvedActiveColor + " 45%, transparent)"
    : resolvedActiveColor;

  return (
    <div
      ref={containerRef}
      role="slider"
      tabIndex={disabled ? undefined : 0}
      aria-valuenow={currentValue}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={String(currentValue)}
      aria-orientation="horizontal"
      aria-disabled={disabled || undefined}
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => {
        if (["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key) && !isPointerDownRef.current) endInteraction();
      }}
      onFocus={() => !disabled && setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (!isPointerDownRef.current) endInteraction();
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handlePointerUp}
      className={[
        "relative block w-full h-8 select-none touch-none outline-none",
        disabled ? "cursor-default" : pressed ? "cursor-grabbing" : "cursor-grab",
        className,
      ].filter(Boolean).join(" ")}
      {...restProps}
    >
      {segments.map((seg) => (
        <div
          key={seg.start}
          className="absolute pointer-events-none"
          style={{
            left: seg.start + "px",
            width: seg.length + "px",
            height: seg.fill + "px",
            top: (HIT_HEIGHT - seg.fill) / 2 + "px",
            borderRadius: seg.fill / 2 + "px",
            backgroundColor: seg.isLeading ? effectiveActiveColor : trackColor,
          }}
        />
      ))}

      {Array.from(new Set(dots)).map((dotX) => (
        <div
          key={dotX}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: dotX - SNAP_DOT_DIAMETER / 2 + "px",
            width: SNAP_DOT_DIAMETER + "px",
            height: SNAP_DOT_DIAMETER + "px",
            top: (HIT_HEIGHT - SNAP_DOT_DIAMETER) / 2 + "px",
            backgroundColor:
              dotX < handleCenter ? effectiveActiveColor : trackColor,
          }}
        />
      ))}

      <div
        className="absolute pointer-events-none"
        style={{
          left: handleLeft + "px",
          width: handleWidth + "px",
          height: handleHeight + "px",
          top: (HIT_HEIGHT - handleHeight) / 2 + "px",
          borderRadius: Math.min(handleWidth, handleHeight) / 2 + "px",
          backgroundColor: disabled
            ? "color-mix(in srgb, var(--color-on-accent) 70%, transparent)"
            : "var(--color-on-accent)",
          boxShadow: focused && !disabled
            ? "0 1px 6px rgba(0,0,0,0.3), 0 0 0 2px var(--color-accent), 0 0 4px 1px color-mix(in srgb, var(--color-accent) 35%, transparent)"
            : "0 1px 6px rgba(0,0,0,0.3)",
        }}
      />
      <div
        data-slot="slider-hover"
        className="absolute top-0 h-8"
        style={{
          left: hoverBoxLeft + "px",
          width: hoverBoxWidth + "px",
        }}
        onPointerEnter={() => !disabled && setHovered(true)}
        onPointerLeave={() => !disabled && !pressed && setHovered(false)}
      />

    </div>
  );
}
