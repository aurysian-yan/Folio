import type { PreviewFontDto } from "./types";

// 字体字节使用视图共享原始响应，仅解码小型元数据。
export function decodePreviewFont(packet: ArrayBuffer): PreviewFontDto {
  if (packet.byteLength < 5) throw new Error("字体预览数据不完整");
  const length = new DataView(packet).getUint32(0, true);
  if (length === 0 || length >= packet.byteLength - 4) throw new Error("字体预览数据不完整");
  const metadata: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(packet, 4, length)));
  if (!metadata || typeof metadata !== "object" || !("coverage" in metadata) || !("sample" in metadata) ||
      typeof metadata.sample !== "string" || !Array.isArray(metadata.coverage)) throw new Error("字体预览数据无效");
  let end = -1;
  for (const range of metadata.coverage) {
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger) ||
        range[0] <= end || range[0] < 0 || range[1] < range[0] || range[1] > 0x10ffff) throw new Error("字体预览数据无效");
    end = range[1];
  }
  return { bytes: new Uint8Array(packet, 4 + length), coverage: metadata.coverage, sample: metadata.sample };
}
