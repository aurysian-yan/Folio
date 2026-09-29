import type { CloudFontDto, LibrarySnapshotDto, SyncConflictDto, SyncProfileDto, SyncStatusDto } from "./types";

export type HeroKind = "normal" | "damaged" | "update" | "cloudAhead" | "localUnsynced" | "cloudStorageLow" | "conflict";
export type HeroAction = "fontHealth" | "cloudFonts" | "cloudSettings";
export type HeroSyncState = "disconnected" | "checking" | "connected" | "synced" | "pending" | "running" | "error";

export interface HeroPresentation {
  kind: HeroKind;
  title: string;
  subtitle: string;
  detail?: string;
  action?: HeroAction;
  actionLabel?: string;
  sync: { state: HeroSyncState; text: string; action?: HeroAction };
}

export interface HeroInput {
  snapshot: LibrarySnapshotDto | null;
  profile: SyncProfileDto | null;
  status: SyncStatusDto | null;
  fonts: CloudFontDto[];
  conflicts: SyncConflictDto[];
  cloudLoaded: boolean;
  cloudReadError?: boolean;
  // 更新检测与容量查询就绪后，由调用方提供真实结果。
  updateCount?: number;
  storage?: { availableBytes: number; low: boolean };
}

export function heroConnectionName(profile: SyncProfileDto): string {
  try {
    const host = new URL(profile.serverUrl).hostname;
    return /(^|\.)123pan\.(com|cn)$/i.test(host) ? "123PAN" : host || "WebDAV";
  } catch {
    return "WebDAV";
  }
}

export function createLibraryHero(input: HeroInput): HeroPresentation {
  const { snapshot, profile, status, fonts, conflicts, updateCount = 0, storage } = input;
  const count = snapshot?.familyCount ?? 0;
  const summary = snapshot
    ? `${count} 个字族 · ${snapshot.variableFamilyCount} 个可变字族 · ${snapshot.recentCount} 个最近访问`
    : "正在读取字体库…";
  const connection = profile ? heroConnectionName(profile) : "云端";
  // 队列按文件指纹去重；仅在云端保留的字体不等同于待下载任务。
  const uploads = new Set(status?.items.filter((item) => item.action === "upload" && item.status !== "done").map((item) => item.fingerprint));
  const downloads = new Set(status?.items.filter((item) => item.action === "download" && item.status !== "done").map((item) => item.fingerprint));
  const cloudOnly = new Set(fonts.filter((font) => font.cloudOnly && !font.deleted).map((font) => font.fingerprint));
  const availableRemote = new Set([...downloads, ...cloudOnly]);
  const sync = syncPresentation(input, connection, uploads.size, downloads.size);
  const base = { subtitle: summary, sync };

  // 与 SwiftUI 一致，字体损坏优先；其后先提示冲突与空间问题。
  if (snapshot && snapshot.health.damagedFiles > 0) {
    return { ...base, kind: "damaged", title: `发现 ${snapshot.health.damagedFiles} 个损坏字体`, action: "fontHealth", actionLabel: "查看字体健康" };
  }
  const fontConflicts = conflicts.filter((conflict) => conflict.kind.startsWith("font_"));
  if (snapshot && snapshot.health.metadataConflicts > 0) {
    return { ...base, kind: "conflict", title: `发现 ${snapshot.health.metadataConflicts} 个字族存在冲突`,
      subtitle: `${snapshot.health.multipleRevisions} 个字族有多个版本 · ${snapshot.health.metadataConflicts} 个字族有元数据冲突`,
      detail: summary, action: "fontHealth", actionLabel: "查看字体冲突" };
  }
  if (profile && fontConflicts.length > 0) {
    const revisions = fontConflicts.filter((conflict) => conflict.kind === "font_revision").length;
    const names = fontConflicts.filter((conflict) => conflict.kind === "font_name").length;
    const other = fontConflicts.length - revisions - names;
    return { ...base, kind: "conflict", title: `发现 ${fontConflicts.length} 个字体同步冲突`,
      subtitle: [revisions ? `${revisions} 个版本冲突` : "", names ? `${names} 个命名冲突` : "", other ? `${other} 个其他字体冲突` : ""].filter(Boolean).join(" · "),
      detail: summary, action: "cloudSettings", actionLabel: "处理同步冲突" };
  }
  if (profile && (storage?.low || /可用空间不足|状态码\s*507|insufficient storage/i.test(status?.error ?? ""))) {
    return { ...base, kind: "cloudStorageLow", title: storage?.low ? "云端空间即将用尽" : "云端空间不足",
      subtitle: storage ? `${connection} 剩余 ${formatStorage(storage.availableBytes)}` : "请释放云端空间后再同步字体",
      detail: summary, action: "cloudSettings", actionLabel: "查看云同步设置" };
  }
  if (updateCount > 0) {
    return { ...base, kind: "update", title: `检测到 ${updateCount} 个字体更新`, action: "fontHealth", actionLabel: "查看字体版本" };
  }
  if (profile && availableRemote.size > 0) {
    return { ...base, kind: "cloudAhead", title: downloads.size > 0 ? `云端有 ${downloads.size} 个字体待下载` : `云端有 ${cloudOnly.size} 个字体可下载`,
      action: "cloudFonts", actionLabel: "查看云端字体" };
  }
  if (profile && uploads.size > 0) {
    return { ...base, kind: "localUnsynced", title: `本地有 ${uploads.size} 个字体待上传`, action: "cloudSettings", actionLabel: "查看同步进度" };
  }
  return { ...base, kind: "normal", title: snapshot ? (count > 0 ? `现有 ${count} 个字族，随时可用` : "添加字体，开始你的字库") : "正在读取字体库…",
    subtitle: snapshot ? `${snapshot.health.damagedFiles} 个损坏字体 · ${snapshot.variableFamilyCount} 个可变字族 · ${snapshot.recentCount} 个最近访问` : "读取完成后即可搜索、筛选与预览" };
}

function syncPresentation(input: HeroInput, connection: string, uploads: number, downloads: number): HeroPresentation["sync"] {
  const { profile, status, cloudLoaded } = input;
  if (!cloudLoaded) return { state: "checking", text: "正在读取同步状态…" };
  if (input.cloudReadError) return { state: "error", text: "无法读取同步状态", action: "cloudSettings" };
  if (!profile) return { state: "disconnected", text: "未连接云端", action: "cloudSettings" };
  if (!status) return { state: "checking", text: `${connection} · 读取中…` };
  if (status.running) {
    const progress = Math.round(Math.min(100, Math.max(0, status.percent)));
    return { state: "running", text: `${connection} · 同步中 ${progress}%` };
  }
  if (status.error) return { state: "error", text: `${connection} 同步未完成`, action: "cloudSettings" };
  if (uploads + downloads > 0) return { state: "pending", text: [connection, uploads > 0 ? `${uploads} 个待上传` : "", downloads > 0 ? `${downloads} 个待下载` : ""].filter(Boolean).join(" · "), action: "cloudSettings" };
  if (input.conflicts.length > 0) return { state: "pending", text: `${connection} · ${input.conflicts.length} 个同步冲突待处理`, action: "cloudSettings" };
  if (status.percent === 100 && status.stage === "已同步") return { state: "synced", text: `云字体库已同步到 ${connection}` };
  return { state: "connected", text: `已连接 ${connection}`, action: "cloudSettings" };
}

function formatStorage(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(0, bytes / 1024 ** 2).toFixed(0)} MB`;
}
