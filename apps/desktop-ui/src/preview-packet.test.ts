import { expect, it } from "vitest";
import { decodePreviewFont } from "./preview-packet";
import { packet } from "./test/fixtures";

it("解码二进制包，保留非 BMP 字符，字体数据不复制", () => {
  const source = packet([[32, 126], [0x1f600, 0x1f600]], "Aa😀");
  const font = decodePreviewFont(source);
  expect(font.bytes.buffer).toBe(source);
  expect([...font.bytes]).toEqual([0, 1, 0, 0]);
  expect(font.sample).toBe("Aa😀");
  expect(font.coverage).toEqual([[32, 126], [0x1f600, 0x1f600]]);
});

it("拒绝截断头、越界长度、缺少字体及无效覆盖区间", () => {
  for (const invalid of [new ArrayBuffer(3), new Uint8Array([255, 255, 255, 255, 0]).buffer,
    packet([[3, 1]]), packet([[2, 3], [3, 5]]), packet([[0, 0x110000]])]) {
    expect(() => decodePreviewFont(invalid)).toThrow();
  }
  const noFont = packet().slice(0, -4);
  expect(() => decodePreviewFont(noFont)).toThrow();
});
