import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LibraryHero } from "./LibraryHero";

it("Hero 标题与云同步入口使用独立的可访问操作", () => {
  const onAction = vi.fn();
  const { getByRole, queryByRole } = render(<LibraryHero presentation={{ kind: "damaged", title: "发现 8 个损坏字体", subtitle: "670 个字族", action: "fontHealth", actionLabel: "查看字体健康", sync: { state: "disconnected", text: "连接云端", action: "cloudSettings" } }} onAction={onAction} />);
  expect(getByRole("heading", { level: 1 }).textContent).toContain("发现 8 个损坏字体");
  fireEvent.click(getByRole("button", { name: "发现 8 个损坏字体，查看字体健康" }));
  expect(onAction).toHaveBeenLastCalledWith("fontHealth");
  fireEvent.click(getByRole("button", { name: "连接云端" }));
  expect(onAction).toHaveBeenLastCalledWith("cloudSettings");
  expect(queryByRole("img")).toBeNull();
});
