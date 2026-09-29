import { expect, it } from "vitest";
import { gridGeometry, visibleRows } from "./grid-layout";

it("四种视图沿用卡片尺寸与间距，窄窗口仍保留一列", () => {
  expect(gridGeometry(640, "compact").columns).toBe(4);
  expect(gridGeometry(640, "large").columns).toBe(2);
  expect(gridGeometry(640, "expanded").columns).toBe(1);
  expect(gridGeometry(640, "list")).toMatchObject({ columns: 1, cardHeight: 84, gap: 8 });
  expect(gridGeometry(100, "compact").columns).toBe(1);
});

it("挂载数量随视口保持有界，并单独保留离屏焦点行", () => {
  const rows = visibleRows(10000, 4, 160, 16000, 480, 2);
  expect(rows).toEqual([0, 98, 99, 100, 101, 102, 103, 104]);
  expect(visibleRows(20000, 4, 160, 16000, 480).length).toBe(rows.length - 1);
  expect(visibleRows(0, 4, 160, 0, 480)).toEqual([]);
});
