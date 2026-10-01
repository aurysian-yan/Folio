import {
  ArrowClockwiseIcon,
  CheckIcon,
  CloudCheckIcon,
  CloudIcon,
  CopyIcon,
  CopySimpleIcon,
  FolderPlusIcon,
  GearSixIcon,
  GridFourIcon,
  GridNineIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PencilSimpleIcon,
  PlusIcon,
  SidebarSimpleIcon,
  SparkleIcon,
  SquareIcon,
  StackSimpleIcon,
  TextAaIcon,
  TrashIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  Button,
  Input,
  Label,
  ListBox,
  Modal,
  SearchField,
  Select,
  Switch,
  TextField,
  Toolbar,
} from "@heroui/react";
import Scritto from "@scritto/react";
import { SmoothCorners, useSmoothCorners } from "@lisse/react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { SegmentedTabs } from "./components/SegmentedTabs";
import { FacetGroup } from "./components/FacetGroup";
import { ClaralightSlider } from "./components/ClaralightSlider";
import { PreviewColorPicker } from "./components/PreviewColorPicker";
import { PreviewPresetMenu } from "./components/PreviewPresetMenu";
import { previewSizeRange, usePreviewAppearance } from "./preview-appearance";
import type { ViewMode } from "./components/FontCard";
import { VirtualFontGrid } from "./components/VirtualFontGrid";
import { appendLibraryPage, LibraryPageRequests } from "./library-paging";
import { startMetric } from "./performance-metrics";
import { useAppScrollbars } from "./scrollbars";
import { FontPreview } from "./components/FontPreview";
import { LibraryHero } from "./components/LibraryHero";
import { createLibraryHero, type HeroAction } from "./library-hero";
import { currentPreviewStyle } from "./font-preview";
import {
  Fragment,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addLibraryRoot,
  cancelSync,
  clearCatalogCache,
  convertCollectionToSmartFolder,
  convertSmartFolderToCollection,
  deleteCollection,
  deleteSmartFolder,
  disconnectSync,
  getSyncProfile,
  getSyncStatus,
  getStorageUsage,
  listCloudFonts,
  listCollections,
  listSmartFolders,
  listSyncConflicts,
  openSettings,
  queryLibrary,
  quitApp,
  recordRecent,
  rebuildSyncIndexes,
  refreshLibrary,
  resolveSyncConflict,
  restoreCloudFont,
  restoreDeletedCloudFont,
  saveCollection,
  saveSmartFolder,
  saveSyncConnection,
  setCollectionMembers,
  setFamilyFavorite,
  syncNow,
  testSyncConnection,
} from "./api";
import type {
  CloudFontDto,
  CollectionDto,
  FamilyDto,
  FacetOptionDto,
  LibraryPageDto,
  LibrarySnapshotDto,
  SmartFolderDto,
  StorageUsageDto,
  SyncConflictDto,
  SyncProfileDto,
  SyncItemDto,
  SyncStatusDto,
} from "./types";
import { AnimatedIcon } from "./animated-icons";
import type { AnimatedIconName } from "./animated-icons-data";
import i18n, { currentLanguageSetting, setLanguageSetting, type LanguageSetting } from "./i18n";

type LibraryScope =
  | "all"
  | "recent"
  | "favorites"
  | "collection"
  | "smartFolder"
  | "fontState"
  | "fontHealth"
  | "cloudFonts";
type SettingsPage =
  | "cloud"
  | "storage"
  | "importing"
  | "display"
  | "font-cards"
  | "shortcuts"
  | "about";
type QuitShortcut = "Control+W" | "Control+Q" | "Alt+Q" | "Alt+W";
type MenuEntry = {
  label: string;
  action: () => void | Promise<void>;
  Icon?: typeof FolderPlusIcon;
  shortcut?: string;
  ariaShortcut?: string;
  separatorBefore?: boolean;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
};

// 收藏夹编辑意图与草稿，对应 macOS 版本的 FavoriteFolderEditorIntent。
type FavoriteFolderIntent =
  | { kind: "create" }
  | { kind: "editCollection"; collection: CollectionDto }
  | { kind: "editSmartFolder"; folder: SmartFolderDto };

type FavoriteFolderDraft = {
  name: string;
  text: string;
  facets: Record<string, string[]>;
  icon: string;
  color: string;
};

type FolderContextMenuState = {
  x: number;
  y: number;
  intent: FavoriteFolderIntent;
};

const quitShortcutOptions: { id: QuitShortcut; label: string }[] = [
  { id: "Control+W", label: "Ctrl+W" },
  { id: "Control+Q", label: "Ctrl+Q" },
  { id: "Alt+Q", label: "Alt+Q" },
  { id: "Alt+W", label: "Alt+W" },
];

function parseQuitShortcut(value: string | null): QuitShortcut {
  return quitShortcutOptions.find((option) => option.id === value)?.id ?? "Control+Q";
}

function parseCardHoverDelay(value: string | null) {
  const milliseconds = value?.trim() ? Number(value) : 180;
  return Number.isFinite(milliseconds)
    ? Math.max(0, Math.min(1000, Math.round(milliseconds / 10) * 10))
    : 180;
}

function parseExpandedCardWheelSpeed(value: string | null) {
  const speed = value?.trim() ? Number(value) : 1.25;
  return Number.isFinite(speed)
    ? Math.round(Math.max(0.5, Math.min(2, speed)) * 20) / 20
    : 1.25;
}

function matchesQuitShortcut(event: globalThis.KeyboardEvent, shortcut: QuitShortcut) {
  const [modifier, key] = shortcut.split("+");
  return event.key.toLowerCase() === key?.toLowerCase() &&
    event.ctrlKey === (modifier === "Control") &&
    event.altKey === (modifier === "Alt") &&
    !event.metaKey && !event.shiftKey;
}

const viewModes: { id: ViewMode; label: string; Icon: typeof GridFourIcon }[] =
  [
    { id: "compact", label: "libraryView.compactGrid", Icon: GridNineIcon },
    { id: "large", label: "libraryView.largeGrid", Icon: GridFourIcon },
    { id: "list", label: "libraryView.list", Icon: ListBulletsIcon },
    { id: "expanded", label: "libraryView.stack", Icon: StackSimpleIcon },
  ];

const titlebarCapsuleCorners = { radius: 16, smoothing: 0.6 } as const;
const titlebarThumbCorners = { radius: 13, smoothing: 0.6 } as const;
// 菜单外壳与菜单项圆角同心：外壳 10px、内边距 3px、菜单项 6px。
const menuCorners = { radius: 10, smoothing: 0.6 } as const;
const menuItemCorners = { radius: 6, smoothing: 0.6 } as const;
// 侧边栏菜单项使用 lisse 平滑圆角。
const sidebarItemCorners = { radius: 8, smoothing: 0.6 } as const;

// 收藏夹图标与颜色选项，与 macOS 版本 CollectionIcon / CollectionColor 一一对应。
type CollectionIconOption = {
  id: string;
  label: string;
  animatedName: AnimatedIconName;
};

const collectionIconOptions: CollectionIconOption[] = [
  { id: "folder", label: "collectionIcon.folder", animatedName: "folder" },
  { id: "books", label: "collectionIcon.books", animatedName: "books" },
  { id: "type", label: "collectionIcon.type", animatedName: "text-aa" },
  { id: "star", label: "collectionIcon.star", animatedName: "star" },
  { id: "heart", label: "collectionIcon.heart", animatedName: "heart" },
  { id: "bookmark", label: "collectionIcon.bookmark", animatedName: "bookmark-simple" },
  { id: "tag", label: "collectionIcon.tag", animatedName: "tag" },
  { id: "briefcase", label: "collectionIcon.briefcase", animatedName: "briefcase" },
  { id: "sparkles", label: "collectionIcon.sparkles", animatedName: "sparkle" },
  { id: "sliders-horizontal", label: "collectionIcon.sliders", animatedName: "sliders-horizontal" },
  { id: "signature", label: "collectionIcon.signature", animatedName: "signature" },
  { id: "archive", label: "collectionIcon.archive", animatedName: "archive" },
  { id: "book", label: "collectionIcon.book", animatedName: "book" },
  { id: "paperclip", label: "collectionIcon.paperclip", animatedName: "paperclip" },
  { id: "package", label: "collectionIcon.package", animatedName: "package" },
  { id: "swatches", label: "collectionIcon.swatches", animatedName: "swatches" },
  { id: "gift", label: "collectionIcon.gift", animatedName: "gift" },
  { id: "stack", label: "collectionIcon.stack", animatedName: "stack" },
  { id: "number-circle-0", label: "collectionIcon.number0", animatedName: "number-circle-zero" },
  { id: "number-circle-1", label: "collectionIcon.number1", animatedName: "number-circle-one" },
  { id: "number-circle-2", label: "collectionIcon.number2", animatedName: "number-circle-two" },
  { id: "number-circle-3", label: "collectionIcon.number3", animatedName: "number-circle-three" },
  { id: "number-circle-4", label: "collectionIcon.number4", animatedName: "number-circle-four" },
  { id: "number-circle-5", label: "collectionIcon.number5", animatedName: "number-circle-five" },
  { id: "number-circle-6", label: "collectionIcon.number6", animatedName: "number-circle-six" },
  { id: "number-circle-7", label: "collectionIcon.number7", animatedName: "number-circle-seven" },
  { id: "number-circle-8", label: "collectionIcon.number8", animatedName: "number-circle-eight" },
  { id: "number-circle-9", label: "collectionIcon.number9", animatedName: "number-circle-nine" },
  { id: "number-square-0", label: "collectionIcon.number0", animatedName: "number-square-zero" },
  { id: "number-square-1", label: "collectionIcon.number1", animatedName: "number-square-one" },
  { id: "number-square-2", label: "collectionIcon.number2", animatedName: "number-square-two" },
  { id: "number-square-3", label: "collectionIcon.number3", animatedName: "number-square-three" },
  { id: "number-square-4", label: "collectionIcon.number4", animatedName: "number-square-four" },
  { id: "number-square-5", label: "collectionIcon.number5", animatedName: "number-square-five" },
  { id: "number-square-6", label: "collectionIcon.number6", animatedName: "number-square-six" },
  { id: "number-square-7", label: "collectionIcon.number7", animatedName: "number-square-seven" },
  { id: "number-square-8", label: "collectionIcon.number8", animatedName: "number-square-eight" },
  { id: "number-square-9", label: "collectionIcon.number9", animatedName: "number-square-nine" },
];

const collectionIconMap: Record<string, AnimatedIconName> = Object.fromEntries(
  collectionIconOptions.map(({ id, animatedName }) => [id, animatedName]),
);

type CollectionColorOption = {
  id: string;
  label: string;
  value: string;
};

const collectionColorOptions: CollectionColorOption[] = [
  { id: "red", label: "color.red", value: "rgb(219, 56, 64)" },
  { id: "orange", label: "color.orange", value: "rgb(232, 99, 31)" },
  { id: "yellow", label: "color.yellow", value: "rgb(209, 158, 5)" },
  { id: "lime", label: "color.lime", value: "rgb(125, 176, 41)" },
  { id: "green", label: "color.green", value: "rgb(31, 153, 92)" },
  { id: "cyan", label: "color.cyan", value: "rgb(0, 150, 161)" },
  { id: "blue", label: "color.blue", value: "rgb(46, 120, 214)" },
  { id: "purple", label: "color.purple", value: "rgb(125, 79, 207)" },
  { id: "gray", label: "color.gray", value: "rgb(128, 128, 128)" },
];

const collectionColorMap: Record<string, string> = Object.fromEntries(
  collectionColorOptions.map(({ id, value }) => [id, value]),
);

function collectionIconName(icon: string): AnimatedIconName {
  return collectionIconMap[icon] ?? "folder";
}

function collectionColorValue(color: string) {
  return collectionColorMap[color] ?? collectionColorMap.gray;
}

const settingsPages: { id: SettingsPage; title: string }[] = [
  { id: "cloud", title: "settings.cloud" },
  { id: "storage", title: "settings.storage" },
  { id: "importing", title: "settings.importing" },
  { id: "display", title: "settings.display" },
  { id: "font-cards", title: "settings.cards" },
  { id: "shortcuts", title: "desktop.shortcuts" },
  { id: "about", title: "settings.about" },
];

function StorageVolumeBar({ usage }: { usage: StorageUsageDto }) {
  const { t } = useTranslation();
  const segments = [
    { label: t("storage.managedLabel"), bytes: usage.managedFontBytes, className: "storage-fonts" },
    { label: t("storage.libraryDatabase"), bytes: usage.databaseBytes, className: "storage-database" },
  ];
  const total = segments.reduce((sum, segment) => sum + segment.bytes, 0);
  const used = Math.max(0, usage.volumeTotalBytes - usage.volumeFreeBytes);
  const otherUsed = Math.max(0, used - total);
  const diskSegments = [
    { label: t("storage.otherApps"), bytes: otherUsed, className: "storage-other" },
    ...segments,
    { label: t("desktop.availableSpace"), bytes: usage.volumeFreeBytes, className: "storage-free" },
  ];
  const percentage = usage.volumeTotalBytes > 0 ? total / usage.volumeTotalBytes * 100 : 0;
  const percentageLabel = percentage > 0 && percentage < 0.1 ? "<0.1%" : `${percentage.toFixed(1)}%`;

  return (
    <div className="storage-volume">
      <div className="storage-volume-heading"><span>{t("storage.folioUsage")}</span><strong>{formatFileSize(total)}</strong></div>
      <div className="storage-volume-track" role="img" aria-label={t("storage.accessibilityUsage", { total: formatFileSize(total), percent: percentageLabel, other: formatFileSize(otherUsed), free: formatFileSize(usage.volumeFreeBytes) })}>
        {diskSegments.filter((segment) => segment.bytes > 0).map((segment) => (
          <span key={segment.label} className={segment.className} style={{ width: `${usage.volumeTotalBytes > 0 ? Math.min(segment.bytes / usage.volumeTotalBytes * 100, 100) : 0}%`, minWidth: segment.className === "storage-fonts" || segment.className === "storage-database" ? 2 : 0 }} />
        ))}
      </div>
      <div className="storage-volume-foot"><span>{t("storage.diskOf", { used: formatFileSize(total), total: formatFileSize(usage.volumeTotalBytes) })}</span><strong>{percentageLabel}</strong></div>
      <div className="storage-volume-legend">
        <span><i className="storage-dot storage-other" aria-hidden="true" />{t("storage.otherApps")} <strong>{formatFileSize(otherUsed)}</strong></span>
        <span><i className="storage-dot storage-free" aria-hidden="true" />{t("desktop.availableSpace")} <strong>{formatFileSize(usage.volumeFreeBytes)}</strong></span>
      </div>
    </div>
  );
}

// WebDAV 服务商预设，与 macOS 版本 WebDAVPreset 保持一致。
const webdavPresets: { id: string; label: string; url: string | null }[] = [
  { id: "none", label: "macos.providerNone", url: null },
  { id: "pan123", label: "macos.provider123", url: "https://webdav.123pan.cn/webdav" },
  { id: "jianguoyun", label: "macos.providerJianguoyun", url: "https://dav.jianguoyun.com/dav" },
];

function matchingWebdavPreset(serverUrl: string) {
  const normalized = serverUrl.trim().replace(/\/+$/, "").toLowerCase();
  if (!normalized) return "none";
  return (
    webdavPresets.find(
      (preset) =>
        preset.url !== null &&
        preset.url.replace(/\/+$/, "").toLowerCase() === normalized,
    )?.id ?? "none"
  );
}

// 字体状态顺序与 macOS 版本一致；跨平台口径见 Rust `FontStateKind`。
type FontStateId =
  | "active"
  | `user:${string}`
  | "available"
  | "external"
  | "system"
  | "unavailable";

type FontStateOption = {
  id: FontStateId;
  label: string;
  animatedName: AnimatedIconName;
  help: string;
};

const fontStateOptions: FontStateOption[] = [
  {
    id: "active",
    label: "fontState.active",
    animatedName: "seal-check",
    help: "fontState.helpActive",
  },
  {
    id: "available",
    label: "fontState.available",
    animatedName: "book",
    help: "fontState.helpAvailable",
  },
  {
    id: "external",
    label: "fontState.external",
    animatedName: "file",
    help: "fontState.helpExternal",
  },
  {
    id: "system",
    label: "fontState.system",
    animatedName: "laptop",
    help: "fontState.helpSystem",
  },
  {
    id: "unavailable",
    label: "fontState.unavailable",
    animatedName: "warning",
    help: "desktop.sourceUnavailable",
  },
];

function fontStateOptionsFor(snapshot: LibrarySnapshotDto | null): FontStateOption[] {
  // 保持静态分类的键为可翻译键，无对应键的说明沿用原文。
  const localize = (value: string) => (i18n.exists(value) ? i18n.t(value) : value);
  const users = (snapshot?.userFontGroups ?? []).map((group) => ({
    id: group.id as FontStateId,
    label: i18n.t("import.userFontsFolder", { name: group.name }),
    animatedName: "download-simple" as AnimatedIconName,
    help: i18n.t("import.folderOwner", { name: group.name }),
  }));
  return [
    {
      ...fontStateOptions[0],
      label: localize(fontStateOptions[0].label),
      help: localize(fontStateOptions[0].help),
    },
    ...users,
    ...fontStateOptions.slice(1).map((option) => ({
      ...option,
      label: localize(option.label),
      help: localize(option.help),
    })),
  ];
}

function fontStateLabel(id: FontStateId, snapshot: LibrarySnapshotDto | null) {
  return (
    fontStateOptionsFor(snapshot).find((option) => option.id === id)?.label ??
    i18n.t("navigation.fontState")
  );
}

// 菜单衬底与内容分层，lisse 为两者裁切圆角并为菜单绘制描边和阴影。
function MenuPopover({
  id,
  label,
  className,
  backdropRoot,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  backdropRoot: HTMLElement | null;
  children: ReactNode;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  useSmoothCorners(backdropRef, menuCorners, {
    autoEffects: false,
    fallbackBorderRadius: "10px",
  });
  useSmoothCorners(ref, menuCorners, {
    autoEffects: false,
    fallbackBorderRadius: "10px",
    effects: {
      innerBorder: { width: 1, color: "var(--line)", opacity: 1 },
      shadow: {
        offsetX: 0,
        offsetY: 8,
        blur: 28,
        spread: 0,
        color: "#191919",
        opacity: 0.18,
      },
    },
  });
  useLayoutEffect(() => {
    const shell = shellRef.current;
    const backdrop = backdropRef.current;
    if (!shell || !backdrop || !backdropRoot) return;

    const updateBackdropPosition = () => {
      const shellRect = shell.getBoundingClientRect();
      const rootRect = backdropRoot.getBoundingClientRect();
      backdrop.style.left = `${shellRect.left - rootRect.left}px`;
      backdrop.style.top = `${shellRect.top - rootRect.top}px`;
      backdrop.style.width = `${shellRect.width}px`;
      backdrop.style.height = `${shellRect.height}px`;
    };
    updateBackdropPosition();

    const resizeObserver = new ResizeObserver(updateBackdropPosition);
    resizeObserver.observe(shell);
    resizeObserver.observe(backdropRoot);
    window.addEventListener("resize", updateBackdropPosition);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateBackdropPosition);
    };
  }, [backdropRoot]);
  return (
    <>
      {backdropRoot &&
        createPortal(
          <div
            ref={backdropRef}
            className="menu-backdrop"
            style={{ borderRadius: 10 }}
            aria-hidden="true"
          />,
          backdropRoot,
        )}
      <div
        ref={shellRef}
        className={`menu-shell${className ? ` ${className}` : ""}`}
      >
        <div
          ref={ref}
          className="menu-popover"
          style={{ borderRadius: 10 }}
          id={id}
          role="menu"
          aria-label={label}
        >
          {children}
        </div>
      </div>
    </>
  );
}

function MenuItem({
  item,
  onSelect,
}: {
  item: MenuEntry;
  onSelect: (item: MenuEntry) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useSmoothCorners(ref, menuItemCorners, {
    autoEffects: false,
    fallbackBorderRadius: "6px",
  });
  const Icon = item.Icon;
  return (
    <button
      ref={ref}
      type="button"
      role={item.checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={item.checked}
      aria-keyshortcuts={item.ariaShortcut}
      disabled={item.disabled}
      className={item.danger ? "menu-item-danger" : undefined}
      style={{ borderRadius: 6 }}
      onClick={() => onSelect(item)}
    >
      <span className="menu-item-icon" aria-hidden="true">
        {Icon ? <Icon /> : item.checked ? <CheckIcon /> : null}
      </span>
      <span className="menu-item-label">{item.label}</span>
      {item.shortcut && (
        <kbd className="menu-item-shortcut" aria-hidden="true">
          {item.shortcut}
        </kbd>
      )}
    </button>
  );
}

// 侧边栏可点击项：在原生 button 上应用 lisse 平滑圆角，保持原有的 flex 布局。
function SidebarItem({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const ref = useRef<HTMLButtonElement>(null);
  useSmoothCorners(ref, sidebarItemCorners, {
    autoEffects: false,
    fallbackBorderRadius: "8px",
  });
  return (
    <button
      ref={ref}
      type="button"
      className={className}
      style={{ borderRadius: sidebarItemCorners.radius }}
      {...props}
    >
      {children}
    </button>
  );
}

function isSettingsWindow() {
  return (
    new URLSearchParams(window.location.search).get("window") === "settings"
  );
}

function FolioWordmark() {
  return (
    <svg height="12" viewBox="0 0 1024 364" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M386.388 112.573C417.93 112.573 444.888 121.213 467.261 138.494C496.236 161.658 510.723 193.83 510.723 235.01C510.723 265.894 501.553 293.103 483.215 316.634C458.641 347.886 424.715 363.513 381.436 363.513C349.893 363.513 322.752 353.953 300.013 334.834C271.404 310.567 257.101 277.66 257.101 236.112C257.101 206.698 265.536 180.961 282.407 158.9C306.614 128.015 341.275 112.573 386.388 112.573ZM899.664 112.573C931.206 112.573 958.164 121.213 980.537 138.494C1009.51 161.658 1024 193.83 1024 235.01C1024 265.894 1014.83 293.103 996.492 316.634C971.919 347.886 937.992 363.513 894.713 363.513C863.171 363.513 836.029 353.953 813.289 334.834C784.681 310.567 770.377 277.66 770.377 236.112C770.377 206.698 778.813 180.961 795.685 158.9C819.892 128.016 854.551 112.573 899.664 112.573ZM270.619 0.615173C273.097 0.615173 275.119 2.59711 275.169 5.07416L277.186 104.62C277.237 107.169 275.185 109.263 272.636 109.264H264.723C262.708 109.264 260.932 107.939 260.359 106.007L249.354 68.9003C249.266 68.6031 249.254 68.3348 249.146 68.0439C248.965 67.5523 248.59 67.0797 248.433 66.58C237.71 32.5309 215.967 15.506 183.203 15.5058H125.586C123.072 15.5058 121.035 17.544 121.035 20.0576V148.282C121.035 150.796 123.072 152.834 125.586 152.834H222.114C224.628 152.834 226.665 154.871 226.665 157.385V164.828C226.665 167.341 224.628 169.379 222.114 169.379H125.586C123.073 169.379 121.035 171.416 121.035 173.93V338.555C121.035 341.068 123.072 343.106 125.586 343.106H181.402C183.916 343.106 185.953 345.144 185.953 347.657V353.446C185.953 355.96 183.916 357.997 181.402 357.997H4.55078C2.0375 357.997 0.000131932 355.96 0 353.446V347.657C6.59676e-05 345.144 2.03746 343.107 4.55078 343.106H39.4619C41.9753 343.106 44.0127 341.068 44.0127 338.555V20.0576C44.0127 17.5442 41.9753 15.506 39.4619 15.5058H4.55078C2.03742 15.5056 0 13.4684 0 10.955V5.16595C0.000226495 2.65275 2.03756 0.615349 4.55078 0.615173H270.619ZM616.606 0.573181C619.417 0.0235637 622.031 2.17596 622.031 5.03998V339.106C622.031 341.62 624.069 343.658 626.582 343.658H649.539C649.897 343.658 650.251 343.664 650.6 343.674C650.895 343.601 651.2 343.554 651.513 343.537C654.461 343.374 657.162 343.047 659.617 342.555C672.454 340.349 678.873 331.157 678.873 314.979V161.797C678.873 159.283 676.836 157.246 674.322 157.246H651.515C649.001 157.246 646.964 155.208 646.964 152.694V146.577C646.964 144.435 648.457 142.583 650.551 142.129L743.228 122.041C746.064 121.426 748.743 123.587 748.743 126.489V339.106C748.743 341.62 750.781 343.658 753.294 343.658H769.099C771.299 343.658 773.317 343.841 775.15 344.209C778.981 344.8 781.273 347.882 782.026 353.456C782.363 355.947 780.265 357.997 777.752 357.997H513.8C511.286 357.997 509.249 355.96 509.249 353.446V348.209C509.249 345.695 511.287 343.665 513.8 343.606C521.985 343.417 528.72 342.699 534.006 341.452C546.109 338.143 552.161 328.951 552.161 313.876V40.4638C552.161 37.9503 550.123 35.912 547.609 35.912H513.8C511.286 35.912 509.249 33.8747 509.249 31.3613V25.3203C509.249 23.1436 510.79 21.2714 512.926 20.8535L616.606 0.573181ZM383.637 126.912C369.699 126.912 358.879 131.141 351.177 139.598C338.707 153.937 332.472 186.844 332.472 238.318C332.472 272.88 334.672 298.066 339.073 313.876C345.675 337.407 360.346 349.173 383.086 349.173C395.923 349.173 406.376 345.312 414.445 337.591C428.383 323.619 435.352 289.793 435.352 236.112C435.352 202.654 433.15 178.203 428.749 162.761C422.147 138.862 407.11 126.912 383.637 126.912ZM896.913 126.912C882.976 126.912 872.156 131.141 864.454 139.598C851.984 153.937 845.749 186.844 845.749 238.318C845.749 272.88 847.949 298.066 852.351 313.876C858.953 337.407 873.623 349.173 896.363 349.173C909.2 349.173 919.654 345.312 927.723 337.591C941.66 323.619 948.628 289.793 948.628 236.112C948.628 202.654 946.428 178.203 942.026 162.761C935.424 138.862 920.386 126.912 896.913 126.912ZM712.433 7.23334C719.401 7.23334 726.003 9.07219 732.238 12.749C746.542 20.4702 753.694 32.4198 753.694 48.5976C753.694 55.5833 751.861 62.2017 748.193 68.4521C740.491 82.056 728.571 88.8574 712.433 88.8574C705.831 88.8573 699.412 87.2036 693.177 83.8945C678.873 76.541 671.721 64.7751 671.721 48.5976C671.721 41.6118 673.372 34.9935 676.673 28.7431C684.742 14.4037 696.661 7.23336 712.433 7.23334Z" fill="white"/>
    </svg>
  );
}

export default function App() {
  const { t } = useTranslation();
  useAppScrollbars();
  useLayoutEffect(() => {
    document.documentElement.dataset.uiReady = "true";
  }, []);

  const settingsWindow = isSettingsWindow();
  const [languageSetting, setLanguage] = useState<LanguageSetting>(() => currentLanguageSetting());
  const [viewMode, setViewMode] = useState<ViewMode>(
    () =>
      (localStorage.getItem("folio-view-mode") as ViewMode | null) ?? "compact",
  );
  const [quitShortcut, setQuitShortcut] = useState<QuitShortcut>(() =>
    parseQuitShortcut(localStorage.getItem("folio-quit-shortcut")),
  );
  const [importMode, setImportMode] = useState(
    () => localStorage.getItem("folio-import-mode") ?? "copy",
  );
  const [cardHover, setCardHover] = useState(
    () => localStorage.getItem("folio-card-hover") !== "false",
  );
  const [cardHoverDelay, setCardHoverDelay] = useState(
    () => parseCardHoverDelay(localStorage.getItem("folio-card-hover-delay")),
  );
  const [expandedCardWheelSpeed, setExpandedCardWheelSpeed] = useState(
    () => parseExpandedCardWheelSpeed(localStorage.getItem("folio-expanded-card-wheel-speed")),
  );
  const [cardMetadata, setCardMetadata] = useState(
    () => localStorage.getItem("folio-card-metadata") !== "false",
  );
  const [sidebarBlur, setSidebarBlur] = useState(() =>
    parseSidebarBlur(localStorage.getItem("folio-sidebar-status-blur")),
  );
  const updateSidebarBlur = useCallback((value: number) => {
    setSidebarBlur(value);
    localStorage.setItem("folio-sidebar-status-blur", String(value));
  }, []);
  const [scope, setScope] = useState<LibraryScope>("all");
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [smartFolderId, setSmartFolderId] = useState<string | null>(null);
  const [collections, setCollections] = useState<CollectionDto[]>([]);
  const [smartFolders, setSmartFolders] = useState<SmartFolderDto[]>([]);
  const [snapshot, setSnapshot] = useState<LibrarySnapshotDto | null>(null);
  const [fontState, setFontState] = useState<FontStateId>("active");
  const [favoriteEditor, setFavoriteEditor] =
    useState<FavoriteFolderIntent | null>(null);
  const [folderContextMenu, setFolderContextMenu] =
    useState<FolderContextMenuState | null>(null);
  const [collectionTargetId, setCollectionTargetId] = useState("");
  const [organizationError, setOrganizationError] = useState<string | null>(
    null,
  );
  const [sidebarPage, setSidebarPage] = useState<"navigation" | "filters">(
    "navigation",
  );
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState<number | null>(() =>
    storedSidebarWidth("folio-left-sidebar-width"),
  );
  const [rightSidebarWidth, setRightSidebarWidth] = useState<number | null>(
    () => storedSidebarWidth("folio-right-sidebar-width"),
  );
  const [resizingSidebar, setResizingSidebar] = useState<
    "left" | "right" | null
  >(null);
  const [dragPreview, setDragPreview] = useState<{
    side: "left" | "right";
    width: number;
  } | null>(null);
  const [snapClosingSidebar, setSnapClosingSidebar] = useState(false);
  const appWindowRef = useRef<HTMLElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [windowActionError, setWindowActionError] = useState<string | null>(
    null,
  );
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("cloud");
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const searchCapsuleRef = useRef<HTMLDivElement>(null);
  useSmoothCorners(searchCapsuleRef, titlebarCapsuleCorners, {
    autoEffects: false,
    fallbackBorderRadius: "16px",
    effects: {
      innerBorder: {
        width: 1,
        color: searchFocused ? "var(--accent)" : "var(--line)",
        opacity: 1,
      },
    },
  });
  const [selectedFacets, setSelectedFacets] = useState<
    Record<string, string[]>
  >({});
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState<LibraryPageDto | null>(null);
  const [selected, setSelected] = useState<FamilyDto | null>(null);
  const [selectedStyleKey, setSelectedStyleKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuMode, setMenuMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [previewTextMode, setPreviewTextMode] = useState("pangram");
  const [previewText, setPreviewText] = useState(
    "Sphinx of black quartz, judge my vow.",
  );
  const previewAppearance = usePreviewAppearance(
    selected && page?.families.some((family) => family.id === selected.id) ? selected.id : page?.families[0]?.id ?? null,
  );
  const previewSize = previewAppearance.current.size;
  const inspectorAppearance = selected && previewAppearance.editing?.familyId === selected.id
    ? previewAppearance.current : previewAppearance.committed;
  const setPreviewSize = (size: number) => previewAppearance.update({ size });
  const [syncProfile, setSyncProfile] = useState<SyncProfileDto | null>(null);
  const [syncServerUrl, setSyncServerUrl] = useState("");
  const [syncDirectory, setSyncDirectory] = useState("Folio");
  const [syncUsername, setSyncUsername] = useState("");
  const [syncPassword, setSyncPassword] = useState("");
  const [syncAutomatic, setSyncAutomatic] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatusDto | null>(null);
  const [syncMessage, setSyncMessage] = useState("");
  const [storageUsage, setStorageUsage] = useState<StorageUsageDto | null>(null);
  const [storageMessage, setStorageMessage] = useState("");
  const [storageBusy, setStorageBusy] = useState(false);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [cloudFonts, setCloudFonts] = useState<CloudFontDto[]>([]);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflictDto[]>([]);
  const [cloudLoaded, setCloudLoaded] = useState(false);
  const [cloudReadError, setCloudReadError] = useState(false);
  const wasSyncRunning = useRef(false);
  const lastAutomaticSyncAt = useRef(0);
  const pageRequests = useRef(new LibraryPageRequests());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const previewSelectedId = useRef<string | null>(null);
  const recentWrites = useRef<Promise<unknown>>(Promise.resolve());
  const recentStatisticsTimer = useRef(0);
  const hasSmartFolders = useRef(false);
  hasSmartFolders.current = smartFolders.length > 0;
  const [recentError, setRecentError] = useState("");

  useEffect(() => () => window.clearTimeout(recentStatisticsTimer.current), []);

  const selectFamily = useCallback((family: FamilyDto) => {
    const fromSliderPreview = previewSelectedId.current === family.id;
    previewSelectedId.current = null;
    if (selectedRef.current?.id === family.id && !fromSliderPreview) return;
    const finish = startMetric("selection-feedback");
    if (selectedRef.current?.id !== family.id) {
      selectedRef.current = family;
      setSelected(family);
      setSelectedStyleKey(null);
    }
    setRecentError("");
    window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
    const identityId = currentPreviewStyle(family)?.face.identityId;
    if (!identityId) return;
    // 顺序保存访问记录，列表保持当前位置，统计更新合并到后台。
    recentWrites.current = recentWrites.current.catch(() => {}).then(() => recordRecent(identityId)).then((recentCount) => {
      setSnapshot((current) => current ? { ...current, recentCount: Math.max(current.recentCount, recentCount) } : current);
      window.clearTimeout(recentStatisticsTimer.current);
      if (hasSmartFolders.current) recentStatisticsTimer.current = window.setTimeout(() => {
        void listSmartFolders().then(setSmartFolders).catch((cause) => setRecentError(errorMessage(cause)));
      }, 250);
    }).catch((cause) => setRecentError(errorMessage(cause)));
  }, []);

  const previewSelectFamily = useCallback((family: FamilyDto) => {
    previewSelectedId.current = family.id;
    if (selectedRef.current?.id === family.id) return;
    selectedRef.current = family;
    setSelected(family);
    setSelectedStyleKey(null);
  }, []);

  useEffect(() => {
    if (!menuMode) return;
    const closeOnOutsidePress = (event: globalThis.PointerEvent) => {
      if (!(event.target as HTMLElement).closest(".titlebar")) {
        setMenuMode(false);
        setMenuOpen(null);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuMode(false);
        setMenuOpen(null);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuMode]);

  useEffect(() => {
    const updateViewport = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    if (leftSidebarWidth !== null)
      localStorage.setItem(
        "folio-left-sidebar-width",
        String(leftSidebarWidth),
      );
  }, [leftSidebarWidth]);

  useEffect(() => {
    if (rightSidebarWidth !== null)
      localStorage.setItem(
        "folio-right-sidebar-width",
        String(rightSidebarWidth),
      );
  }, [rightSidebarWidth]);

  useEffect(() => {
    if (!snapClosingSidebar) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() =>
        setSnapClosingSidebar(false),
      );
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [snapClosingSidebar]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    const currentWindow = getCurrentWindow();
    const updateMaximizedState = () => {
      void currentWindow
        .isMaximized()
        .then((maximized) => {
          if (active) setIsMaximized(maximized);
        })
        .catch((cause) => {
          if (active) setWindowActionError(errorMessage(cause));
        });
    };
    updateMaximizedState();
    void currentWindow
      .onResized(updateMaximizedState)
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch((cause) => {
        if (active) setWindowActionError(errorMessage(cause));
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const reloadOrganization = useCallback(async () => {
    const [collectionItems, smartFolderItems] = await Promise.all([
      listCollections(),
      listSmartFolders(),
    ]);
    setCollections(collectionItems);
    setSmartFolders(smartFolderItems);
    setCollectionTargetId((current) =>
      collectionItems.some((collection) => collection.id === current)
        ? current
        : (collectionItems[0]?.id ?? ""),
    );
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.themePreference = "system";
    const applyTheme = () => {
      root.dataset.theme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    };
    applyTheme();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, []);

  useEffect(() => {
    localStorage.setItem("folio-view-mode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem("folio-quit-shortcut", quitShortcut);
  }, [quitShortcut]);

  useEffect(() => {
    localStorage.setItem("folio-import-mode", importMode);
    localStorage.setItem("folio-card-hover", String(cardHover));
    localStorage.setItem("folio-card-hover-delay", String(cardHoverDelay));
    localStorage.setItem("folio-card-metadata", String(cardMetadata));
  }, [importMode, cardHover, cardHoverDelay, cardMetadata]);

  useEffect(() => {
    localStorage.setItem("folio-expanded-card-wheel-speed", String(expandedCardWheelSpeed));
  }, [expandedCardWheelSpeed]);

  useEffect(() => {
    const saturation = 150 + ((sidebarBlur - 1) * 50) / 11;
    document.documentElement.style.setProperty(
      "--sidebar-status-blur",
      `${sidebarBlur}px`,
    );
    document.documentElement.style.setProperty(
      "--sidebar-status-saturation",
      `${saturation.toFixed(1)}%`,
    );
  }, [sidebarBlur]);

  useEffect(() => {
    const syncPreferences = (event: StorageEvent) => {
      if (event.key === "folio-view-mode" && event.newValue)
        setViewMode(event.newValue as ViewMode);
      if (event.key === "folio-quit-shortcut")
        setQuitShortcut(parseQuitShortcut(event.newValue));
      if (event.key === "folio-card-hover")
        setCardHover(event.newValue !== "false");
      if (event.key === "folio-card-hover-delay")
        setCardHoverDelay(parseCardHoverDelay(event.newValue));
      if (event.key === "folio-expanded-card-wheel-speed")
        setExpandedCardWheelSpeed(parseExpandedCardWheelSpeed(event.newValue));
      if (event.key === "folio-card-metadata")
        setCardMetadata(event.newValue !== "false");
      if (event.key === "folio-sidebar-status-blur")
        setSidebarBlur(parseSidebarBlur(event.newValue));
    };
    window.addEventListener("storage", syncPreferences);
    return () => window.removeEventListener("storage", syncPreferences);
  }, []);

  const loadPage = useCallback(
    async (text: string, currentScope: LibraryScope, offset = 0) => {
      if (currentScope === "cloudFonts") {
        setLoading(false);
        return;
      }
      const key = JSON.stringify([text, currentScope, selectedFacets, sort, collectionId, smartFolderId, fontState]);
      const ticket = pageRequests.current.begin(key, offset);
      if (!ticket) return;
      setLoading(true);
      setError(null);
      try {
        const result = await queryLibrary({
          text,
          scope: currentScope,
          offset,
          limit: 120,
          facets: selectedFacets,
          sort,
          collectionId:
            currentScope === "collection"
              ? (collectionId ?? undefined)
              : undefined,
          smartFolderId:
            currentScope === "smartFolder"
              ? (smartFolderId ?? undefined)
              : undefined,
          fontState:
            currentScope === "fontState" ? fontState : undefined,
        });
        if (!pageRequests.current.current(ticket)) return;
        setPage((current) =>
          offset > 0 && current
            ? appendLibraryPage(current, result)
            : result,
        );
        setSelected((current) =>
          current
            ? (result.families.find((family) => family.id === current.id) ??
              (offset > 0 ? current : null))
            : null,
        );
      } catch (cause) {
        if (pageRequests.current.current(ticket)) setError(errorMessage(cause));
      } finally {
        if (pageRequests.current.finish(ticket)) setLoading(false);
      }
    },
    [
      collectionId,
      fontState,
      selectedFacets,
      smartFolderId,
      sort,
    ],
  );

  const loadMore = useCallback(() => {
    if (page && !loading) void loadPage(search, scope, page.families.length);
  }, [loadPage, loading, page, search, scope]);

  const requestCarouselRange = useCallback(async (offset: number, limit: number) => {
    const result = await queryLibrary({
      text: search, scope, offset, limit, facets: selectedFacets, sort,
      collectionId: scope === "collection" ? (collectionId ?? undefined) : undefined,
      smartFolderId: scope === "smartFolder" ? (smartFolderId ?? undefined) : undefined,
      fontState: scope === "fontState" ? fontState : undefined,
    });
    return result.families;
  }, [search, scope, selectedFacets, sort, collectionId, smartFolderId, fontState]);

  const favoriteFamily = useCallback((family: FamilyDto) => {
    void setFamilyFavorite(family.faces.map((face) => face.identityId), !family.isFavorite)
      .then(() => Promise.all([loadPage(search, scope), reloadOrganization()]))
      .catch((cause) => setError(errorMessage(cause)));
  }, [loadPage, reloadOrganization, search, scope]);

  useEffect(() => {
    if (settingsWindow) return;
    const timer = window.setTimeout(
      () => void loadPage(search, scope),
      search ? 150 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [loadPage, search, scope, settingsWindow]);

  useEffect(() => {
    if (settingsWindow) return;
    let active = true;
    void refreshLibrary()
      .then((result) => {
        if (!active || settingsWindow) return;
        setSnapshot(result);
        return Promise.all([loadPage(search, scope), reloadOrganization()]);
      })
      .catch((cause) => {
        if (active && !settingsWindow) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
    // 首屏先显示缓存，再完成一次增量刷新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadOrganization, settingsWindow]);

  // 主窗口共用云端状态；同步结束后更新 Hero、字体列表与冲突。
  useEffect(() => {
    if (settingsWindow) return;
    let active = true;
    let previousRunning = false;
    let previousConfigured = false;
    let cloudStateLoaded = false;
    let cloudStateLoading = false;
    const loadCloud = async () => {
      if (cloudStateLoading) return;
      cloudStateLoading = true;
      try {
        const [profile, status, fonts, conflicts] = await Promise.all([
          getSyncProfile(),
          getSyncStatus(),
          listCloudFonts(),
          listSyncConflicts(),
        ]);
        if (!active) return;
        setSyncProfile(profile);
        setSyncStatus(status);
        setCloudFonts(fonts);
        setSyncConflicts(conflicts);
        setCloudReadError(false);
        setCloudLoaded(true);
        cloudStateLoaded = true;
        previousRunning = status.running;
        previousConfigured = status.configured;
      } catch {
        cloudStateLoaded = false;
        if (active) {
          setCloudReadError(true);
          setCloudLoaded(true);
        }
      } finally {
        cloudStateLoading = false;
      }
    };
    void loadCloud();
    const timer = window.setInterval(() => {
      void getSyncStatus()
        .then((status) => {
          if (!active) return;
          setSyncStatus(status);
          if (!cloudStateLoaded || (previousRunning && !status.running) || previousConfigured !== status.configured) void loadCloud();
          else setCloudReadError(false);
          previousRunning = status.running;
          previousConfigured = status.configured;
        })
        .catch(() => { if (active) setCloudReadError(true); });
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [settingsWindow]);

  useEffect(() => {
    if (!settingsWindow || settingsPage !== "storage") return;
    let active = true;
    void getStorageUsage()
      .then((usage) => { if (active) setStorageUsage(usage); })
      .catch((cause) => { if (active) setStorageMessage(errorMessage(cause)); });
    return () => { active = false; };
  }, [settingsWindow, settingsPage]);

  const runRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await refreshLibrary();
      setSnapshot(result);
      await Promise.all([loadPage(search, scope), reloadOrganization()]);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRefreshing(false);
    }
  }, [loadPage, reloadOrganization, search, scope]);

  useEffect(() => {
    if (!settingsWindow) return;
    let active = true;
    const loadSettingsData = async () => {
      try {
        const [profile, status, fonts, conflicts] = await Promise.all([
          getSyncProfile(),
          getSyncStatus(),
          listCloudFonts(),
          listSyncConflicts(),
        ]);
        if (!active) return;
        setSyncProfile(profile);
        setSyncStatus(status);
        setCloudFonts(fonts);
        setSyncConflicts(conflicts);
        if (profile) {
          setSyncServerUrl(profile.serverUrl);
          setSyncDirectory(profile.remoteDirectory);
          setSyncUsername(profile.username);
          setSyncAutomatic(profile.automatic);
        }
        wasSyncRunning.current = status.running;
      } catch (cause) {
        if (active) setSyncMessage(errorMessage(cause));
      }
    };
    void loadSettingsData();
    const timer = window.setInterval(() => {
      void getSyncStatus()
        .then((status) => {
          if (!active) return;
          setSyncStatus(status);
          if (wasSyncRunning.current && !status.running) {
            void Promise.all([listCloudFonts(), listSyncConflicts()])
              .then(([fonts, conflicts]) => {
                if (active) {
                  setCloudFonts(fonts);
                  setSyncConflicts(conflicts);
                }
              })
              .catch((cause) => setSyncMessage(errorMessage(cause)));
          }
          wasSyncRunning.current = status.running;
        })
        .catch((cause) => {
          if (active) setSyncMessage(errorMessage(cause));
        });
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [settingsWindow]);

  useEffect(() => {
    if (settingsWindow) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen("library-updated", () => void runRefresh())
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [runRefresh, settingsWindow]);

  useEffect(() => {
    if (settingsWindow) return;
    let active = true;
    const tryAutomaticSync = async () => {
      if (
        !navigator.onLine ||
        Date.now() - lastAutomaticSyncAt.current < 300_000
      )
        return;
      try {
        const [profile, status] = await Promise.all([
          getSyncProfile(),
          getSyncStatus(),
        ]);
        if (!active) return;
        if (profile?.automatic && !status.running) {
          lastAutomaticSyncAt.current = Date.now();
          await syncNow();
        }
        if (status.running && !wasSyncRunning.current)
          wasSyncRunning.current = true;
        if (!status.running && wasSyncRunning.current) {
          wasSyncRunning.current = false;
          lastAutomaticSyncAt.current = Date.now();
        }
      } catch (cause) {
        if (active) setError(errorMessage(cause));
      }
    };
    void tryAutomaticSync();
    const timer = window.setInterval(() => void tryAutomaticSync(), 60_000);
    window.addEventListener("online", tryAutomaticSync);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("online", tryAutomaticSync);
    };
  }, [settingsWindow]);

  const currentSyncProfile = (): SyncProfileDto => ({
    serverUrl: syncServerUrl.trim(),
    remoteDirectory: syncDirectory.trim(),
    username: syncUsername.trim(),
    automatic: syncAutomatic,
  });

  const clearStoredCatalog = async () => {
    setStorageBusy(true);
    setStorageMessage("");
    try {
      const removed = await clearCatalogCache();
      setStorageUsage(await getStorageUsage());
      setStorageMessage(t("storage.catalogCleaned", { count: removed }));
    } catch (cause) {
      setStorageMessage(errorMessage(cause));
    } finally {
      setStorageBusy(false);
    }
  };

  const rebuildStoredSyncIndexes = async () => {
    setConfirmRebuild(false);
    setStorageBusy(true);
    setStorageMessage("");
    try {
      await rebuildSyncIndexes();
      setStorageUsage(await getStorageUsage());
      setStorageMessage(t("cloud.rebuildDone"));
    } catch (cause) {
      setStorageMessage(errorMessage(cause));
    } finally {
      setStorageBusy(false);
    }
  };

  const testCloudConnection = async () => {
    setSyncMessage(t("cloud.testingConnection"));
    try {
      await testSyncConnection(currentSyncProfile(), syncPassword);
      setSyncMessage(t("cloud.connectSuccess"));
    } catch (cause) {
      setSyncMessage(errorMessage(cause));
    }
  };

  const saveCloudConnection = async () => {
    try {
      const profile = currentSyncProfile();
      await saveSyncConnection(profile, syncPassword);
      setSyncProfile(profile);
      setSyncPassword("");
      setSyncMessage(t("cloud.connectionSaved"));
      if (profile.automatic) await syncNow();
      setSyncStatus(await getSyncStatus());
    } catch (cause) {
      setSyncMessage(errorMessage(cause));
    }
  };

  const startCloudSync = async () => {
    try {
      // 由用户操作触发，同步完成前避免自动任务重复启动。
      // eslint-disable-next-line react-hooks/purity
      lastAutomaticSyncAt.current = Date.now();
      await syncNow();
      setSyncStatus(await getSyncStatus());
      setSyncMessage("");
      wasSyncRunning.current = true;
    } catch (cause) {
      setSyncMessage(errorMessage(cause));
    }
  };

  const restoreCloudCopy = async (font: CloudFontDto) => {
    try {
      if (font.deleted) {
        await restoreDeletedCloudFont(font.fingerprint);
      } else {
        await restoreCloudFont(font.fingerprint);
      }
      await startCloudSync();
    } catch (cause) {
      setSyncMessage(errorMessage(cause));
    }
  };

  const disconnectCloud = async () => {
    try {
      await disconnectSync();
      setSyncProfile(null);
      setSyncStatus(await getSyncStatus());
      setSyncPassword("");
      setSyncMessage(t("cloud.disconnected"));
    } catch (cause) {
      setSyncMessage(errorMessage(cause));
    }
  };

  const applySyncConflict = async (
    conflictId: string,
    resolution: "keepBoth" | "useLocal" | "useRemote",
  ) => {
    try {
      await resolveSyncConflict(conflictId, resolution);
      setSyncConflicts(await listSyncConflicts());
      setSyncMessage(t("cloud.conflictsSaved"));
    } catch (cause) {
      setSyncMessage(errorMessage(cause));
    }
  };

  const chooseFolder = useCallback(async () => {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: t("import.addFontFolder"),
      });
      if (typeof selectedPath !== "string") return;
      setRefreshing(true);
      const result = await addLibraryRoot(selectedPath);
      setSnapshot(result);
      await Promise.all([loadPage(search, scope), reloadOrganization()]);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRefreshing(false);
    }
  }, [loadPage, reloadOrganization, search, scope, t]);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (matchesQuitShortcut(event, quitShortcut)) {
        event.preventDefault();
        void quitApp();
        return;
      }
      if (settingsWindow || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (!refreshing) void runRefresh();
      } else if (event.key === ",") {
        event.preventDefault();
        void openSettings();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [quitShortcut, refreshing, runRefresh, settingsWindow]);

  // 切换页面时清空继承的搜索与筛选条件，避免带出上一页（尤其是智慧收藏夹）的条件。
  const clearQueryConditions = () => {
    setSearch("");
    setSelectedFacets({});
  };

  const selectLibraryScope = (next: LibraryScope) => {
    if (next !== scope) clearQueryConditions();
    setScope(next);
    setSelected(null);
  };

  const selectFontState = (id: FontStateId) => {
    if (scope !== "fontState" || fontState !== id) clearQueryConditions();
    setFontState(id);
    setScope("fontState");
    setSelected(null);
  };

  const selectCollection = (id: string) => {
    if (scope !== "collection" || collectionId !== id) clearQueryConditions();
    setScope("collection");
    setCollectionId(id);
    setSmartFolderId(null);
    setSelected(null);
  };

  const openSmartFolder = (folder: SmartFolderDto) => {
    setScope("smartFolder");
    setSmartFolderId(folder.id);
    setCollectionId(null);
    setSearch(folder.queryText ?? "");
    setSelectedFacets(folder.facets);
    setSelected(null);
  };

  const beginFavoriteFolderCreation = () => {
    setOrganizationError(null);
    setFavoriteEditor({ kind: "create" });
  };

  const beginFavoriteFolderEditing = (intent: FavoriteFolderIntent) => {
    setOrganizationError(null);
    setFavoriteEditor(intent);
  };

  const closeFavoriteFolderEditor = () => {
    setFavoriteEditor(null);
    setOrganizationError(null);
  };

  // 收藏夹编辑器的初始值：编辑时取原值，新建时沿用当前搜索与筛选。
  const favoriteFolderSeed = useMemo<FavoriteFolderDraft>(() => {
    if (favoriteEditor?.kind === "editSmartFolder") {
      return {
        name: favoriteEditor.folder.name,
        text: favoriteEditor.folder.queryText ?? "",
        facets: favoriteEditor.folder.facets,
        icon: favoriteEditor.folder.icon,
        color: favoriteEditor.folder.color,
      };
    }
    if (favoriteEditor?.kind === "editCollection") {
      return {
        name: favoriteEditor.collection.name,
        text: "",
        facets: {},
        icon: favoriteEditor.collection.icon,
        color: favoriteEditor.collection.color,
      };
    }
    let text = search;
    let facets = selectedFacets;
    if (scope === "smartFolder") {
      const folder = smartFolders.find((item) => item.id === smartFolderId);
      if (folder) {
        text = [folder.queryText ?? "", search].filter(Boolean).join(" ");
        facets = mergeFacets(folder.facets, selectedFacets);
      }
    }
    return { name: "", text, facets, icon: "folder", color: "gray" };
  }, [favoriteEditor, scope, search, selectedFacets, smartFolderId, smartFolders]);

  // 与 macOS 版本一致：有筛选条件保存为智慧收藏夹，否则保存为手动收藏夹。
  const saveFavoriteFolder = async (draft: FavoriteFolderDraft) => {
    if (!favoriteEditor) return;
    const name = draft.name.trim();
    if (!name) {
      setOrganizationError(t("collection.nameRequired"));
      return;
    }
    if (draft.facets.roots?.length) {
      setOrganizationError(t("filters.smartUnsupportedSource"));
      return;
    }
    const text = draft.text.trim();
    const hasRules =
      text.length > 0 ||
      Object.values(draft.facets).some((values) => values.length > 0);
    try {
      if (favoriteEditor.kind === "create") {
        if (hasRules) {
          const saved = await saveSmartFolder({
            name,
            text,
            facets: draft.facets,
            icon: draft.icon,
            color: draft.color,
          });
          await reloadOrganization();
          openSmartFolder(saved);
        } else {
          const saved = await saveCollection({
            name,
            icon: draft.icon,
            color: draft.color,
          });
          await reloadOrganization();
          selectCollection(saved.id);
        }
      } else if (favoriteEditor.kind === "editCollection") {
        if (hasRules) {
          const saved = await convertCollectionToSmartFolder({
            id: favoriteEditor.collection.id,
            name,
            text,
            facets: draft.facets,
            icon: draft.icon,
            color: draft.color,
          });
          await reloadOrganization();
          openSmartFolder(saved);
        } else {
          const saved = await saveCollection({
            id: favoriteEditor.collection.id,
            name,
            icon: draft.icon,
            color: draft.color,
          });
          await reloadOrganization();
          selectCollection(saved.id);
        }
      } else if (hasRules) {
        const saved = await saveSmartFolder({
          id: favoriteEditor.folder.id,
          name,
          text,
          facets: draft.facets,
          icon: draft.icon,
          color: draft.color,
        });
        await reloadOrganization();
        openSmartFolder(saved);
      } else {
        const saved = await convertSmartFolderToCollection({
          id: favoriteEditor.folder.id,
          name,
          icon: draft.icon,
          color: draft.color,
        });
        await reloadOrganization();
        selectCollection(saved.id);
      }
      setFavoriteEditor(null);
      setOrganizationError(null);
    } catch (cause) {
      setOrganizationError(errorMessage(cause));
    }
  };

  const removeCollection = async (collection: CollectionDto) => {
    try {
      await deleteCollection(collection.id);
      await reloadOrganization();
      if (scope === "collection" && collectionId === collection.id) {
        setScope("all");
        setCollectionId(null);
        clearQueryConditions();
      }
      setOrganizationError(null);
    } catch (cause) {
      setOrganizationError(errorMessage(cause));
    }
  };

  const removeSmartFolder = async (folder: SmartFolderDto) => {
    try {
      await deleteSmartFolder(folder.id);
      await reloadOrganization();
      if (scope === "smartFolder" && smartFolderId === folder.id) {
        setScope("all");
        setSmartFolderId(null);
        clearQueryConditions();
      }
      setOrganizationError(null);
    } catch (cause) {
      setOrganizationError(errorMessage(cause));
    }
  };

  const openFolderContextMenu = (
    event: MouseEvent<HTMLElement>,
    intent: FavoriteFolderIntent,
  ) => {
    event.preventDefault();
    setFolderContextMenu({ x: event.clientX, y: event.clientY, intent });
  };

  useEffect(() => {
    if (!folderContextMenu) return;
    const close = () => setFolderContextMenu(null);
    const closeOnKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnKey);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnKey);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [folderContextMenu]);

  const updateSelectedCollectionMembership = async (member: boolean) => {
    if (!selected || !collectionTargetId) return;
    try {
      await setCollectionMembers(
        collectionTargetId,
        selected.faces.map((face) => face.identityId),
        member,
      );
      await Promise.all([reloadOrganization(), loadPage(search, scope)]);
      setOrganizationError(null);
    } catch (cause) {
      setOrganizationError(errorMessage(cause));
    }
  };

  const toggleWindowMaximize = async () => {
    try {
      const currentWindow = getCurrentWindow();
      const wasMaximized = await currentWindow.isMaximized();
      await currentWindow.toggleMaximize();
      setIsMaximized(!wasMaximized);
      setWindowActionError(null);
    } catch (cause) {
      setWindowActionError(errorMessage(cause));
    }
  };

  const settings = useMemo(
    () => settingsPages.find((item) => item.id === settingsPage),
    [settingsPage],
  );
  const currentScopeTitle =
    scope === "collection"
      ? (collections.find((collection) => collection.id === collectionId)
          ?.name ?? t("collection.collection"))
      : scope === "smartFolder"
        ? (smartFolders.find((folder) => folder.id === smartFolderId)?.name ??
          t("navigation.smartCollections"))
        : scope === "fontState"
          ? fontStateLabel(fontState, snapshot)
          : scopeTitle(scope);
  const libraryHero = useMemo(() => createLibraryHero({ snapshot, profile: syncProfile, status: syncStatus, fonts: cloudFonts, conflicts: syncConflicts, cloudLoaded, cloudReadError }), [snapshot, syncProfile, syncStatus, cloudFonts, syncConflicts, cloudLoaded, cloudReadError]);
  const handleHeroAction = (action: HeroAction) => {
    if (action === "cloudSettings") void openSettings().catch((cause) => setError(errorMessage(cause)));
    else selectLibraryScope(action);
  };
  const compactViewport = viewportWidth <= 860;
  const healthCount = snapshot
    ? snapshot.health.damagedFiles +
      snapshot.health.multipleRevisions +
      snapshot.health.metadataConflicts
    : 0;
  const activeCloudFonts = cloudFonts.filter((font) => !font.deleted);
  const cloudFontStorage = formatFileSize(
    activeCloudFonts.reduce((sum, font) => sum + font.fileSize, 0),
  );
  const preferredLeftWidth = leftSidebarWidth ?? (compactViewport ? 190 : 240);
  const preferredRightWidth =
    rightSidebarWidth ?? (compactViewport ? 222 : 276);
  const leftMinimumWidth = compactViewport ? 190 : 240;
  const rightMinimumWidth = compactViewport ? 222 : 256;
  const availableSidebarWidth = Math.max(0, viewportWidth - 288);
  const rightReservation = dragPreview?.side === "right"
    ? dragPreview.width
    : rightSidebarOpen ? rightMinimumWidth : 0;
  const leftPaneWidth = dragPreview?.side === "left"
    ? Math.min(dragPreview.width, Math.max(0, availableSidebarWidth - (rightSidebarOpen ? rightMinimumWidth : 0)))
    : leftSidebarOpen
      ? Math.min(
          preferredLeftWidth,
          Math.max(0, availableSidebarWidth - rightReservation),
        )
      : 0;
  const rightPaneWidth = dragPreview?.side === "right"
    ? Math.min(dragPreview.width, Math.max(0, availableSidebarWidth - leftPaneWidth))
    : rightSidebarOpen
      ? Math.min(preferredRightWidth, Math.max(0, availableSidebarWidth - leftPaneWidth))
      : 0;
  const leftSidebarVisible = dragPreview?.side === "left" ? leftPaneWidth > 0 : leftSidebarOpen;
  const rightSidebarVisible = dragPreview?.side === "right" ? rightPaneWidth > 0 : rightSidebarOpen;
  const maximumSidebarWidth = (side: "left" | "right") =>
    Math.max(
      side === "left" ? leftMinimumWidth : rightMinimumWidth,
      Math.min(
        side === "left" ? 440 : 480,
        availableSidebarWidth - (side === "left"
          ? rightSidebarOpen ? rightMinimumWidth : 0
          : leftSidebarOpen ? leftMinimumWidth : 0),
      ),
    );
  const resizeSidebar = (side: "left" | "right", proposedWidth: number) => {
    const minimum = side === "left" ? leftMinimumWidth : rightMinimumWidth;
    if (proposedWidth < minimum) {
      setSnapClosingSidebar(true);
      if (side === "left") setLeftSidebarOpen(false);
      else setRightSidebarOpen(false);
      return;
    }
    const width = Math.round(Math.max(minimum, Math.min(maximumSidebarWidth(side), proposedWidth)));
    if (side === "left") {
      setLeftSidebarWidth(width);
      setLeftSidebarOpen(true);
    } else {
      setRightSidebarWidth(width);
      setRightSidebarOpen(true);
    }
  };
  const sidebarWidthFromPointer = (side: "left" | "right", clientX: number) => {
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const proposedWidth = side === "left" ? clientX - rect.left : rect.right - clientX;
    return Math.round(Math.max(0, Math.min(maximumSidebarWidth(side), proposedWidth)));
  };
  const resizeFromPointer = (side: "left" | "right", clientX: number) => {
    const width = sidebarWidthFromPointer(side, clientX);
    if (width !== null) setDragPreview({ side, width });
  };
  const finishPointerResize = (side: "left" | "right", clientX: number) => {
    const width = sidebarWidthFromPointer(side, clientX);
    setDragPreview(null);
    setResizingSidebar(null);
    if (width === null) return;
    const minimum = side === "left" ? leftMinimumWidth : rightMinimumWidth;
    if (width < minimum / 2) {
      setSnapClosingSidebar(true);
      if (side === "left") setLeftSidebarOpen(false);
      else setRightSidebarOpen(false);
    } else {
      if (side === "right" && leftSidebarOpen) {
        setLeftSidebarWidth(Math.max(leftMinimumWidth, Math.min(preferredLeftWidth, availableSidebarWidth - width)));
      }
      resizeSidebar(side, Math.max(minimum, width));
    }
  };
  const fileMenuItems: MenuEntry[] = [
    { label: t("import.addFontFolderEllipsis"), action: chooseFolder, Icon: FolderPlusIcon },
    { label: t("desktop.refreshLibrary"), action: runRefresh, Icon: ArrowClockwiseIcon, shortcut: "Ctrl+R", ariaShortcut: "Control+R", disabled: refreshing },
    { label: t("common.settingsEllipsis"), action: openSettings, shortcut: "Ctrl+,", ariaShortcut: "Control+,", separatorBefore: true },
    { label: t("desktop.quit"), action: quitApp, shortcut: quitShortcutOptions.find((option) => option.id === quitShortcut)?.label, ariaShortcut: quitShortcut, separatorBefore: true },
  ];
  const appMenus: { id: string; label: string; items: MenuEntry[] }[] = [
    {
      id: "edit",
      label: "macos.menuEdit",
      items: [
        {
          label: t("desktop.selectAll"),
          action: () => document.querySelector<HTMLElement>(".font-grid")?.focus(),
        },
      ],
    },
    {
      id: "view",
      label: "macos.menuView",
      items: [
        ...viewModes.map(({ id, label }) => ({
          label: t(label),
          action: () => setViewMode(id),
          checked: viewMode === id,
        })),
        {
          label: t("desktop.leftSidebarToggle", { action: leftSidebarOpen ? t("desktop.collapse") : t("desktop.expand") }),
          action: () => setLeftSidebarOpen((open) => !open),
          separatorBefore: true,
        },
        {
          label: t("desktop.rightSidebarToggle", { action: rightSidebarOpen ? t("desktop.collapse") : t("desktop.expand") }),
          action: () => setRightSidebarOpen((open) => !open),
        },
      ],
    },
    {
      id: "window",
      label: "macos.menuWindow",
      items: [
        { label: t("navigation.library"), action: () => window.location.assign("index.html") },
        { label: t("common.settingsEllipsis"), action: openSettings, shortcut: "Ctrl+,", ariaShortcut: "Control+,", separatorBefore: true },
      ],
    },
    {
      id: "help",
      label: "macos.menuHelp",
      items: [
        {
          label: t("desktop.about"),
          action: () => settingsWindow ? setSettingsPage("about") : void openSettings(),
        },
      ],
    },
  ];
  const closeMenu = () => {
    setMenuOpen(null);
    setMenuMode(false);
  };
  const renderMenuItems = (items: MenuEntry[]) =>
    items.map((item) => (
      <Fragment key={item.label}>
        {item.separatorBefore && <div className="menu-separator" role="separator" />}
        <MenuItem
          item={item}
          onSelect={(selectedItem) => {
            closeMenu();
            void selectedItem.action();
          }}
        />
      </Fragment>
    ));

  return (
    <main
      ref={appWindowRef}
      className={`app-window${settingsWindow ? " settings-window" : ""}`}
    >
      <header
        className={`titlebar${settingsWindow ? " settings-titlebar" : ""}`}
        onMouseDown={(event) => {
          if (
            event.button !== 0 ||
            (event.target as HTMLElement).closest(
              "button, input, summary, a, [role='menu']",
            )
          )
            return;
          void getCurrentWindow()
            .startDragging()
            .catch((cause) => setWindowActionError(errorMessage(cause)));
        }}
        onDoubleClick={(event) => {
          if (settingsWindow) return;
          if (
            (event.target as HTMLElement).closest(
              "button, input, summary, a, [role='menu']",
            )
          )
            return;
          void toggleWindowMaximize();
        }}
      >
        {settingsWindow ? (
          <span className="settings-title-mark" role="img" aria-label={t("common.settings")}>
            <GearSixIcon aria-hidden="true" />
          </span>
        ) : (
          <>
            <Button
              className="titlebar-sidebar-button"
              isIconOnly
              size="sm"
              variant="tertiary"
              isDisabled={menuMode}
              aria-label={leftSidebarOpen ? t("desktop.collapseLeft") : t("desktop.expandLeft")}
              aria-pressed={leftSidebarOpen}
              onPress={() => setLeftSidebarOpen((open) => !open)}
            >
              <SidebarSimpleIcon size={14} />
            </Button>
            <div className="titlebar-leading">
              <button
                type="button"
                className="window-brand"
                aria-label={t("desktop.fileMenu")}
                aria-expanded={menuMode && menuOpen === "file"}
                aria-controls="file-menu"
                onClick={() => {
                  if (menuMode) closeMenu();
                  else {
                    setMenuMode(true);
                    setMenuOpen("file");
                  }
                }}
                onMouseEnter={() => {
                  if (menuMode) setMenuOpen("file");
                }}
              >
                <FolioWordmark />
              </button>
              {menuMode && menuOpen === "file" && (
                <MenuPopover
                  backdropRoot={appWindowRef.current}
                  className="file-menu-popover"
                  id="file-menu"
                  label={t("desktop.fileMenu")}
                >
                  {renderMenuItems(fileMenuItems)}
                </MenuPopover>
              )}
              {menuMode && (
                <nav className="menubar" aria-label={t("desktop.appMenu")}>
                  {appMenus.map((menu) => (
                    <div
                      className="menu-root"
                      key={menu.id}
                      onMouseEnter={() => setMenuOpen(menu.id)}
                    >
                      <button
                        type="button"
                        className="menu-trigger"
                        aria-expanded={menuOpen === menu.id}
                        aria-controls={`menu-${menu.id}`}
                        onFocus={() => setMenuOpen(menu.id)}
                        onClick={() => setMenuOpen(menu.id)}
                      >
                        {t(menu.label)}
                      </button>
                      {menuOpen === menu.id && (
                        <MenuPopover
                          backdropRoot={appWindowRef.current}
                          id={`menu-${menu.id}`}
                          label={t(menu.label)}
                        >
                          {renderMenuItems(menu.items)}
                        </MenuPopover>
                      )}
                    </div>
                  ))}
                </nav>
              )}
            </div>
          </>
        )}
        {!settingsWindow && <div className="titlebar-center" hidden={menuMode}>
          <div className="titlebar-drag-space" aria-hidden="true" />
          <Toolbar className="titlebar-actions" aria-label={t("desktop.tools")}>
          <SmoothCorners
            className="view-picker"
            corners={titlebarCapsuleCorners}
            autoEffects={false}
            aria-label={t("libraryView.browseMode")}
          >
            <SmoothCorners
              className="view-picker-thumb"
              corners={titlebarThumbCorners}
              autoEffects={false}
              aria-hidden="true"
              style={{ transform: `translateX(${viewModes.findIndex(({ id }) => id === viewMode) * 34}px)` }}
            />
            {viewModes.map(({ id, label, Icon }, index) => (
              <Fragment key={id}>
                {index > 0 && <span className="view-picker-divider" aria-hidden="true" />}
                <Button
                  isIconOnly
                  size="sm"
                  variant={viewMode === id ? "secondary" : "tertiary"}
                  className="view-mode-button"
                  aria-label={t(label)}
                  aria-pressed={viewMode === id}
                  onPress={() => setViewMode(id)}
                >
                  <Icon />
                </Button>
              </Fragment>
            ))}
          </SmoothCorners>
          <div
            ref={searchCapsuleRef}
            className="search-capsule"
            style={{ borderRadius: 16 }}
            onFocusCapture={() => setSearchFocused(true)}
            onBlurCapture={() => setSearchFocused(false)}
          >
            <SearchField
              className="search-box"
              aria-label={t("library.searchFonts")}
              value={search}
              onChange={setSearch}
            >
              <SearchField.Group>
                <SearchField.SearchIcon>
                  <MagnifyingGlassIcon />
                </SearchField.SearchIcon>
                <SearchField.Input placeholder={t("desktop.searchFontsPlaceholder")} />
              </SearchField.Group>
            </SearchField>
          </div>
          <SmoothCorners
            className="titlebar-action-capsule"
            corners={titlebarCapsuleCorners}
            autoEffects={false}
          >
            <SmoothCorners
              className="titlebar-action-item"
              corners={titlebarThumbCorners}
              autoEffects={false}
            >
              <Button
                isIconOnly
                size="sm"
                aria-label={t("desktop.refreshLibrary")}
                variant="tertiary"
                onPress={() => void runRefresh()}
                isDisabled={refreshing}
              >
                <ArrowClockwiseIcon className={refreshing ? "spin" : ""} />
              </Button>
            </SmoothCorners>
            <span className="titlebar-action-divider" aria-hidden="true" />
            <SmoothCorners
              className="titlebar-action-item"
              corners={titlebarThumbCorners}
              autoEffects={false}
            >
              <Button
                isIconOnly
                size="sm"
                aria-label={t("import.addFontFolder")}
                variant="tertiary"
                onPress={() => void chooseFolder()}
              >
                <PlusIcon />
              </Button>
            </SmoothCorners>
          </SmoothCorners>
          </Toolbar>
          <div className="titlebar-drag-space" aria-hidden="true" />
        </div>}
        {menuMode && !settingsWindow && <div className="titlebar-drag-space" aria-hidden="true" />}
        {settingsWindow && (
          <SegmentedTabs
            items={settingsPages.map(({ id, title }) => ({ id, title: t(title) }))}
            selectedKey={settingsPage}
            onSelectionChange={setSettingsPage}
            panelId="settings-panel"
            tabIdPrefix="settings-tab"
            ariaLabel={t("settings.category")}
            className="settings-tab-picker settings-titlebar-tabs"
          />
        )}
        <div className="window-controls" aria-label={t("desktop.windowControls")}>
          {!settingsWindow && <Button
            className="titlebar-sidebar-button"
            isIconOnly
            size="sm"
            variant="tertiary"
            isDisabled={menuMode}
            aria-label={rightSidebarOpen ? t("desktop.collapseRight") : t("desktop.expandRight")}
            aria-pressed={rightSidebarOpen}
            onPress={() => setRightSidebarOpen((open) => !open)}
          >
            <SidebarSimpleIcon size={14} mirrored />
          </Button>}
          {!settingsWindow && (
            <>
              <Button
                isIconOnly
                variant="tertiary"
                aria-label={t("desktop.minimizeWindow")}
                onPress={() =>
                  void getCurrentWindow()
                    .minimize()
                    .catch((cause) => setWindowActionError(errorMessage(cause)))
                }
              >
                <MinusIcon size={13} />
              </Button>
              <Button
                isIconOnly
                variant="tertiary"
                aria-label={isMaximized ? t("desktop.restoreWindow") : t("desktop.maximizeWindow")}
                onPress={() => void toggleWindowMaximize()}
              >
                {isMaximized ? <CopySimpleIcon size={13} /> : <SquareIcon size={13} />}
              </Button>
            </>
          )}
          <Button
            className="close-control"
            isIconOnly
            variant="tertiary"
            aria-label={t("desktop.closeWindow")}
            onPress={() =>
              void getCurrentWindow()
                .close()
                .catch((cause) => setWindowActionError(errorMessage(cause)))
            }
          >
            <XIcon size={14} />
          </Button>
        </div>
      </header>

      {windowActionError && (
        <div className="window-action-error" role="alert">
          <span>{windowActionError}</span>
          <button
            aria-label={t("desktop.closeHint")}
            onClick={() => setWindowActionError(null)}
          >
            <XIcon />
          </button>
        </div>
      )}

      {settingsWindow ? (
        <section className="settings-content" aria-label={t("common.settings")}>
          <article
            id="settings-panel"
            className="settings-page"
            role="tabpanel"
            aria-labelledby={`settings-tab-${settingsPage}`}
            tabIndex={0}
          >
            <h1>{settings ? t(settings.title) : null}</h1>
            {settingsPage === "storage" ? (
              <>
                <p className="settings-description">{t("settings.storageDescription")}</p>
                {storageUsage ? (
                  <>
                    <section className="settings-group storage-summary" aria-label={t("storage.overview")}>
                      <StorageVolumeBar usage={storageUsage} />
                      <p>{t("storage.totalNote")}</p>
                    </section>
                    <section className="settings-group storage-details">
                      <h2>{t("storage.usageDetails")}</h2>
                      <div className="storage-detail-row">
                        <span className="storage-dot storage-fonts" aria-hidden="true" />
                        <div><strong>{t("storage.managedLabel")}</strong><p>{t("storage.managedFontsDetail")}</p></div>
                        <span className="storage-detail-size">{formatFileSize(storageUsage.managedFontBytes)}</span>
                      </div>
                      <div className="storage-detail-row">
                        <span className="storage-dot storage-database" aria-hidden="true" />
                        <div><strong>{t("storage.libraryDatabase")}</strong><p>{t("storage.libraryDatabaseDetail")}</p></div>
                        <span className="storage-detail-size">{formatFileSize(storageUsage.databaseBytes)}</span>
                      </div>
                      <div className="storage-detail-row">
                        <span className="storage-dot storage-cache" aria-hidden="true" />
                        <div><strong>{t("storage.catalogCache")}</strong><p>{t("storage.catalogCacheDetail", { count: storageUsage.catalogCacheEntries })}</p></div>
                        <span className="storage-detail-size">{formatFileSize(storageUsage.catalogCacheEstimatedBytes)}</span>
                        <Button size="sm" variant="secondary" aria-label={t("storage.cleanCatalogCache")} isDisabled={storageBusy || syncStatus?.running} onPress={() => void clearStoredCatalog()}>{t("storage.clean")}</Button>
                      </div>
                    </section>
                  </>
                ) : <section className="settings-group"><p className="settings-note">{t("storage.measuring")}</p></section>}
                <section className="settings-group">
                  <h2>{t("cloud.syncIndex")}</h2>
                  <p>{t("storage.syncIndexDetail")}</p>
                  <div className="setting-actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      isDisabled={storageBusy || syncStatus?.running}
                      onPress={() => setConfirmRebuild(true)}
                    >{t("storage.rebuildIndex")}</Button>
                  </div>
                </section>
                {storageMessage && <p className="settings-note" role="status">{storageMessage}</p>}
              </>
            ) : settingsPage === "display" ? (
              <>
                <section className="settings-group">
                  <h2>{t("language.title")}</h2>
                  <label className="setting-field">
                    {t("language.title")}
                    <OptionSelect
                      label={t("language.title")}
                      value={languageSetting}
                      options={[
                        { id: "system", label: t("language.system") },
                        { id: "zh-CN", label: t("language.zhHans") },
                        { id: "en", label: t("language.en") },
                      ]}
                      onChange={(value) => {
                        const next = value as LanguageSetting;
                        setLanguage(next);
                        setLanguageSetting(next);
                      }}
                    />
                  </label>
                </section>
                <section className="settings-group">
                  <h2>{t("settings.browseTitle")}</h2>
                  <p>{t("settings.browseDescription")}</p>
                  <label className="setting-field">
                    {t("settings.defaultLibraryView")}
                    <OptionSelect
                      label={t("settings.defaultLibraryView")}
                      value={viewMode}
                      options={viewModes.map(({ id, label }) => ({ id, label: t(label) }))}
                      onChange={(value) => setViewMode(value as ViewMode)}
                    />
                  </label>
                  <label className="setting-field">
                    {t("preview.size")}
                    <SettingSlider
                      label={t("preview.size")}
                      minValue={previewSizeRange.min}
                      maxValue={previewSizeRange.max}
                      value={previewSize}
                      onChange={setPreviewSize}
                      onChangeStart={previewAppearance.begin}
                      onChangeEnd={previewAppearance.commit}
                    />
                    <output>{previewSize}px</output>
                  </label>
                  <BlurSettingsPreview
                    items={fileMenuItems}
                    value={sidebarBlur}
                    onChange={updateSidebarBlur}
                  />
                </section>
              </>
            ) : settingsPage === "font-cards" ? (
              <>
                <section className="settings-group">
                  <h2>{t("settings.cardsTitle")}</h2>
                  <p>{t("settings.cardsDescription")}</p>
                  <Switch
                    className="setting-toggle"
                    isSelected={cardHover}
                    onChange={setCardHover}
                  >
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                      {t("cards.selectOnHover")}
                    </Switch.Content>
                  </Switch>
                  <label className="setting-field">
                    {t("cards.hoverDelay")}
                    <SettingSlider
                      label={t("cards.hoverDelay")}
                      minValue={0}
                      maxValue={1000}
                      step={10}
                      unit={` ${t("common.milliseconds")}`}
                      isDisabled={!cardHover}
                      value={cardHoverDelay}
                      onChange={setCardHoverDelay}
                    />
                    <output>{cardHoverDelay} {t("common.milliseconds")}</output>
                  </label>
                  <p className="settings-note">{t("cards.hoverDelayNote", { delay: 180 })}</p>
                  <label className="setting-field">
                    {t("cards.scrollSpeed")}
                    <SettingSlider
                      label={t("cards.scrollSpeed")}
                      minValue={0.5}
                      maxValue={2}
                      step={0.05}
                      unit="×"
                      value={expandedCardWheelSpeed}
                      onChange={(value) => setExpandedCardWheelSpeed(parseExpandedCardWheelSpeed(String(value)))}
                    />
                    <output>{expandedCardWheelSpeed.toFixed(2)}×</output>
                  </label>
                  <Switch
                    className="setting-toggle"
                    isSelected={cardMetadata}
                    onChange={setCardMetadata}
                  >
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                      {t("settings.showCardMetadata")}
                    </Switch.Content>
                  </Switch>
                </section>
              </>
            ) : settingsPage === "shortcuts" ? (
              <>
                <p>{t("settings.shortcutsDescription")}</p>
                <label className="setting-field">
                  {t("desktop.quitApp")}
                  <OptionSelect
                    label={t("desktop.quitShortcut")}
                    value={quitShortcut}
                    options={quitShortcutOptions}
                    onChange={(value) => setQuitShortcut(parseQuitShortcut(value))}
                  />
                </label>
              </>
            ) : settingsPage === "importing" ? (
              <>
                <p>{t("import.chooseMode")}</p>
                <label className="setting-field">
                  {t("import.mode")}
                  <OptionSelect
                    label={t("import.mode")}
                    value={importMode}
                    options={[
                      { id: "copy", label: t("import.copyToLibrary") },
                      { id: "reference", label: t("import.referenceOriginal") },
                    ]}
                    onChange={setImportMode}
                  />
                </label>
                <p className="settings-note">{t("settings.importDescription")}</p>
              </>
            ) : settingsPage === "cloud" ? (
              <>
                <p className="settings-description">{t("settings.cloudDescription")}</p>
                <section className="settings-group sync-connection-settings">
                  <h2>{t("cloud.connection")}</h2>
                  <div className="setting-field">
                    <span>{t("cloud.provider")}</span>
                    <div className="setting-choice-row setting-preset-row">
                      {webdavPresets.map((preset) => (
                        <Button
                          key={preset.id}
                          size="sm"
                          className="h-8"
                          variant={
                            matchingWebdavPreset(syncServerUrl) === preset.id
                              ? "primary"
                              : "secondary"
                          }
                          onPress={() => setSyncServerUrl(preset.url ?? "")}
                        >
                          {t(preset.label)}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <TextField className="setting-field">
                    <Label>{t("cloud.serverURL")}</Label>
                    <Input
                      type="url"
                      autoComplete="url"
                      placeholder="https://"
                      value={syncServerUrl}
                      onChange={(event) => setSyncServerUrl(event.target.value)}
                    />
                  </TextField>
                  <TextField className="setting-field">
                    <Label>{t("cloud.remoteDirectory")}</Label>
                    <Input
                      value={syncDirectory}
                      onChange={(event) => setSyncDirectory(event.target.value)}
                    />
                  </TextField>
                  <TextField className="setting-field">
                    <Label>{t("cloud.username")}</Label>
                    <Input
                      autoComplete="username"
                      value={syncUsername}
                      onChange={(event) => setSyncUsername(event.target.value)}
                    />
                  </TextField>
                  <TextField className="setting-field">
                    <Label>{t("cloud.password")}</Label>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      value={syncPassword}
                      onChange={(event) => setSyncPassword(event.target.value)}
                      placeholder={
                        syncProfile ? t("cloud.passwordStored") : t("cloud.password")
                      }
                    />
                  </TextField>
                  <Switch
                    className="setting-toggle"
                    isSelected={syncAutomatic}
                    onChange={setSyncAutomatic}
                  >
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                      {t("cloud.autoSync")}
                    </Switch.Content>
                  </Switch>
                  <div className="setting-actions">
                    <Button
                      size="sm"
                      className="h-8"
                      variant="secondary"
                      onPress={() => void testCloudConnection()}
                    >
                      {t("cloud.testConnection")}
                    </Button>
                    <Button
                      size="sm"
                      className="h-8"
                      onPress={() => void saveCloudConnection()}
                      isDisabled={!syncPassword}
                    >
                      {t("common.save")}
                    </Button>
                  </div>
                </section>
                <section className="settings-group sync-management-settings">
                  <h2>{t("cloud.syncStatus")}</h2>
                  {syncStatus && (
                    <div
                      className={`sync-status${syncStatus.error ? " has-error" : ""}`}
                      role="status"
                    >
                      <div className="sync-status-row">
                        {syncStatus.running && (
                          <RingSyncProgress
                            progress={syncStatus.percent / 100}
                            size={14}
                          />
                        )}
                        <strong>
                          {syncStatus.configured
                            ? syncStatus.running
                              ? t("cloud.syncingPercent", { percent: syncStatus.percent })
                              : t("cloud.connectedStatus")
                            : t("cloud.notConnected")}
                        </strong>
                      </div>
                      <span>{syncStatus.error ?? syncStatus.phase}</span>
                      {syncStatus.running && (
                        <span className="sync-progress-detail">
                          {describeSyncStage(syncStatus)}
                        </span>
                      )}
                    </div>
                  )}
                  {syncMessage && (
                    <p className="settings-note" role="status">
                      {syncMessage}
                    </p>
                  )}
                  {syncStatus?.configured && (
                    <div className="setting-actions">
                      <Button
                        size="sm"
                        className="h-8"
                        onPress={() => void startCloudSync()}
                        isDisabled={syncStatus.running}
                      >
                        {syncStatus.running ? t("cloud.syncing") : t("cloud.syncNow")}
                      </Button>
                      {syncStatus.running && (
                        <Button
                          size="sm"
                          className="h-8"
                          variant="secondary"
                          onPress={() =>
                            void cancelSync().catch((cause) =>
                              setSyncMessage(errorMessage(cause)),
                            )
                          }
                        >
                          {t("cloud.cancelSync")}
                        </Button>
                      )}
                      {!syncStatus.running && (
                        <Button
                          size="sm"
                          className="h-8"
                          variant="tertiary"
                          onPress={() => void disconnectCloud()}
                        >
                          {t("cloud.disconnect")}
                        </Button>
                      )}
                    </div>
                  )}
                  <h2 className="settings-subheading">{t("cloud.cloudFiles")}</h2>
                  {cloudFonts.length ? (
                    <div className="sync-font-list">
                      {cloudFonts.map((font) => (
                        <div key={font.fingerprint}>
                          <strong>{font.displayName}</strong>
                          <span>
                            {font.deleted
                              ? t("desktop.deleted")
                              : font.cloudOnly
                                ? t("cloud.cloudOnly")
                                : t("cloud.syncedTo")}{" "}
                            · {formatFileSize(font.fileSize)}
                          </span>
                          {(font.deleted || font.cloudOnly) && (
                            <Button
                              size="sm"
                              className="h-8"
                              variant="secondary"
                              isDisabled={syncStatus?.running}
                              onPress={() => void restoreCloudCopy(font)}
                            >
                              {font.deleted ? t("cloud.restore") : t("cloud.download")}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="settings-note">{t("cloud.empty")}</p>
                  )}
                  <h2 className="settings-subheading">{t("cloud.conflicts")}</h2>
                  {syncConflicts.length ? (
                    <div className="sync-conflict-list">
                      {syncConflicts.map((conflict) => (
                        <section key={conflict.id}>
                          <strong>{conflict.title}</strong>
                          <p>{conflict.detail}</p>
                          <div className="setting-actions">
                            <Button
                              size="sm"
                              className="h-8"
                              variant="secondary"
                              onPress={() =>
                                void applySyncConflict(conflict.id, "keepBoth")
                              }
                            >
                              {t("cloud.keepBoth")}
                            </Button>
                            <Button
                              size="sm"
                              className="h-8"
                              variant="secondary"
                              onPress={() =>
                                void applySyncConflict(conflict.id, "useLocal")
                              }
                            >
                              {t("cloud.useLocal")}
                            </Button>
                            <Button
                              size="sm"
                              className="h-8"
                              variant="secondary"
                              onPress={() =>
                                void applySyncConflict(conflict.id, "useRemote")
                              }
                            >
                              {t("cloud.useRemote")}
                            </Button>
                          </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <p className="settings-note">{t("cloud.noPendingConflicts")}</p>
                )}
                </section>
              </>
            ) : (
              <p>{t("macos.aboutSubtitle")}</p>
            )}
          </article>
        </section>
      ) : (
        <div
          className={`workspace${resizingSidebar ? " is-resizing" : ""}${snapClosingSidebar ? " is-snap-closing" : ""}`}
          ref={workspaceRef}
          style={
            {
              "--left-pane-width": `${leftPaneWidth}px`,
              "--right-pane-width": `${rightPaneWidth}px`,
              "--left-content-width": `${leftSidebarVisible ? leftPaneWidth : preferredLeftWidth}px`,
              "--right-content-width": `${rightSidebarVisible ? rightPaneWidth : preferredRightWidth}px`,
            } as React.CSSProperties
          }
        >
          <aside
            id="left-sidebar"
            className="sidebar"
            aria-label={t("desktop.leftSidebar")}
            aria-hidden={!leftSidebarVisible}
            inert={!leftSidebarVisible}
            data-open={leftSidebarVisible}
          >
            <div className="sidebar-inner">
              <div
                className="sidebar-pages"
                role="tablist"
                aria-label={t("desktop.sidebarPage")}
              >
                <button
                  type="button"
                  className="sidebar-page"
                  role="tab"
                  aria-selected={sidebarPage === "navigation"}
                  onClick={() => setSidebarPage("navigation")}
                >
                  <span className="sidebar-page-label">{t("navigation.navigation")}</span>
                  <span className="sidebar-page-dot" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="sidebar-page"
                  role="tab"
                  aria-selected={sidebarPage === "filters"}
                  onClick={() => setSidebarPage("filters")}
                >
                  <span className="sidebar-page-dot" aria-hidden="true" />
                  <span className="sidebar-page-label">{t("navigation.filters")}</span>
                </button>
              </div>
              <div className="sidebar-scroll">
                {sidebarPage === "navigation" ? (
                  <>
                    <div className="sidebar-section-label">{t("navigation.local")}</div>
                    <SidebarItem
                      className={`sidebar-link${scope === "all" ? " selected" : ""}`}
                      onClick={() => selectLibraryScope("all")}
                    >
                      <AnimatedIcon name="text-aa" />
                      {t("navigation.allFonts")}{snapshot && <span>{snapshot.familyCount}</span>}
                    </SidebarItem>
                    <SidebarItem
                      className={`sidebar-link${scope === "recent" ? " selected" : ""}`}
                      onClick={() => selectLibraryScope("recent")}
                    >
                      <AnimatedIcon name="clock-counter-clockwise" />
                      {t("navigation.recent")}
                    </SidebarItem>
                    <SidebarItem
                      className={`sidebar-link${scope === "favorites" ? " selected" : ""}`}
                      onClick={() => selectLibraryScope("favorites")}
                    >
                      <AnimatedIcon name="star" />
                      {t("navigation.favorites")}
                    </SidebarItem>
                    <div className="sidebar-section-label sidebar-section-heading">
                      {t("navigation.collections")}
                    </div>
                    <div className="collection-list">
                      {smartFolders.map((folder) => {
                        const iconName = collectionIconName(folder.icon);
                        return (
                          <SidebarItem
                            key={folder.id}
                            className={`sidebar-link sidebar-folder${scope === "smartFolder" && smartFolderId === folder.id ? " selected" : ""}`}
                            onClick={() => openSmartFolder(folder)}
                            onContextMenu={(event) =>
                              openFolderContextMenu(event, {
                                kind: "editSmartFolder",
                                folder,
                              })
                            }
                          >
                            <span
                              className="sidebar-link-icon"
                              style={{
                                color: collectionColorValue(folder.color),
                              }}
                            >
                              <AnimatedIcon name={iconName} />
                            </span>
                            <span className="sidebar-folder-name">
                              {folder.name}
                            </span>
                            <span
                              className="sidebar-folder-trailing"
                              aria-hidden="true"
                            >
                              <SparkleIcon />
                            </span>
                            <span>{folder.matchCount}</span>
                          </SidebarItem>
                        );
                      })}
                      {collections.map((collection) => {
                        const iconName = collectionIconName(collection.icon);
                        return (
                          <SidebarItem
                            key={collection.id}
                            className={`sidebar-link sidebar-folder${scope === "collection" && collectionId === collection.id ? " selected" : ""}`}
                            onClick={() => selectCollection(collection.id)}
                            onContextMenu={(event) =>
                              openFolderContextMenu(event, {
                                kind: "editCollection",
                                collection,
                              })
                            }
                          >
                            <span
                              className="sidebar-link-icon"
                              style={{
                                color: collectionColorValue(collection.color),
                              }}
                            >
                              <AnimatedIcon name={iconName} />
                            </span>
                            <span className="sidebar-folder-name">
                              {collection.name}
                            </span>
                            <span>{collection.memberCount}</span>
                          </SidebarItem>
                        );
                      })}
                    </div>
                    <SidebarItem
                      className="sidebar-new-folder"
                      onClick={beginFavoriteFolderCreation}
                    >
                      <AnimatedIcon name="plus" />
                      {t("collection.new")}
                    </SidebarItem>
                    {organizationError && !favoriteEditor && (
                      <p className="sidebar-error" role="alert">
                        {organizationError}
                      </p>
                    )}
                    <div className="sidebar-section-label sidebar-section-heading">
                      {t("navigation.cloud")}
                    </div>
                    {syncProfile ? (
                      <SidebarItem
                        className={`sidebar-cloud${scope === "cloudFonts" ? " selected" : ""}`}
                        onClick={() => selectLibraryScope("cloudFonts")}
                      >
                        <span className="sidebar-cloud-icon" aria-hidden="true">
                          <AnimatedIcon name="hard-drives" />
                        </span>
                        <span className="sidebar-cloud-text">
                          <span className="sidebar-cloud-name">
                            {cloudConnectionName(syncProfile)}
                          </span>
                          <span className="sidebar-cloud-detail">
                            {t("cloud.fontUsage", { size: cloudFontStorage })}
                          </span>
                        </span>
                        <span className="sidebar-cloud-count">
                          {activeCloudFonts.length}
                        </span>
                      </SidebarItem>
                    ) : (
                      <p className="sidebar-empty">{t("cloud.notConnected")}</p>
                    )}
                    <div className="sidebar-section-label sidebar-section-heading">
                      {t("navigation.fontState")}
                    </div>
                    {fontStateOptionsFor(snapshot).map((option) => {
                      return (
                        <SidebarItem
                          key={option.id}
                          className={`sidebar-link${scope === "fontState" && fontState === option.id ? " selected" : ""}`}
                          title={option.help}
                          onClick={() => selectFontState(option.id)}
                        >
                          <AnimatedIcon name={option.animatedName} />
                          {option.label}
                          <span>
                            {snapshot?.fontStateCounts[option.id] ?? 0}
                          </span>
                        </SidebarItem>
                      );
                    })}
                    <div className="sidebar-section-label sidebar-section-heading">
                      {t("navigation.tools")}
                    </div>
                    <SidebarItem
                      className="sidebar-link sidebar-link-disabled"
                      disabled
                      title={t("online.comingSoon")}
                    >
                      <AnimatedIcon name="globe" />
                      {t("navigation.onlineFonts")}
                    </SidebarItem>
                    <SidebarItem
                      className={`sidebar-link${scope === "fontHealth" ? " selected" : ""}`}
                      onClick={() => selectLibraryScope("fontHealth")}
                    >
                      <AnimatedIcon name="stethoscope" />
                      {t("navigation.fontHealth")}
                      <span>{healthCount}</span>
                    </SidebarItem>
                  </>
                ) : (
                  <>
                    <div className="sidebar-section-label">{t("navigation.filters")}</div>
                    {page?.facets.length ? (
                      <div className="facet-groups">
                        {facetGroups(page.facets).map(([kind, options]) => (
                          <FacetGroup
                            key={kind}
                            title={facetGroupTitle(kind)}
                            options={options}
                            selected={selectedFacets[kind] ?? []}
                            defaultOpen={kind === "categories" || kind === "scripts"}
                            onToggle={(value) =>
                              setSelectedFacets((current) =>
                                toggleFacet(current, kind, value),
                              )
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="sidebar-empty">
                        {t("filters.empty")}
                      </p>
                    )}
                  </>
                )}
              </div>
              <div className="sidebar-status">
                <CloudStatusPanel
                  status={syncStatus}
                  connected={syncProfile !== null}
                  onSync={() => void startCloudSync()}
                  onOpenSettings={() => void openSettings()}
                />
              </div>
            </div>
          </aside>
          <SidebarResizeHandle
            side="left"
            width={leftPaneWidth}
            collapsed={!leftSidebarVisible}
            reopenWidth={leftMinimumWidth}
            max={maximumSidebarWidth("left")}
            onResize={resizeSidebar}
            onPointerResize={resizeFromPointer}
            onPointerCommit={finishPointerResize}
            onPointerCancel={() => setDragPreview(null)}
            onDragChange={(dragging) =>
              setResizingSidebar(dragging ? "left" : null)
            }
          />

          <section className="library-pane">
            {scope === "cloudFonts" ? (
              <CloudFontsPane
                fonts={cloudFonts}
                connected={syncProfile !== null}
                status={syncStatus}
                onSync={() => void startCloudSync()}
                onRestore={(font) => void restoreCloudCopy(font)}
                onOpenSettings={() => void openSettings()}
              />
            ) : (
              <>
            <VirtualFontGrid
              key={JSON.stringify([search, scope, sort, selectedFacets, collectionId, smartFolderId, fontState])}
              families={error ? [] : page?.families ?? []} total={page?.totalMatches ?? 0}
              isLoading={loading} onLoadMore={loadMore} onRequestRange={requestCarouselRange}
              mode={viewMode} previewText={previewText} previewSize={previewAppearance.committed.size}
              textColor={previewAppearance.committed.textColor} backgroundColor={previewAppearance.committed.backgroundColor}
              editingPreview={previewAppearance.editing}
              styleKey={selectedStyleKey} selectedId={selected?.id} onStyleChange={setSelectedStyleKey}
              showMetadata={cardMetadata} selectOnHover={cardHover} hoverDelay={cardHoverDelay}
              wheelSpeed={expandedCardWheelSpeed}
              onSelect={selectFamily} onPreviewSelect={previewSelectFamily} onFavorite={favoriteFamily}
              header={
                <div className="library-overview">
                  <div className="library-title-row">
                    <LibraryHero
                      presentation={scope === "all" ? libraryHero : {
                        kind: "normal", title: currentScopeTitle,
                        subtitle: page ? t("library.familyCountLabel", { total: page.totalMatches }) : t("common.loadingLibrary"),
                        sync: libraryHero.sync,
                      }}
                      onAction={handleHeroAction}
                    />
                    <div className="sort-button">
                      <span>{t("library.sortBy")}</span>
                      <OptionSelect
                        label={t("library.sortBy")}
                        value={sort}
                        options={[
                          { id: "name", label: t("library.name") },
                          { id: "recent", label: t("navigation.recent") },
                          { id: "relevance", label: t("library.relevance") },
                        ]}
                        onChange={setSort}
                      />
                    </div>
                  </div>
                </div>
              }
              emptyState={error ? (
                <div className="state-message error-state">
                  <h2>{t("library.loadFailed")}</h2>
                  <p>{error}</p>
                  <Button onPress={() => void runRefresh()}>{t("common.retry")}</Button>
                </div>
              ) : loading ? (
                <div className="state-message">
                  <div className="loading-indicator" />
                  <p>{t("common.loadingLibrary")}</p>
                </div>
              ) : (
                <div className="state-message empty-state">
                  <div className="empty-icon">
                    <TextAaIcon />
                  </div>
                  <h2>{search ? t("common.noMatch") : t("library.emptyTitle")}</h2>
                  <p>
                    {search
                      ? t("library.emptySearchHint")
                      : t("library.emptyAddFolder")}
                  </p>
                  {!search && (
                    <Button onPress={() => void chooseFolder()}>
                      <FolderPlusIcon />
                      {t("import.addFontFolder")}
                    </Button>
                  )}
                </div>
              )}
            />
            <footer className="preview-bar">
              <span className="sr-only" role="status">{recentError}</span>
              <PreviewPresetMenu
                value={previewTextMode}
                onChange={(mode, text) => {
                  setPreviewTextMode(mode);
                  if (text !== undefined) setPreviewText(text);
                }}
              />
              <TextField
                className="preview-text-field"
                aria-label={t("preview.customText")}
              >
                <Input
                  aria-label={t("preview.customText")}
                  className="preview-text-input"
                  value={previewText}
                  onChange={(event) => {
                    setPreviewText(event.target.value);
                    setPreviewTextMode("custom");
                  }}
                />
              </TextField>
              <TextAaIcon className="preview-size-icon" aria-hidden="true" />
              <PreviewSizeSlider
                value={previewSize}
                onChange={setPreviewSize}
                onChangeStart={previewAppearance.begin}
                onChangeEnd={previewAppearance.commit}
              />
              <output className="preview-size-value" aria-label={t("preview.sizeValue", { size: previewSize })}>
                {previewSize < 100 && <span className="preview-size-padding" aria-hidden="true">0</span>}
                <Scritto value={previewSize} respectMotionPreference aria-hidden="true" />
                <span aria-hidden="true">px</span>
              </output>
              <span className="preview-color-divider" aria-hidden="true" />
              <PreviewColorPicker kind="background" value={previewAppearance.current.backgroundColor}
                onChange={(backgroundColor) => previewAppearance.update({ backgroundColor })}
                onEditingStart={previewAppearance.begin} onEditingEnd={previewAppearance.commit} />
              <PreviewColorPicker kind="text" value={previewAppearance.current.textColor}
                onChange={(textColor) => previewAppearance.update({ textColor })}
                onEditingStart={previewAppearance.begin} onEditingEnd={previewAppearance.commit} />
            </footer>
              </>
            )}
          </section>
          <SidebarResizeHandle
            side="right"
            width={rightPaneWidth}
            collapsed={!rightSidebarVisible}
            reopenWidth={rightMinimumWidth}
            max={maximumSidebarWidth("right")}
            onResize={resizeSidebar}
            onPointerResize={resizeFromPointer}
            onPointerCommit={finishPointerResize}
            onPointerCancel={() => setDragPreview(null)}
            onDragChange={(dragging) =>
              setResizingSidebar(dragging ? "right" : null)
            }
          />
          <aside
            id="right-sidebar"
            className="inspector-rail"
            aria-label={t("desktop.rightInspector")}
            aria-hidden={!rightSidebarVisible}
            inert={!rightSidebarVisible}
            data-open={rightSidebarVisible}
          >
            <div className="inspector-inner">
              {selected ? (
                <Inspector
                  family={selected}
                  styleKey={selectedStyleKey}
                  previewText={previewText}
                  previewSize={inspectorAppearance.size}
                  textColor={inspectorAppearance.textColor}
                  backgroundColor={inspectorAppearance.backgroundColor}
                  collections={collections}
                  collectionTargetId={collectionTargetId}
                  onCollectionTargetChange={setCollectionTargetId}
                  onCollectionMembershipChange={
                    updateSelectedCollectionMembership
                  }
                  onClose={() => setRightSidebarOpen(false)}
                />
              ) : (
                <div className="inspector-empty">
                  <TextAaIcon />
                  <strong>{t("inspector.title")}</strong>
                  <p>{t("inspector.selectFamilyHint")}</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {!settingsWindow && folderContextMenu && (
        <FolderContextMenu
          menu={folderContextMenu}
          onEdit={() => {
            const intent = folderContextMenu.intent;
            setFolderContextMenu(null);
            beginFavoriteFolderEditing(intent);
          }}
          onDelete={() => {
            const intent = folderContextMenu.intent;
            setFolderContextMenu(null);
            if (intent.kind === "editCollection") {
              void removeCollection(intent.collection);
            } else if (intent.kind === "editSmartFolder") {
              void removeSmartFolder(intent.folder);
            }
          }}
        />
      )}

      {!settingsWindow && favoriteEditor && (
        <FavoriteFolderEditor
          key={favoriteFolderEditorKey(favoriteEditor)}
          intent={favoriteEditor}
          seed={favoriteFolderSeed}
          facetOptions={page?.facets ?? []}
          error={organizationError}
          onClose={closeFavoriteFolderEditor}
          onSave={saveFavoriteFolder}
        />
      )}

      {settingsWindow && confirmRebuild && (
        <Modal isOpen onOpenChange={(open) => { if (!open) setConfirmRebuild(false); }}>
          <Modal.Backdrop className="storage-confirm-backdrop">
            <Modal.Container placement="center" className="storage-confirm-container">
              <Modal.Dialog className="storage-confirm-dialog" aria-label={t("storage.rebuildIndex")}>
                <h2>{t("settings.rebuildTitle")}</h2>
                <p>{t("settings.rebuildMessage")}</p>
                <div className="setting-actions">
                  <Button variant="secondary" onPress={() => setConfirmRebuild(false)}>{t("common.cancel")}</Button>
                  <Button onPress={() => void rebuildStoredSyncIndexes()}>{t("common.rebuild")}</Button>
                </div>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      )}
    </main>
  );
}

function FolderContextMenu({
  menu,
  onEdit,
  onDelete,
}: {
  menu: FolderContextMenuState;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="menu-popover context-menu"
      role="menu"
      aria-label={t("desktop.collectionActions")}
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <MenuItem
        item={{ label: t("collection.editEllipsis"), Icon: PencilSimpleIcon, action: onEdit }}
        onSelect={() => onEdit()}
      />
      <div className="menu-separator" role="separator" />
      <MenuItem
        item={{
          label: t("collection.delete"),
          Icon: TrashIcon,
          action: onDelete,
          danger: true,
        }}
        onSelect={() => onDelete()}
      />
    </div>
  );
}

function FavoriteFolderEditor({
  intent,
  seed,
  facetOptions,
  error,
  onClose,
  onSave,
}: {
  intent: FavoriteFolderIntent;
  seed: FavoriteFolderDraft;
  facetOptions: FacetOptionDto[];
  error: string | null;
  onClose: () => void;
  onSave: (draft: FavoriteFolderDraft) => void;
}) {
  const { t } = useTranslation();
  const isCreate = intent.kind === "create";
  const [tab, setTab] = useState<"general" | "filters">("general");
  const [name, setName] = useState(seed.name);
  const [text, setText] = useState(seed.text);
  const [facets, setFacets] = useState<Record<string, string[]>>(seed.facets);
  const [icon, setIcon] = useState(seed.icon);
  const [color, setColor] = useState(seed.color);
  const groups = facetGroups(facetOptions);
  const selectedColorLabel =
    collectionColorOptions.find((option) => option.id === color)?.label ?? "color.gray";

  const submit = () => {
    onSave({ name, text, facets, icon, color });
  };

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop className="favorite-editor-backdrop">
        <Modal.Container
          placement="center"
          className="favorite-editor-container"
        >
          <Modal.Dialog
            className="favorite-editor-dialog"
            aria-label={isCreate ? t("collection.new") : t("collection.edit")}
          >
            <div
              className="favorite-editor-tabs"
              role="tablist"
              aria-label={t("collection.settings")}
            >
              <button
                role="tab"
                aria-selected={tab === "general"}
                onClick={() => setTab("general")}
              >
                {t("collection.general")}
              </button>
              <button
                role="tab"
                aria-selected={tab === "filters"}
                onClick={() => setTab("filters")}
              >
                {t("filters.conditions")}
              </button>
            </div>

            <div className="favorite-editor-body">
              {tab === "general" ? (
                <div className="favorite-editor-page">
                  <TextField
                    className="favorite-editor-name"
                    aria-label={t("collection.name")}
                  >
                    <Input
                      autoFocus
                      aria-label={t("collection.name")}
                      placeholder={t("collection.namePlaceholder")}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </TextField>
                  <div className="favorite-editor-label">{t("common.icon")}</div>
                  <div className="favorite-icon-grid">
                    {collectionIconOptions.map((option) => {
                      const selected = icon === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`favorite-icon-option${selected ? " selected" : ""}`}
                          aria-label={t(option.label)}
                          aria-pressed={selected}
                          title={t(option.label)}
                          onClick={() => setIcon(option.id)}
                        >
                          <AnimatedIcon name={option.animatedName} />
                        </button>
                      );
                    })}
                  </div>
                  <div className="favorite-editor-label-row">
                    <span className="favorite-editor-label">{t("common.color")}</span>
                    <span className="favorite-editor-color-name">
                      {t(selectedColorLabel)}
                    </span>
                  </div>
                  <div className="favorite-color-row">
                    {collectionColorOptions.map((option) => {
                      const selected = color === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`favorite-color-option${selected ? " selected" : ""}`}
                          style={{ background: option.value }}
                          aria-label={t(option.label)}
                          aria-pressed={selected}
                          title={t(option.label)}
                          onClick={() => setColor(option.id)}
                        />
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="favorite-editor-page">
                  <div className="favorite-editor-field-heading">
                    <span className="favorite-editor-label">{t("library.searchFonts")}</span>
                    <p className="favorite-editor-hint">
                      {t("library.searchHint")}
                    </p>
                  </div>
                  <TextField
                    className="favorite-editor-search"
                    aria-label={t("filters.keyword")}
                  >
                    <Input
                      aria-label={t("filters.keyword")}
                      placeholder={t("filters.inputKeyword")}
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                    />
                  </TextField>
                  <div className="favorite-editor-field-heading">
                    <span className="favorite-editor-label">{t("filters.conditions")}</span>
                    <p className="favorite-editor-hint">
                      {t("filters.smartHint")}
                    </p>
                  </div>
                  {groups.length ? (
                    <div className="facet-groups">
                      {groups.map(([kind, options]) => (
                        <FacetGroup
                          key={kind}
                          title={facetGroupTitle(kind)}
                          options={options}
                          selected={facets[kind] ?? []}
                          defaultOpen={kind === "categories" || kind === "scripts"}
                          onToggle={(value) =>
                            setFacets((current) =>
                              toggleFacet(current, kind, value),
                            )
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="sidebar-empty">
                      {t("filters.empty")}
                    </p>
                  )}
                </div>
              )}
            </div>

            {error && (
              <p className="favorite-editor-error" role="alert">
                {error}
              </p>
            )}

            <div className="favorite-editor-footer">
              <Button variant="tertiary" onPress={onClose}>
                {t("common.cancel")}
              </Button>
              <Button onPress={submit} isDisabled={!name.trim()}>
                {isCreate ? t("common.create") : t("common.save")}
              </Button>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function describeSyncStage(status: SyncStatusDto | null): string {
  if (!status) return "";
  const parts = [`${status.stage} ${status.stageCompleted}/${status.stageTotal}`];
  if (status.uploadedFiles > 0) parts.push(i18n.t("cloud.uploadedCount", { count: status.uploadedFiles }));
  if (status.downloadedFiles > 0) parts.push(i18n.t("cloud.downloadedCount", { count: status.downloadedFiles }));
  return parts.join(" · ");
}

function describeSyncItem(item: SyncItemDto): string {
  const action = item.action === "download" ? i18n.t("cloud.download") : i18n.t("cloud.upload");
  switch (item.status) {
    case "running":
      return i18n.t("cloud.running", { action });
    case "done":
      return i18n.t("cloud.completed", { action });
    default:
      return i18n.t("cloud.waiting", { action });
  }
}

function RingSyncProgress({
  progress,
  size = 16,
  lineWidth = 2,
}: {
  progress: number;
  size?: number;
  lineWidth?: number;
}) {
  const clamped = Math.min(Math.max(progress, 0), 1);
  const radius = (size - lineWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      className="sync-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <circle
        className="sync-ring-track"
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={lineWidth}
      />
      <circle
        className="sync-ring-arc"
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={lineWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped)}
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  );
}

function CloudStatusPanel({
  status,
  connected,
  onSync,
  onOpenSettings,
}: {
  status: SyncStatusDto | null;
  connected: boolean;
  onSync: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  if (!connected) {
    return (
      <div className="sidebar-status-card">
        <CloudIcon aria-hidden="true" />
        <span className="sidebar-status-text">
          <strong>{t("cloud.notConnected")}</strong>
          <button type="button" onClick={onOpenSettings}>
            {t("cloud.connectInSettings")}
          </button>
        </span>
      </div>
    );
  }
  const running = status?.running ?? false;
  const error = status?.error ?? null;
  const percent = status?.percent ?? 0;
  return (
    <div className={`sidebar-status-card${error ? " has-error" : ""}`}>
      {running ? (
        <RingSyncProgress progress={percent / 100} size={16} />
      ) : error ? (
        <WarningIcon aria-hidden="true" />
      ) : (
        <CloudCheckIcon aria-hidden="true" />
      )}
      <span className="sidebar-status-text">
        <strong>
          {running
            ? t("cloud.syncingPercent", { percent })
            : error
              ? t("cloud.syncIncomplete")
              : t("cloud.allSynced")}
        </strong>
        {running ? (
          <span className="sync-progress-detail">
            {describeSyncStage(status)}
          </span>
        ) : (
          <button type="button" onClick={onSync}>
            {t("cloud.syncNow")} ›
          </button>
        )}
      </span>
    </div>
  );
}

function CloudFontsPane({
  fonts,
  connected,
  status,
  onSync,
  onRestore,
  onOpenSettings,
}: {
  fonts: CloudFontDto[];
  connected: boolean;
  status: SyncStatusDto | null;
  onSync: () => void;
  onRestore: (font: CloudFontDto) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  if (!connected) {
    return (
      <div className="state-message empty-state">
        <div className="empty-icon">
          <CloudIcon />
        </div>
        <h2>{t("cloud.notConnected")}</h2>
        <p>{t("cloud.connectInSettingsHint")}</p>
        <Button onPress={onOpenSettings}>
          <GearSixIcon />
          {t("common.openSettings")}
        </Button>
      </div>
    );
  }
  const active = fonts.filter((font) => !font.deleted);
  const running = status?.running ?? false;
  return (
    <div className="cloud-pane">
      <header className="cloud-pane-header">
        <div>
          <h1>{t("cloud.cloudFiles")}</h1>
          <p>
            {t("cloud.fileCount", { count: active.length })} ·{" "}
            {running ? t("cloud.syncing") : (status?.phase ?? t("cloud.connectedStatus"))}
          </p>
        </div>
        <Button onPress={onSync} isDisabled={running}>
          {running ? t("cloud.syncing") : t("cloud.syncNow")}
        </Button>
      </header>
      {active.length ? (
        <ul className="cloud-font-list">
          {active.map((font) => {
            const item = status?.items.find(
              (entry) => entry.fingerprint === font.fingerprint,
            );
            return (
              <li key={font.fingerprint}>
                <span className="cloud-font-name">{font.displayName}</span>
                <span className="cloud-font-meta">
                  {item ? (
                    <span className={`cloud-font-sync ${item.status}`}>
                      {describeSyncItem(item)}
                    </span>
                  ) : (
                    <span>{font.cloudOnly ? t("cloud.cloudOnly") : t("cloud.syncedTo")}</span>
                  )}{" "}
                  · {formatFileSize(font.fileSize)}
                </span>
                {font.cloudOnly && (
                  <Button
                    size="sm"
                    variant="secondary"
                    isDisabled={running}
                    onPress={() => onRestore(font)}
                  >
                    {t("cloud.download")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="state-message empty-state">
          <div className="empty-icon">
            <CloudIcon />
          </div>
          <h2>{t("cloud.empty")}</h2>
          <p>{t("cloud.emptyHint")}</p>
        </div>
      )}
    </div>
  );
}

function SidebarResizeHandle({
  side,
  width,
  collapsed,
  reopenWidth,
  max,
  onResize,
  onPointerResize,
  onPointerCommit,
  onPointerCancel,
  onDragChange,
}: {
  side: "left" | "right";
  width: number;
  collapsed: boolean;
  reopenWidth: number;
  max: number;
  onResize: (side: "left" | "right", width: number) => void;
  onPointerResize: (side: "left" | "right", clientX: number) => void;
  onPointerCommit: (side: "left" | "right", clientX: number) => void;
  onPointerCancel: () => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const { t } = useTranslation();
  const draggingRef = useRef(false);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onDragChange(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      onPointerResize(side, event.clientX);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    onPointerCommit(side, event.clientX);
    onDragChange(false);
  };
  const cancelPointerResize = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    onPointerCancel();
    onDragChange(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = max;
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const inward = direction * (side === "left" ? 1 : -1) > 0;
      if (collapsed && !inward) return;
      next = collapsed
        ? reopenWidth
        : width + direction * (side === "left" ? 1 : -1) * (event.shiftKey ? 20 : 10);
    } else return;
    event.preventDefault();
    onResize(side, next);
  };

  return (
    <div
      className={`sidebar-resizer sidebar-resizer-${side}`}
      data-collapsed={collapsed}
      role="separator"
      aria-label={t("desktop.sidebarResize", { action: collapsed ? t("desktop.expand") : t("desktop.adjust"), side: side === "left" ? t("desktop.leftSide") : t("desktop.rightSide"), size: collapsed ? "" : t("desktop.width") })}
      aria-controls={`${side}-sidebar`}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={width}
      aria-valuetext={collapsed ? t("desktop.sidebarCollapsedHint") : t("common.widthPixels", { width })}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancelPointerResize}
      onLostPointerCapture={cancelPointerResize}
      onKeyDown={onKeyDown}
    />
  );
}

function Inspector({
  family,
  styleKey,
  previewText,
  previewSize,
  textColor,
  backgroundColor,
  collections,
  collectionTargetId,
  onCollectionTargetChange,
  onCollectionMembershipChange,
  onClose,
}: {
  family: FamilyDto;
  styleKey: string | null;
  previewText: string;
  previewSize: number;
  textColor: string | null;
  backgroundColor: string | null;
  collections: CollectionDto[];
  collectionTargetId: string;
  onCollectionTargetChange: (id: string) => void;
  onCollectionMembershipChange: (member: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const style = currentPreviewStyle(family, styleKey);
  const face = style?.face;
  const [copyMessage, setCopyMessage] = useState("");
  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(t("desktop.copiedLabel", { label }));
    } catch {
      setCopyMessage(t("desktop.copyFailedClipboard"));
    }
  };
  return (
    <section className="inspector-panel" aria-label={t("inspector.title")}>
      <button
        className="inspector-close"
        aria-label={t("inspector.close")}
        onClick={onClose}
      >
        <XIcon />
      </button>
      <h2>{family.displayName}</h2>
      <p className="inspector-style">
        {style?.name ?? t("font.regular")} <span>·</span> {face?.format ?? t("font.font")} <span>·</span> {t("macos.stylesCount", { count: family.faces.length })}
      </p>
      <details className="inspector-section" open>
        <summary>{t("common.preview")}</summary>
        <div className="inspector-preview" style={{ backgroundColor: backgroundColor ?? undefined }}>
          <FontPreview style={style} text={previewText} size={previewSize} color={textColor} lines={6} align="left" priority="selected" label={t("desktop.previewLabelShort", { name: family.displayName, style: style?.name ?? t("font.regular") })} />
        </div>
      </details>
      {face?.weight != null && (
        <div className="inspector-weight">
          <span>{t("font.weight")}</span>
          <strong>{style?.coordinates.wght ?? face.weight}</strong>
        </div>
      )}
      <details className="inspector-section" open>
        <summary>{t("inspector.copyAs")}</summary>
        <div className="inspector-copy-list">
          <button type="button" onClick={() => void copyValue(`font-family: "${family.displayName}";`, "CSS")}><CopyIcon />CSS</button>
          <button type="button" onClick={() => void copyValue(`@font-face {\n  font-family: "${family.displayName}";\n  src: url("${face?.sources[0]?.path.split(/[\\/]/).pop() ?? "font-file"}");\n}`, "CSS font-face")}><CopyIcon />CSS font-face</button>
          <button type="button" onClick={() => void copyValue(`.font(.custom("${face?.postscriptName ?? family.displayName}", size: 16))`, "SwiftUI")}><CopyIcon />SwiftUI</button>
          <button type="button" onClick={() => void copyValue(family.displayName, t("font.familyName"))}><CopyIcon />{t("font.familyName")}</button>
          {face?.postscriptName && <button type="button" onClick={() => void copyValue(face.postscriptName!, t("font.postScriptName"))}><CopyIcon />{t("font.postScriptName")}</button>}
        </div>
        <span className="inspector-copy-status" role="status">{copyMessage}</span>
      </details>
      <details className="inspector-section" open>
        <summary>{t("inspector.information")}</summary>
        <dl>
          <dt>{t("font.styles")}</dt><dd>{family.faces.length}</dd>
          <dt>{t("font.format")}</dt><dd>{face?.format ?? "—"}</dd>
          <dt>{t("font.postScriptName")}</dt><dd>{face?.postscriptName ?? "—"}</dd>
          <dt>{t("inspector.source")}</dt><dd className="source-path">{face?.sources[0]?.path ?? "—"}</dd>
        </dl>
      </details>
      {collections.length > 0 && (
        <div className="inspector-membership">
          <h3>{t("collection.collection")}</h3>
          <OptionSelect
            label={t("collection.select")}
            value={collectionTargetId}
            options={collections.map((collection) => ({
              id: collection.id,
              label: collection.name,
            }))}
            onChange={onCollectionTargetChange}
          />
          <Switch
            isSelected={family.collectionIds.includes(collectionTargetId)}
            onChange={onCollectionMembershipChange}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              {t("collection.addTo")}
            </Switch.Content>
          </Switch>
        </div>
      )}
    </section>
  );
}

function OptionSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select.Root
      className="hero-select"
      aria-label={label}
      selectedKey={value}
      onSelectionChange={(key) => {
        if (key !== null) onChange(String(key));
      }}
    >
      <Select.Trigger className="hero-select-trigger items-center">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox aria-label={t("desktop.labelOptions", { label })}>
          {options.map((option) => (
            <ListBox.Item
              key={option.id}
              id={option.id}
              textValue={option.label}
            >
              {option.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select.Root>
  );
}

function SettingSlider({
  label,
  minValue,
  maxValue,
  value,
  onChange,
  onChangeStart,
  onChangeEnd,
  className = "settings-slider",
  step = 1,
  unit = "px",
  isDisabled = false,
}: {
  label: string;
  minValue: number;
  maxValue: number;
  value: number;
  onChange: (value: number) => void;
  onChangeStart?: () => void;
  onChangeEnd?: () => void;
  className?: string;
  step?: number;
  unit?: string;
  isDisabled?: boolean;
}) {
  return (
    <ClaralightSlider
      className={`folio-slider ${className}`}
      aria-label={label}
      aria-valuetext={`${value}${unit}`}
      min={minValue}
      max={maxValue}
      step={step}
      disabled={isDisabled}
      value={value}
      onValueChange={onChange}
      onValueChangeStart={onChangeStart}
      onValueChangeEnd={onChangeEnd}
    />
  );
}

function BlurSettingsPreview({
  items,
  value,
  onChange,
}: {
  items: MenuEntry[];
  value: number;
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation();
  const [previewRoot, setPreviewRoot] = useState<HTMLDivElement | null>(null);
  return (
    <section className="blur-preview-section" aria-labelledby="blur-preview-title">
      <div className="blur-preview-heading">
        <h2 id="blur-preview-title">{t("desktop.blurEffect")}</h2>
        <p>{t("desktop.blurDescription")}</p>
      </div>
      <div className="blur-preview-window" ref={setPreviewRoot}>
        <header className="titlebar blur-preview-titlebar">
          <button
            type="button"
            className="titlebar-sidebar-button"
            data-slot="button"
            tabIndex={-1}
            aria-hidden="true"
          >
            <SidebarSimpleIcon size={14} />
          </button>
          <div className="titlebar-leading blur-preview-leading">
            <div className="menu-root">
              <button
                type="button"
                className="window-brand"
                aria-haspopup="menu"
                aria-expanded="true"
                tabIndex={-1}
              >
                <FolioWordmark />
              </button>
              <MenuPopover
                backdropRoot={previewRoot}
                className="file-menu-popover blur-preview-menu-shell"
                id="blur-preview-menu"
                label={t("desktop.fileMenuPreview")}
              >
                {items.map((item) => (
                  <Fragment key={item.label}>
                    {item.separatorBefore && (
                      <div className="menu-separator" role="separator" />
                    )}
                    <MenuItem item={item} onSelect={() => {}} />
                  </Fragment>
                ))}
              </MenuPopover>
            </div>
            <nav className="menubar" aria-label={t("desktop.appMenuPreview")}>
              {["macos.menuEdit", "macos.menuView", "macos.menuWindow", "macos.menuHelp"].map((label) => (
                <span className="menu-trigger" key={label}>
                  {t(label)}
                </span>
              ))}
            </nav>
          </div>
        </header>
        <div className="blur-preview-workspace">
          <aside className="blur-preview-sidebar" aria-label={t("navigation.sidebarPreview")}>
            <div className="blur-preview-sidebar-inner">
              <div className="sidebar-pages" aria-hidden="true">
                <span className="sidebar-page" aria-selected="true">
                  <span className="sidebar-page-label">{t("navigation.navigation")}</span>
                  <span className="sidebar-page-dot" />
                </span>
                <span className="sidebar-page" aria-selected="false">
                  <span className="sidebar-page-dot" />
                  <span className="sidebar-page-label">{t("navigation.filters")}</span>
                </span>
              </div>
              <nav
                className="sidebar-scroll blur-preview-nav"
                aria-label={t("desktop.scrollableSidebarPreview")}
                tabIndex={0}
              >
                <div className="sidebar-section-label">{t("navigation.local")}</div>
                <div className="sidebar-link selected">
                  <AnimatedIcon name="text-aa" />
                  {t("navigation.allFonts")}<span>1,248</span>
                </div>
                <div className="sidebar-link">
                  <AnimatedIcon name="clock-counter-clockwise" />
                  {t("navigation.recent")}
                </div>
                <div className="sidebar-link">
                  <AnimatedIcon name="star" />
                  {t("navigation.favorites")}
                </div>
                <div className="sidebar-section-label sidebar-section-heading">
                  {t("navigation.collections")}
                </div>
                <div className="sidebar-link sidebar-folder">
                  <span className="sidebar-link-icon">
                    <AnimatedIcon name="star" />
                  </span>
                  <span className="sidebar-folder-name">{t("desktop.demoFavoriteFonts")}</span>
                  <span>24</span>
                </div>
                <div className="sidebar-link sidebar-folder">
                  <span className="sidebar-link-icon">
                    <AnimatedIcon name="folder" />
                  </span>
                  <span className="sidebar-folder-name">{t("desktop.demoTitlingFonts")}</span>
                  <span>16</span>
                </div>
                <div className="sidebar-section-label sidebar-section-heading">
                  {t("desktop.fontManagement")}
                </div>
                <div className="sidebar-link">
                  <AnimatedIcon name="sparkle" />
                  {t("navigation.fontHealth")}
                </div>
                <div className="sidebar-link">
                  <AnimatedIcon name="hard-drives" />
                  {t("cloud.cloudFiles")}
                </div>
              </nav>
            </div>
          </aside>
          <section className="blur-preview-library" aria-hidden="true" />
        </div>
      </div>
      <div className="blur-preview-controls">
        <span>{t("desktop.blur")}</span>
        <SettingSlider
          label={t("desktop.blur")}
          minValue={1}
          maxValue={12}
          value={value}
          onChange={onChange}
        />
        <output>{value}px</output>
      </div>
      <p className="settings-note">
        {t("desktop.blurScrollHint")}
      </p>
    </section>
  );
}

function PreviewSizeSlider({
  value,
  onChange,
  onChangeStart,
  onChangeEnd,
}: {
  value: number;
  onChange: (value: number) => void;
  onChangeStart: () => void;
  onChangeEnd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <SettingSlider
      className="preview-size-slider"
      label={t("preview.size")}
      minValue={previewSizeRange.min}
      maxValue={previewSizeRange.max}
      value={value}
      onChange={onChange}
      onChangeStart={onChangeStart}
      onChangeEnd={onChangeEnd}
    />
  );
}

function scopeTitle(scope: LibraryScope) {
  switch (scope) {
    case "all":
      return i18n.t("navigation.allFonts");
    case "recent":
      return i18n.t("navigation.recent");
    case "favorites":
      return i18n.t("navigation.favorites");
    case "fontHealth":
      return i18n.t("navigation.fontHealth");
    case "cloudFonts":
      return i18n.t("cloud.cloudFiles");
    default:
      return i18n.t("font.font");
  }
}

function storedSidebarWidth(key: string) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value >= 256 && value <= 480 ? value : null;
}

function parseSidebarBlur(value: string | null) {
  if (value === null) return 4;
  const amount = Number(value);
  return Number.isFinite(amount)
    ? Math.round(Math.min(12, Math.max(1, amount)))
    : 4;
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : i18n.t("common.unknownError");
}

function formatFileSize(bytes: number) {
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length - 1);
  return `${(bytes / 1000 ** unit).toFixed(1)} ${units[unit]}`;
}

function cloudConnectionName(profile: SyncProfileDto) {
  const directory = profile.remoteDirectory.trim();
  if (directory) return directory;
  try {
    return new URL(profile.serverUrl).host || i18n.t("navigation.cloud");
  } catch {
    return profile.serverUrl.trim() || i18n.t("navigation.cloud");
  }
}

function facetGroups(facets: FacetOptionDto[]) {
  const grouped = new Map<string, FacetOptionDto[]>();
  for (const facet of facets) {
    const group = grouped.get(facet.kind) ?? [];
    group.push(facet);
    grouped.set(facet.kind, group);
  }
  return [...grouped.entries()];
}

function facetGroupTitle(kind: string) {
  const titles: Record<string, string> = {
    categories: "filters.category",
    scripts: "filters.script",
    licenses: "filters.license",
    foundries: "filters.foundry",
    features: "filters.feature",
    states: "filters.state",
    weights: "filters.weight",
    widths: "filters.width",
    multipleVariants: "font.family",
  };
  const key = titles[kind];
  return key ? i18n.t(key) : kind;
}

function toggleFacet(
  current: Record<string, string[]>,
  kind: string,
  value: string,
) {
  const values = current[kind] ?? [];
  const next = values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
  const result = { ...current };
  if (next.length) result[kind] = next;
  else delete result[kind];
  return result;
}

function mergeFacets(
  base: Record<string, string[]>,
  extra: Record<string, string[]>,
) {
  const result: Record<string, string[]> = { ...base };
  for (const [kind, values] of Object.entries(extra)) {
    result[kind] = [...new Set([...(result[kind] ?? []), ...values])];
  }
  return result;
}

function favoriteFolderEditorKey(intent: FavoriteFolderIntent) {
  switch (intent.kind) {
    case "create":
      return "create";
    case "editCollection":
      return `collection-${intent.collection.id}`;
    case "editSmartFolder":
      return `smart-folder-${intent.folder.id}`;
  }
}
