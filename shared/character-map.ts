// 字符表共享传输契约，各端只负责页面与剪贴板。
export interface CharacterMapSelection { faceId: string; revisionId: string; sourcePath: string }
export interface CharacterEntry { codepoint: number; glyphId: number; script: string }
export interface CharacterMapInfo {
  handle: string; revisionId: string; sourcePath: string; faceIndex: number;
  count: number; scripts: { name: string; count: number }[];
}
export interface CharacterPage { entries: CharacterEntry[]; total: number; offset: number }
export interface CharacterQuery { handle: string; text: string; script: string | null; offset: number; limit: number }
export interface CharacterGlyph {
  glyphId: number; status: 'ready' | 'empty' | 'error'; dataUrl: string | null; error: string | null;
}
export interface CharacterRenderRequest {
  handle: string; glyphIds: number[]; axes: Record<string, number>; size: number;
  foreground: [number, number, number, number];
}
export interface CharacterMapBridge {
  openCharacterMap(request: string): Promise<string>;
  queryCharacterMap(request: string): Promise<string>;
  renderCharacterMap(request: string): Promise<string>;
  closeCharacterMap(handle: string): Promise<void>;
}

export function createCharacterMapClient(bridge: CharacterMapBridge) {
  return {
    open: async (selection: CharacterMapSelection): Promise<CharacterMapInfo> => JSON.parse(await bridge.openCharacterMap(JSON.stringify(selection))),
    query: async (request: CharacterQuery): Promise<CharacterPage> => JSON.parse(await bridge.queryCharacterMap(JSON.stringify(request))),
    render: async (request: CharacterRenderRequest): Promise<CharacterGlyph[]> => JSON.parse(await bridge.renderCharacterMap(JSON.stringify(request))),
    close: (handle: string) => bridge.closeCharacterMap(handle),
  };
}
export type CharacterMapClient = ReturnType<typeof createCharacterMapClient>;
export const characterPageSize = 256;
export const codepointLabel = (value: number) => `U+${value.toString(16).toUpperCase().padStart(4, '0')}`;
export const characterText = (entry: CharacterEntry) => String.fromCodePoint(entry.codepoint);

export function characterMapError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/characterMap\.error\.[A-Za-z]+/)?.[0] ?? 'characterMap.error.renderFailed';
}

export function characterForeground(color: string): [number, number, number, number] {
  const hex = color.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hex) return [0, 2, 4].map((offset) => parseInt(hex[1]!.slice(offset, offset + 2), 16)).concat(hex[2] ? parseInt(hex[2], 16) : 255) as [number, number, number, number];
  const rgb = color.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, /]+([\d.]+))?\)$/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Math.round(Number(rgb[4] ?? 1) * 255)];
  return [0, 0, 0, 255];
}

// 打开过程中退出也会释放句柄，所有回调必须检查当前请求是否仍有效。
export class CharacterMapSession {
  private closed = false;
  private info: CharacterMapInfo | null = null;
  private readonly client: CharacterMapClient;
  constructor(client: CharacterMapClient) { this.client = client; }
  async open(selection: CharacterMapSelection) {
    const info = await this.client.open(selection);
    if (this.closed) { await this.client.close(info.handle); return null; }
    this.info = info;
    return info;
  }
  query(request: Omit<CharacterQuery, 'handle'>) {
    return this.client.query({ ...request, handle: this.handle() });
  }
  render(request: Omit<CharacterRenderRequest, 'handle'>) {
    return this.client.render({ ...request, handle: this.handle() });
  }
  close() {
    this.closed = true;
    if (this.info) void this.client.close(this.info.handle).catch(() => {});
  }
  private handle() {
    if (this.closed || !this.info) throw new Error('characterMap.error.sessionClosed');
    return this.info.handle;
  }
}
