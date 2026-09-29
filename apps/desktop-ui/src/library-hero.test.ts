import { expect, it } from "vitest";
import { createLibraryHero, type HeroInput } from "./library-hero";

const base: HeroInput = {
  snapshot: { familyCount: 670, faceCount: 1200, variableFamilyCount: 42, recentCount: 12, roots: [], fontStateCounts: {}, userFontGroups: [], health: { damagedFiles: 0, duplicateSources: 0, multipleRevisions: 0, metadataConflicts: 0 } },
  profile: { serverUrl: "https://webdav.123pan.com", remoteDirectory: "Folio", username: "", automatic: true },
  status: { configured: true, running: false, phase: "", stage: "", percent: 0, stageCompleted: 0, stageTotal: 0, uploadedFiles: 0, downloadedFiles: 0, publishedEvents: 0, items: [], error: null },
  fonts: [], conflicts: [], cloudLoaded: true,
};

it("全库统计来自快照，未完成同步不能声称全部已同步", () => {
  const hero = createLibraryHero(base);
  expect(hero.title).toBe("现有 670 个字族，随时可用");
  expect(hero.subtitle).toContain("42 个可变字族 · 12 个最近访问");
  expect(hero.sync.state).toBe("connected");
  expect(hero.sync.text).toContain("123PAN");
  expect(createLibraryHero({ ...base, profile: null }).sync.state).toBe("disconnected");
  expect(createLibraryHero({ ...base, cloudLoaded: false }).sync.state).toBe("checking");
  expect(createLibraryHero({ ...base, profile: null, cloudReadError: true }).sync.state).toBe("error");
  expect(createLibraryHero({ ...base, status: { ...base.status!, stage: "已同步", percent: 100 } }).sync.state).toBe("synced");
});

it("损坏、冲突、空间不足按优先级显示，不混算本地与云端冲突", () => {
  const input: HeroInput = { ...base, snapshot: { ...base.snapshot!, health: { damagedFiles: 8, duplicateSources: 0, multipleRevisions: 2, metadataConflicts: 4 } },
    updateCount: 3, status: { ...base.status!, error: "WebDAV 可用空间不足" },
    conflicts: [{ id: "c", kind: "font_revision", title: "", detail: "", localFingerprint: null, remoteFingerprint: null }] };
  expect(createLibraryHero(input).kind).toBe("damaged");
  const conflict = createLibraryHero({ ...input, snapshot: { ...input.snapshot!, health: { ...input.snapshot!.health, damagedFiles: 0 } } });
  expect(conflict.kind).toBe("conflict");
  expect(conflict.title).toContain("4 个字族");
  expect(conflict.action).toBe("fontHealth");
  expect(createLibraryHero({ ...input, snapshot: base.snapshot, conflicts: [] }).kind).toBe("cloudStorageLow");
  expect(createLibraryHero({ ...base, status: { ...base.status!, error: "WebDAV 请求失败，状态码 507" } }).kind).toBe("cloudStorageLow");
  expect(createLibraryHero({ ...base, updateCount: 3 }).kind).toBe("update");
});

it("队列去重、排除已完成任务；仅云端字体和收藏夹冲突保持各自语义", () => {
  const pending = { fingerprint: "a", action: "upload" as const, status: "pending" as const };
  const local = createLibraryHero({ ...base, status: { ...base.status!, items: [pending, pending, { ...pending, fingerprint: "b", status: "done" }] } });
  expect(local.title).toBe("本地有 1 个字体待上传");
  const remote = createLibraryHero({ ...base, status: { ...base.status!, items: [{ ...pending, action: "download" }] } });
  expect(remote.title).toBe("云端有 1 个字体待下载");
  const cloudOnly = { fingerprint: "a", displayName: "字族", filename: "a.ttf", fileSize: 123, cloudOnly: true, deleted: false, localPath: null };
  expect(createLibraryHero({ ...base, fonts: [cloudOnly, { ...cloudOnly, fingerprint: "b", deleted: true }] }).title).toBe("云端有 1 个字体可下载");
  const collectionConflict = { id: "c", kind: "collection_name", title: "", detail: "", localFingerprint: null, remoteFingerprint: null };
  const hero = createLibraryHero({ ...base, conflicts: [collectionConflict] });
  expect(hero.kind).toBe("normal");
  expect(hero.sync.text).toContain("1 个同步冲突待处理");
  expect(createLibraryHero({ ...base, status: { ...base.status!, running: true, percent: 138 } }).sync.text).toContain("100%");
  expect(createLibraryHero({ ...base, status: { ...base.status!, error: "请求超时" } }).sync.state).toBe("error");
});
