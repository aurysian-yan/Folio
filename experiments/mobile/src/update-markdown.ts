export interface NoteBlock { kind: 'heading' | 'paragraph' | 'list'; text: string }
export interface NoteSpan { text: string; url?: string }

// 更新日志仅渲染原生文字与 HTTPS 链接，不执行 HTML 或嵌入图片。
export function noteBlocks(markdown: string): NoteBlock[] {
  return markdown.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '').split(/\n\s*\n/).flatMap((paragraph) => {
    const lines = paragraph.trim().split('\n');
    if (lines.every((line) => !/^\s*(?:#{1,6}\s|[-*+]\s|\d+\.\s)/.test(line))) return paragraph.trim() ? [{ kind: 'paragraph' as const, text: paragraph.trim() }] : [];
    return lines.filter((line) => line.trim()).map((line) => /^\s*#{1,6}\s/.test(line)
      ? { kind: 'heading' as const, text: line.replace(/^\s*#{1,6}\s+/, '') }
      : /^\s*(?:[-*+]\s|\d+\.\s)/.test(line) ? { kind: 'list' as const, text: line.replace(/^\s*(?:[-*+]\s|\d+\.\s)/, '') }
        : { kind: 'paragraph' as const, text: line });
  });
}
export function noteSpans(text: string): NoteSpan[] {
  const clean = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\*\*([^*]+)\*\*|`([^`]+)`/g, '$1$2');
  const pattern = /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s)]+)/g;
  const spans: NoteSpan[] = []; let end = 0;
  for (const match of clean.matchAll(pattern)) {
    spans.push({ text: clean.slice(end, match.index) });
    const url = match[2] ?? match[3]!;
    try {
      const parsed = new URL(url);
      spans.push({ text: match[1] ?? url, ...(!parsed.username && !parsed.password && parsed.protocol === 'https:' ? { url } : {}) });
    } catch { spans.push({ text: match[1] ?? url }); }
    end = match.index! + match[0].length;
  }
  spans.push({ text: clean.slice(end) });
  return spans.filter((span) => span.text);
}
