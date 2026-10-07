import { Button } from "@heroui/react";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { LibraryHero } from "../components/LibraryHero";
import { createLibraryHero, type HeroAction, type HeroInput } from "../library-hero";
import i18n from "../i18n";
import "../style.css";
import "./hero-preview.css";

const base: HeroInput = {
  snapshot: { familyCount: 670, faceCount: 1200, variableFamilyCount: 42, recentCount: 12, syncSummary: { syncedCount: 670, cloudOnlyCount: 0, localOnlyFingerprints: [] }, roots: [], fontStateCounts: {}, userFontGroups: [], health: { damagedFiles: 0, duplicateSources: 0, multipleRevisions: 0, metadataConflicts: 0 } },
  profile: { serverUrl: "https://webdav.123pan.com", remoteDirectory: "Folio", username: "", automatic: true },
  status: { configured: true, running: false, phase: "同步完成", stage: "已同步", percent: 100, stageCompleted: 0, stageTotal: 0, uploadedFiles: 0, downloadedFiles: 0, publishedEvents: 0, items: [], error: null },
  fonts: [], conflicts: [], cloudLoaded: true,
};
const cases: [string, HeroInput][] = [
  ["正常", base],
  ["字体损坏", { ...base, snapshot: { ...base.snapshot!, health: { ...base.snapshot!.health, damagedFiles: 8 } } }],
  ["发现更新", { ...base, updateCount: 3 }],
  ["云端待下载", { ...base, status: { ...base.status!, percent: 0, stage: "等待下载", items: Array.from({ length: 12 }, (_, index) => ({ fingerprint: `remote-${index}`, action: "download", status: "pending" })) } }],
  ["本地待上传", { ...base, status: { ...base.status!, percent: 0, stage: "等待上传", items: Array.from({ length: 32 }, (_, index) => ({ fingerprint: `local-${index}`, action: "upload", status: "pending" })) } }],
  ["云端空间不足", { ...base, storage: { availableBytes: 0.6 * 1024 ** 3, low: true } }],
  ["字体冲突", { ...base, conflicts: Array.from({ length: 4 }, (_, index) => ({ id: String(index), kind: index < 2 ? "font_revision" : "font_name", title: "字体冲突", detail: "", localFingerprint: null, remoteFingerprint: null })) }],
];
const actionNames: Record<HeroAction, string> = { fontHealth: "字体健康", cloudFonts: "云端字体", cloudSettings: "云同步设置" };

export function HeroPreview() {
  const [theme, setTheme] = useState("light");
  const [action, setAction] = useState<HeroAction | null>(null);
  const [syncState, setSyncState] = useState("synced");
  const [width, setWidth] = useState("946");
  const [language, setLanguage] = useState(i18n.language);
  const showAction = (value: HeroAction) => setAction(value);
  return <main className="hero-preview">
    <nav className="hero-preview-controls" aria-label="预览选项">
      <Button variant="secondary" onPress={() => { const next = theme === "light" ? "dark" : "light"; document.documentElement.dataset.theme = next; setTheme(next); }}>{theme === "light" ? "深色" : "浅色"}</Button>
      <label>云同步状态 <select value={syncState} onChange={(event) => setSyncState(event.target.value)}>
        <option value="synced">已同步</option><option value="disconnected">未连接</option><option value="running">同步中</option><option value="error">同步失败</option><option value="readError">读取失败</option>
      </select></label>
      <label>组件宽度 <select value={width} onChange={(event) => setWidth(event.target.value)}><option value="946">946px</option><option value="480">480px</option><option value="308">308px</option></select></label>
      <label>界面语言 <select value={language} onChange={(event) => { setLanguage(event.target.value); void i18n.changeLanguage(event.target.value); }}><option value="zh-CN">中文</option><option value="en">English</option></select></label>
      {action && <span role="status">已选择：{actionNames[action]}</span>}
    </nav>
    {cases.map(([name, input]) => {
      const state: HeroInput = syncState === "readError" ? { ...input, cloudReadError: true }
        : syncState === "disconnected" ? { ...input, profile: null }
        : syncState === "running" ? { ...input, status: { ...input.status!, running: true, percent: 38 } }
        : syncState === "error" ? { ...input, status: { ...input.status!, error: "网络暂时不可用" } } : input;
      return <section key={name} className="hero-preview-case" style={{ width: Number(width) }} aria-label={name}><h2>{name}</h2><LibraryHero presentation={createLibraryHero(state)} onAction={showAction} /></section>;
    })}
  </main>;
}

createRoot(document.getElementById("root")!).render(<HeroPreview />);
