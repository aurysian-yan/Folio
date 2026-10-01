import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { FacetGroup } from "./FacetGroup";
import type { FacetOptionDto } from "../types";

const options: FacetOptionDto[] = [
  { kind: "categories", value: "SansSerif", label: "无衬线", familyCount: 163 },
  { kind: "categories", value: "Serif", label: "衬线", familyCount: 88 },
];

it("默认折叠，展开后以标签展示选项并回传筛选值", () => {
  const onToggle = vi.fn();
  const { getByRole, queryByRole } = render(
    <FacetGroup title="类型" options={options} selected={[]} onToggle={onToggle} />,
  );
  const header = getByRole("button", { name: "类型" });
  expect(header.getAttribute("aria-expanded")).toBe("false");
  expect(queryByRole("button", { name: /无衬线/ })).toBeNull();
  fireEvent.click(header);
  expect(header.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(getByRole("button", { name: "衬线，88 个字族" }));
  expect(onToggle).toHaveBeenCalledWith("Serif");
});

it("已选项显示按下状态与选中样式", () => {
  const { getByRole, container } = render(
    <FacetGroup
      title="类型"
      options={options}
      selected={["SansSerif"]}
      defaultOpen
      onToggle={() => {}}
    />,
  );
  const selected = getByRole("button", { name: "无衬线，163 个字族" });
  expect(selected.getAttribute("aria-pressed")).toBe("true");
  expect(selected.classList.contains("selected")).toBe(true);
  expect(selected.querySelector(".facet-chip-check")).toBeTruthy();
  expect(container.querySelectorAll(".facet-chip-check")).toHaveLength(1);
  expect(getByRole("button", { name: "衬线，88 个字族" }).getAttribute("aria-pressed")).toBe("false");
});
