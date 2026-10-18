// 设置分组统一使用平滑轮廓与淡描边。
import { useSmoothCorners } from "@lisse/react";
import { type HTMLAttributes, useRef } from "react";

const groupCorners = { radius: 16, smoothing: 0.6 } as const;

export function SettingsGroup({
  as: Component = "section",
  className = "",
  style,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "section" | "header" }) {
  const ref = useRef<HTMLElement>(null);
  useSmoothCorners(ref, groupCorners, {
    autoEffects: false,
    fallbackBorderRadius: "16px",
    effects: {
      innerBorder: { width: 1, color: "var(--line)", opacity: 0.6 },
    },
  });

  return (
    <Component
      {...props}
      ref={ref}
      className={`settings-group ${className}`.trim()}
      style={{ borderRadius: groupCorners.radius, ...style }}
    >
      {children}
    </Component>
  );
}
