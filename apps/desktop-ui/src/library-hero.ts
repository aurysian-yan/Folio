import i18n from "./i18n";
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
    ? i18n.t("library.summary", { families: count, variable: snapshot.variableFamilyCount, recent: snapshot.recentCount })
    : i18n.t("common.loadingLibrary");
  const connection = profile ? heroConnectionName(profile) : i18n.t("navigation.cloud");
  // 队列按文件指纹去重；仅在云端保留的字体不等同于待下载任务。
  const uploads = new Set(status?.items.filter((item) => item.action === "upload" && item.status !== "done").map((item) => item.fingerprint));
  const downloads = new Set(status?.items.filter((item) => item.action === "download" && item.status !== "done").map((item) => item.fingerprint));
  const cloudOnly = new Set(fonts.filter((font) => font.cloudOnly && !font.deleted).map((font) => font.fingerprint));
  const availableRemote = new Set([...downloads, ...cloudOnly]);
  const sync = syncPresentation(input, connection, uploads.size, downloads.size);
  const base = { subtitle: summary, sync };

  // 与 SwiftUI 一致，字体损坏优先；其后先提示冲突与空间问题。
  if (snapshot && snapshot.health.damagedFiles > 0) {
    return { ...base, kind: "damaged", title: i18n.t("health.damagedCount", { count: snapshot.health.damagedFiles }), action: "fontHealth", actionLabel: i18n.t("health.viewFontHealth") };
  }
  const fontConflicts = conflicts.filter((conflict) => conflict.kind.startsWith("font_"));
  if (snapshot && snapshot.health.metadataConflicts > 0) {
    return { ...base, kind: "conflict", title: i18n.t("health.conflictCountShort", { count: snapshot.health.metadataConflicts }),
      subtitle: i18n.t("library.summaryConflict", { revisions: snapshot.health.multipleRevisions, conflicts: snapshot.health.metadataConflicts }),
      detail: summary, action: "fontHealth", actionLabel: i18n.t("health.viewConflicts") };
  }
  if (profile && fontConflicts.length > 0) {
    const revisions = fontConflicts.filter((conflict) => conflict.kind === "font_revision").length;
    const names = fontConflicts.filter((conflict) => conflict.kind === "font_name").length;
    const other = fontConflicts.length - revisions - names;
    return { ...base, kind: "conflict", title: i18n.t("cloud.conflictCount", { count: fontConflicts.length }),
      subtitle: [revisions ? i18n.t("health.revisions", { count: revisions }) : "", names ? i18n.t("health.names", { count: names }) : "", other ? i18n.t("health.otherConflicts", { count: other }) : ""].filter(Boolean).join(" · "),
      detail: summary, action: "cloudSettings", actionLabel: i18n.t("cloud.handleConflicts") };
  }
  if (profile && (storage?.low || /可用空间不足|状态码\s*507|insufficient storage/i.test(status?.error ?? ""))) {
    return { ...base, kind: "cloudStorageLow", title: storage?.low ? i18n.t("cloud.spaceAlmostFull") : i18n.t("cloud.spaceLow"),
      subtitle: storage ? i18n.t("cloud.remainingSpace", { connection, size: formatStorage(storage.availableBytes) }) : i18n.t("cloud.spaceLowHint"),
      detail: summary, action: "cloudSettings", actionLabel: i18n.t("cloud.viewCloudSettings") };
  }
  if (updateCount > 0) {
    return { ...base, kind: "update", title: i18n.t("desktop.updatesAvailable", { count: updateCount }), action: "fontHealth", actionLabel: i18n.t("health.viewVersions") };
  }
  if (profile && availableRemote.size > 0) {
    return { ...base, kind: "cloudAhead", title: downloads.size > 0 ? i18n.t("cloud.pendingDownloads", { count: downloads.size }) : i18n.t("cloud.cloudOnlyAvailable", { count: cloudOnly.size }),
      action: "cloudFonts", actionLabel: i18n.t("cloud.viewCloudFonts") };
  }
  if (profile && uploads.size > 0) {
    return { ...base, kind: "localUnsynced", title: i18n.t("cloud.pendingUploads", { count: uploads.size }), action: "cloudSettings", actionLabel: i18n.t("cloud.viewSyncProgress") };
  }
  return { ...base, kind: "normal", title: snapshot ? (count > 0 ? i18n.t("library.availableNow", { count }) : i18n.t("library.emptyAddFonts")) : i18n.t("common.loadingLibrary"),
    subtitle: snapshot ? i18n.t("library.summaryDamaged", { damaged: snapshot.health.damagedFiles, variable: snapshot.variableFamilyCount, recent: snapshot.recentCount }) : i18n.t("library.loadingList") };
}

function syncPresentation(input: HeroInput, connection: string, uploads: number, downloads: number): HeroPresentation["sync"] {
  const { profile, status, cloudLoaded } = input;
  if (!cloudLoaded) return { state: "checking", text: i18n.t("common.loading") };
  if (input.cloudReadError) return { state: "error", text: i18n.t("cloud.readStatusError"), action: "cloudSettings" };
  if (!profile) return { state: "disconnected", text: i18n.t("cloud.notConnected"), action: "cloudSettings" };
  if (!status) return { state: "checking", text: i18n.t("cloud.readingCloud", { connection }) };
  if (status.running) {
    const progress = Math.round(Math.min(100, Math.max(0, status.percent)));
    return { state: "running", text: i18n.t("cloud.syncingCloud", { connection, percent: progress }) };
  }
  if (status.error) return { state: "error", text: `${connection} ${i18n.t("cloud.syncIncomplete")}`, action: "cloudSettings" };
  if (uploads + downloads > 0) return { state: "pending", text: [connection, uploads > 0 ? i18n.t("cloud.uploadedFiles", { count: uploads }) : "", downloads > 0 ? i18n.t("cloud.downloadedFiles", { count: downloads }) : ""].filter(Boolean).join(" · "), action: "cloudSettings" };
  if (input.conflicts.length > 0) return { state: "pending", text: i18n.t("cloud.conflictsPending", { connection, count: input.conflicts.length }), action: "cloudSettings" };
  if (status.percent === 100 && status.stage === "已同步") return { state: "synced", text: i18n.t("cloud.librarySyncedTo", { connection }) };
  return { state: "connected", text: i18n.t("cloud.connectedTo", { connection }), action: "cloudSettings" };
}

function formatStorage(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(0, bytes / 1024 ** 2).toFixed(0)} MB`;
}
