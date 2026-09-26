import { createElement, forwardRef, type SVGProps } from "react";
import {
  animatedIconShapes,
  type AnimatedIconName,
  type AnimatedShape,
} from "./animated-icons-data";

// 侧边栏与收藏夹专用的描边图标：悬停或键盘聚焦时按路径依次绘制。
type AnimatedIconProps = SVGProps<SVGSVGElement> & {
  name: AnimatedIconName;
};

// pathLength 归一化后，各图形可共用 stroke-dasharray: 1 的绘制动画。
function renderShape(shape: AnimatedShape, index: number) {
  return createElement(shape.tag, {
    key: index,
    ...shape.attrs,
    pathLength: 1,
    style: { animationDelay: `${index * 70}ms` },
  });
}

export const AnimatedIcon = forwardRef<SVGSVGElement, AnimatedIconProps>(
  function AnimatedIcon({ name, className, ...props }, ref) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        width="1em"
        height="1em"
        fill="none"
        stroke="currentColor"
        strokeWidth={16}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className ? `animated-icon ${className}` : "animated-icon"}
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {animatedIconShapes[name].map((shape, index) => renderShape(shape, index))}
      </svg>
    );
  },
);
