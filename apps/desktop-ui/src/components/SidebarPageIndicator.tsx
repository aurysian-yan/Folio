import { useLayoutEffect, useRef } from "react";
import lottie from "lottie-web/build/player/lottie_light";
import type { AnimationItem } from "lottie-web";
import animationData from "../assets/sidebar-pages.json";

// 原稿正放从筛选回到导航，切向筛选时镜像正放。
const lastFrame = Math.floor(animationData.op - animationData.ip) - 1;

export function SidebarPageIndicator({ page }: { page: "navigation" | "filters" }) {
  const container = useRef<HTMLSpanElement>(null);
  const animation = useRef<AnimationItem | null>(null);
  const currentPage = useRef(page);

  useLayoutEffect(() => {
    if (!container.current) return;
    const player = lottie.loadAnimation({
      container: container.current,
      renderer: "svg",
      loop: false,
      autoplay: false,
      animationData: structuredClone(animationData),
      rendererSettings: { focusable: false },
    });
    animation.current = player;
    player.goToAndStop(lastFrame, true);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stopMotion = () => {
      if (reducedMotion.matches) player.goToAndStop(lastFrame, true);
    };
    reducedMotion.addEventListener("change", stopMotion);
    return () => {
      reducedMotion.removeEventListener("change", stopMotion);
      player.destroy();
      animation.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (page === currentPage.current) return;
    currentPage.current = page;
    const player = animation.current;
    if (!player) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      player.goToAndStop(lastFrame, true);
      return;
    }
    player.goToAndPlay(0, true);
  }, [page]);

  return <span ref={container} className="sidebar-page-indicator" data-mirrored={page === "filters"} aria-hidden="true" />;
}
