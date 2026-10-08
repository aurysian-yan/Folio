// 各端共用 Hero 内容与同步语义，布局由客户端分别实现。
export type HeroKind = "normal" | "damaged" | "update" | "cloudAhead" | "localUnsynced" | "cloudStorageLow" | "conflict";
export type HeroAction = "fontHealth" | "cloudFonts" | "cloudSettings";
export type HeroSyncState = "disconnected" | "checking" | "connected" | "synced" | "pending" | "running" | "error";
export type HeroTranslate = (key: string, values?: Record<string, string | number>) => string;

export interface FontSyncSummary {
  syncedCount: number;
  cloudOnlyCount: number;
  localOnlyFingerprints: string[];
}

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
  snapshot: {
    familyCount: number; variableFamilyCount: number; recentCount: number;
    syncSummary?: FontSyncSummary | null;
    health: { damagedFiles: number; multipleRevisions: number; metadataConflicts: number };
  } | null;
  profile: { serverUrl: string } | null;
  status: {
    running: boolean; percent: number; stage: string; error: string | null;
    items: { fingerprint: string; action: string; status: string }[];
  } | null;
  fonts: { fingerprint: string; cloudOnly: boolean; deleted: boolean }[];
  conflicts: { kind: string }[];
  cloudLoaded: boolean;
  cloudReadError?: boolean;
  connectionName?: string;
  updateCount?: number;
  storage?: { availableBytes: number; low: boolean };
}

export function heroConnectionName(profile: { serverUrl: string }, t: HeroTranslate): string {
  try {
    const host = new URL(profile.serverUrl).hostname;
    if (/(^|\.)123pan\.(com|cn)$/i.test(host)) return "123PAN";
    if (/(^|\.)jianguoyun\.com$/i.test(host)) return t("macos.providerJianguoyun");
    return host || "WebDAV";
  } catch { return "WebDAV"; }
}

export function createLibraryHero(input: HeroInput, t: HeroTranslate): HeroPresentation {
  const { snapshot, profile, status, fonts, conflicts, updateCount = 0, storage } = input;
  const values = { families: snapshot?.familyCount ?? 0, variable: snapshot?.variableFamilyCount ?? 0, recent: snapshot?.recentCount ?? 0 };
  const summary = snapshot ? t("library.summary", values) : t("common.loadingLibrary");
  const localSummary = snapshot ? t("library.localSummary", values) : summary;
  const connection = input.connectionName || (profile ? heroConnectionName(profile, t) : t("navigation.cloud"));
  const cloudReady = input.cloudLoaded && !input.cloudReadError && !!profile;
  // 存放位置与传输任务独立；首次同步前的本地文件也按指纹去重。
  const uploads = new Set(status?.items.filter((item) => item.action === "upload" && ["pending", "running"].includes(item.status)).map((item) => item.fingerprint));
  const downloads = new Set(status?.items.filter((item) => item.action === "download" && ["pending", "running"].includes(item.status)).map((item) => item.fingerprint));
  const unsynced = new Set([...(snapshot?.syncSummary?.localOnlyFingerprints ?? []), ...uploads]);
  const cloudOnly = new Set(fonts.filter((font) => font.cloudOnly && !font.deleted).map((font) => font.fingerprint));
  const cloudOnlyCount = Math.max(cloudOnly.size, snapshot?.syncSummary?.cloudOnlyCount ?? 0);
  const remoteCount = Math.max(new Set([...cloudOnly, ...downloads]).size, cloudOnlyCount);
  const sync = syncPresentation(input, connection, unsynced.size, downloads.size, cloudOnlyCount, t);
  const base = { subtitle: summary, sync };

  if (snapshot && snapshot.health.damagedFiles > 0) {
    return { ...base, kind: "damaged", title: t("health.damagedCount", { count: snapshot.health.damagedFiles }), action: "fontHealth", actionLabel: t("health.viewFontHealth") };
  }
  if (snapshot && snapshot.health.metadataConflicts > 0) {
    return { ...base, kind: "conflict", title: t("health.conflictCountShort", { count: snapshot.health.metadataConflicts }),
      subtitle: t("library.summaryConflict", { revisions: snapshot.health.multipleRevisions, conflicts: snapshot.health.metadataConflicts }),
      detail: localSummary, action: "fontHealth", actionLabel: t("health.viewConflicts") };
  }
  const fontConflicts = cloudReady ? conflicts.filter((conflict) => conflict.kind.startsWith("font_")) : [];
  if (fontConflicts.length > 0) {
    const revisions = fontConflicts.filter((conflict) => conflict.kind === "font_revision").length;
    const names = fontConflicts.filter((conflict) => conflict.kind === "font_name").length;
    const other = fontConflicts.length - revisions - names;
    return { ...base, kind: "conflict", title: t("cloud.conflictCount", { count: fontConflicts.length }),
      subtitle: [revisions ? t("health.revisions", { count: revisions }) : "", names ? t("health.names", { count: names }) : "", other ? t("health.otherConflicts", { count: other }) : ""].filter(Boolean).join(" · "),
      detail: localSummary, action: "cloudSettings", actionLabel: t("cloud.handleConflicts") };
  }
  if (cloudReady && (storage?.low || /可用空间不足|状态码\s*507|insufficient storage/i.test(status?.error ?? ""))) {
    return { ...base, kind: "cloudStorageLow", title: storage?.low ? t("cloud.spaceAlmostFull") : t("cloud.spaceLow"),
      subtitle: storage ? t("cloud.remainingSpace", { connection, size: formatStorage(storage.availableBytes) }) : t("cloud.spaceLowHint"),
      detail: localSummary, action: "cloudSettings", actionLabel: t("cloud.viewCloudSettings") };
  }
  if (updateCount > 0) return { ...base, kind: "update", title: t("desktop.updatesAvailable", { count: updateCount }), action: "fontHealth", actionLabel: t("health.viewVersions") };
  if (cloudReady && remoteCount > 0) {
    return { subtitle: localSummary, sync, kind: "cloudAhead", title: downloads.size > 0 ? t("cloud.pendingDownloads", { count: downloads.size }) : t("cloud.cloudOnlyAvailable", { count: cloudOnlyCount }),
      action: "cloudFonts", actionLabel: t("cloud.viewCloudFonts") };
  }
  if (cloudReady && unsynced.size > 0) {
    return { subtitle: localSummary, sync, kind: "localUnsynced", title: t("cloud.localUnsynced", { count: unsynced.size }), action: "cloudSettings", actionLabel: t("cloud.viewSyncProgress") };
  }
  return { ...base, kind: "normal", title: snapshot ? (snapshot.familyCount > 0 ? t("library.availableNow", { count: snapshot.familyCount }) : t("library.emptyAddFonts")) : t("common.loadingLibrary"),
    subtitle: snapshot ? t("library.summaryDamaged", { damaged: snapshot.health.damagedFiles, variable: snapshot.variableFamilyCount, recent: snapshot.recentCount }) : t("library.loadingList") };
}

function syncPresentation(input: HeroInput, connection: string, uploads: number, downloads: number, cloudOnly: number, t: HeroTranslate): HeroPresentation["sync"] {
  const { profile, status, cloudLoaded } = input;
  if (!cloudLoaded) return { state: "checking", text: t("common.loading") };
  if (input.cloudReadError) return { state: "error", text: t("cloud.readStatusError"), action: "cloudSettings" };
  if (!profile) return { state: "disconnected", text: t("cloud.notConnected"), action: "cloudSettings" };
  if (!status) return { state: "checking", text: t("cloud.readingCloud", { connection }) };
  if (status.running) return { state: "running", text: t("cloud.syncingCloud", { connection, percent: Math.round(Math.min(100, Math.max(0, status.percent))) }) };
  if (status.error) return { state: "error", text: `${connection} ${t("cloud.syncIncomplete")}`, action: "cloudSettings" };
  if (uploads > 0 && downloads > 0) return { state: "pending", text: t("cloud.bothUnsynced", { connection, uploads, downloads }), action: "cloudSettings" };
  if (uploads > 0) return { state: "pending", text: t("cloud.pendingUploads", { count: uploads }), action: "cloudSettings" };
  if (downloads > 0) return { state: "pending", text: t("cloud.pendingDownloads", { count: downloads }), action: "cloudFonts" };
  if (input.conflicts.length > 0) return { state: "pending", text: t("cloud.conflictsPending", { connection, count: input.conflicts.length }), action: "cloudSettings" };
  if (cloudOnly > 0) return { state: "connected", text: t("cloud.cloudOnlySummary", { connection, count: cloudOnly }), action: "cloudFonts" };
  if (input.snapshot?.syncSummary && status.percent === 100 && status.stage === "已同步") return { state: "synced", text: t("cloud.librarySyncedTo", { connection }) };
  return { state: "connected", text: t("cloud.connectedTo", { connection }), action: "cloudSettings" };
}

function formatStorage(bytes: number): string {
  return bytes >= 0.1 * 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0, bytes / 1024 ** 2).toFixed(0)} MB`;
}
