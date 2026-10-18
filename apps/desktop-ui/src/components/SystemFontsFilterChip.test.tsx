import { act, fireEvent, render } from "@testing-library/react";
import { expect, it } from "vitest";
import { SystemFontsFilterChip } from "./SystemFontsFilterChip";

it("禁用标签保留同步选中状态，并在聚焦时提示平台限制", async () => {
  const { getByRole, findByRole } = render(
    <SystemFontsFilterChip isSelected />,
  );
  const chip = getByRole("button", { name: "隐藏系统字体" });
  expect(chip.getAttribute("aria-disabled")).toBe("true");
  expect(chip.getAttribute("aria-pressed")).toBe("true");

  act(() => chip.focus());
  fireEvent.focusIn(chip);
  const tooltip = await findByRole("tooltip");
  expect(tooltip.textContent).toContain("该功能仅在 macOS 可用");
});
