import { useCallback, useEffect, useRef, useState } from "react";

// 与 SwiftUI 的主窗口和设置窗口保持相同字号范围。
export const previewSizeRange = { min: 18, max: 106 } as const;

export type PreviewAppearance = {
  size: number;
  textColor: string | null;
  backgroundColor: string | null;
};

export type EditingPreview = { familyId: string | null; appearance: PreviewAppearance };

export function parsePreviewSize(value: string | null) {
  if (!value?.trim()) return 48;
  const size = Number(value);
  return Number.isFinite(size)
    ? Math.min(previewSizeRange.max, Math.max(previewSizeRange.min, Math.round(size)))
    : 48;
}

function parseStoredColor(value: string | null) {
  return value && /^#[\da-f]{8}$/i.test(value) ? value : null;
}

export function usePreviewAppearance(currentFamilyId: string | null) {
  const [state, setState] = useState(() => ({
    committed: {
      size: parsePreviewSize(localStorage.getItem("folio-preview-size")),
      textColor: parseStoredColor(localStorage.getItem("folio-preview-text-color")),
      backgroundColor: parseStoredColor(localStorage.getItem("folio-preview-background-color")),
    },
    editing: null as EditingPreview | null,
  }));
  const latest = useRef(state);
  const replace = useCallback((next: typeof state) => {
    latest.current = next;
    setState(next);
  }, []);

  const begin = useCallback(() => {
    const current = latest.current;
    // 整次操作固定当前卡片，悬停或切换选中项不会改变预览目标。
    if (!current.editing) replace({ ...current, editing: { familyId: currentFamilyId, appearance: current.committed } });
  }, [currentFamilyId, replace]);

  const update = useCallback((patch: Partial<PreviewAppearance>) => {
    begin();
    const current = latest.current;
    if (current.editing) replace({ ...current, editing: { ...current.editing, appearance: { ...current.editing.appearance, ...patch } } });
  }, [begin, replace]);

  const commit = useCallback(() => {
    const current = latest.current;
    if (current.editing) replace({ committed: current.editing.appearance, editing: null });
  }, [replace]);

  useEffect(() => {
    const values = {
      "folio-preview-size": String(state.committed.size),
      "folio-preview-text-color": state.committed.textColor,
      "folio-preview-background-color": state.committed.backgroundColor,
    };
    for (const [key, value] of Object.entries(values)) {
      if (localStorage.getItem(key) === value) continue;
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  }, [state.committed]);

  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      const fields = {
        "folio-preview-size": "size",
        "folio-preview-text-color": "textColor",
        "folio-preview-background-color": "backgroundColor",
      } as const;
      if (!event.key || !(event.key in fields)) return;
      const field = fields[event.key as keyof typeof fields];
      const value = field === "size" ? parsePreviewSize(event.newValue) : parseStoredColor(event.newValue);
      const current = latest.current;
      const committed = { ...current.committed, [field]: value };
      // 外部窗口的已确认设置不会打断本窗口尚未松手的操作。
      replace({ committed, editing: current.editing });
    };
    const finish = () => commit();
    window.addEventListener("storage", synchronize);
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("storage", synchronize);
      window.removeEventListener("blur", finish);
    };
  }, [commit, replace]);

  return { ...state, current: state.editing?.appearance ?? state.committed, begin, update, commit };
}
