import { invoke } from "@tauri-apps/api/core";
import type { CloudFontDto, CollectionDto, FontPreviewDto, LibraryPageDto, LibrarySnapshotDto, SmartFolderDto, SyncConflictDto, SyncProfileDto, SyncStatusDto } from "./types";

export interface QueryRequest {
  text: string;
  scope: string;
  offset: number;
  limit: number;
  facets: Record<string, string[]>;
  sort: string;
  collectionId?: string;
  smartFolderId?: string;
  fontState?: string;
}

export function queryLibrary(request: QueryRequest): Promise<LibraryPageDto> {
  return invoke("query_library", { request });
}

export function refreshLibrary(): Promise<LibrarySnapshotDto> {
  return invoke("refresh_library");
}

export function addLibraryRoot(path: string): Promise<LibrarySnapshotDto> {
  return invoke("add_library_root", { path });
}

export function renderPreviews(faceIds: string[], sample: string, size: number): Promise<FontPreviewDto[]> {
  return invoke("render_previews", { faceIds, sample, size });
}

export function setFamilyFavorite(identityIds: string[], favorite: boolean): Promise<void> {
  return invoke("set_family_favorite", { identityIds, favorite });
}

export function recordRecent(identityId: string): Promise<void> {
  return invoke("record_recent", { identityId });
}

export function listCollections(): Promise<CollectionDto[]> {
  return invoke("list_collections");
}

export function saveCollection(request: Partial<CollectionDto> & { id?: string }): Promise<CollectionDto> {
  return invoke("save_collection", { request });
}

export function deleteCollection(id: string): Promise<void> {
  return invoke("delete_collection", { id });
}

export function setCollectionMembers(collectionId: string, identityIds: string[], member: boolean): Promise<void> {
  return invoke("set_collection_members", { request: { collectionId, identityIds, member } });
}

export function listSmartFolders(): Promise<SmartFolderDto[]> {
  return invoke("list_smart_folders");
}

export function saveSmartFolder(request: { id?: string; name: string; text: string; facets: Record<string, string[]>; icon?: string; color?: string }): Promise<SmartFolderDto> {
  return invoke("save_smart_folder", { request });
}

export function deleteSmartFolder(id: string): Promise<void> {
  return invoke("delete_smart_folder", { id });
}

export function convertCollectionToSmartFolder(request: { id: string; name: string; text: string; facets: Record<string, string[]>; icon: string; color: string }): Promise<SmartFolderDto> {
  return invoke("convert_collection_to_smart_folder", { request });
}

export function convertSmartFolderToCollection(request: { id: string; name: string; icon: string; color: string }): Promise<CollectionDto> {
  return invoke("convert_smart_folder_to_collection", { request });
}

export function openSettings(): Promise<void> {
  return invoke("open_settings");
}

export function quitApp(): Promise<void> {
  return invoke("quit_app");
}

export function getSyncProfile(): Promise<SyncProfileDto | null> {
  return invoke("get_sync_profile");
}

export function getSyncStatus(): Promise<SyncStatusDto> {
  return invoke("get_sync_status");
}

export function testSyncConnection(profile: SyncProfileDto, password: string): Promise<void> {
  return invoke("test_sync_connection", { profile, password });
}

export function saveSyncConnection(profile: SyncProfileDto, password: string): Promise<void> {
  return invoke("save_sync_connection", { profile, password });
}

export function disconnectSync(): Promise<void> {
  return invoke("disconnect_sync");
}

export function syncNow(): Promise<void> {
  return invoke("sync_now");
}

export function cancelSync(): Promise<void> {
  return invoke("cancel_sync");
}

export function listCloudFonts(): Promise<CloudFontDto[]> {
  return invoke("list_cloud_fonts");
}

export function listSyncConflicts(): Promise<SyncConflictDto[]> {
  return invoke("list_sync_conflicts");
}

export function resolveSyncConflict(id: string, resolution: "keepBoth" | "useLocal" | "useRemote"): Promise<void> {
  return invoke("resolve_sync_conflict", { request: { id, resolution } });
}
