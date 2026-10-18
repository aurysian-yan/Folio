import { act, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import lottie from "lottie-web/build/player/lottie_light";
import type { AnimationItem } from "lottie-web";
import { SidebarPageIndicator } from "./SidebarPageIndicator";

// Lottie 导入时创建透明占位图；动画本身仍由真实 SVG 渲染器验证。
vi.hoisted(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({ fillStyle: "", fillRect() {} }),
  });
});

let media: MediaQueryList & { matches: boolean };
beforeEach(() => {
  media = Object.assign(new EventTarget(), {
    matches: false,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addListener() {},
    removeListener() {},
  });
  vi.spyOn(window, "matchMedia").mockReturnValue(media);
});

function createPlayer() {
  const load = vi.spyOn(lottie, "loadAnimation");
  const screen = render(<SidebarPageIndicator page="navigation" />);
  const player = load.mock.results[0].value as AnimationItem & { advanceTime(ms: number): void };
  return { ...screen, player };
}

it("初始导航静止，切向筛选镜像正放，返回导航原向正放", () => {
  const { container, rerender, player } = createPlayer();
  const accents = container.querySelectorAll(".sidebar-page-indicator-accent");
  const opacity = () => Array.from(accents, (path) => Number(path.getAttribute("fill-opacity")));
  const indicator = container.querySelector(".sidebar-page-indicator");
  expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 25 9");
  expect(player.isLoaded).toBe(true);
  expect(player.isPaused).toBe(true);
  expect(player.totalFrames).toBe(27);
  expect(player.firstFrame + player.currentFrame).toBe(26);
  expect(opacity()).toEqual([1, 0]);
  expect(indicator?.getAttribute("data-mirrored")).toBe("false");

  rerender(<SidebarPageIndicator page="filters" />);
  expect(indicator?.getAttribute("data-mirrored")).toBe("true");
  expect(player.playDirection).toBe(1);
  expect(player.currentFrame).toBe(0);
  expect(opacity()).toEqual([0, 1]);
  act(() => player.advanceTime(200));
  expect(opacity().every((value) => value > 0 && value < 1)).toBe(true);
  act(() => player.advanceTime(1000));
  expect(player.firstFrame + player.currentFrame).toBe(26);
  expect(player.isPaused).toBe(true);
  expect(opacity()).toEqual([1, 0]);

  rerender(<SidebarPageIndicator page="navigation" />);
  expect(indicator?.getAttribute("data-mirrored")).toBe("false");
  expect(player.currentFrame).toBe(0);
  expect(player.playDirection).toBe(1);
  act(() => player.advanceTime(1000));
  expect(player.firstFrame + player.currentFrame).toBe(26);
  expect(player.isPaused).toBe(true);
  expect(opacity()).toEqual([1, 0]);
});

it("快速回切重新正放，重复当前分页不重播，卸载销毁播放器", () => {
  const { rerender, unmount, player } = createPlayer();
  rerender(<SidebarPageIndicator page="filters" />);
  act(() => player.advanceTime(150));
  const frame = player.currentFrame;
  expect(frame).toBeGreaterThan(0);
  expect(frame).toBeLessThan(26);
  rerender(<SidebarPageIndicator page="navigation" />);
  expect(player.currentFrame).toBe(0);
  expect(player.playDirection).toBe(1);
  expect(player.isPaused).toBe(false);
  act(() => player.advanceTime(150));
  const resumedFrame = player.currentFrame;
  rerender(<SidebarPageIndicator page="navigation" />);
  expect(player.currentFrame).toBe(resumedFrame);
  const destroy = vi.spyOn(player, "destroy");
  unmount();
  expect(destroy).toHaveBeenCalledOnce();
});

it("减少动态效果直接定位，偏好在播放期间改变时立即停到当前分页", () => {
  const { rerender, player } = createPlayer();
  rerender(<SidebarPageIndicator page="filters" />);
  act(() => player.advanceTime(150));
  act(() => {
    media.matches = true;
    media.dispatchEvent(new Event("change"));
  });
  expect(player.currentFrame).toBe(26);
  expect(player.isPaused).toBe(true);
  rerender(<SidebarPageIndicator page="navigation" />);
  expect(player.currentFrame).toBe(26);
  expect(player.isPaused).toBe(true);
});
