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
  StarIcon,
  TextAaIcon,
  TrashIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  Button,
  Card,
  Checkbox,
  Input,
  Label,
  ListBox,
  Modal,
  SearchField,
  Select,
  Slider,
  Switch,
  TextField,
  Toolbar,
} from "@heroui/react";
import { SmoothCorners, useSmoothCorners } from "@lisse/react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Fragment,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addLibraryRoot,
  cancelSync,
  convertCollectionToSmartFolder,
  convertSmartFolderToCollection,
  deleteCollection,
  deleteSmartFolder,
  disconnectSync,
  getSyncProfile,
  getSyncStatus,
  listCloudFonts,
  listCollections,
  listSmartFolders,
  listSyncConflicts,
  openSettings,
  queryLibrary,
  quitApp,
  recordRecent,
  refreshLibrary,
  renderPreviews,
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
  SyncConflictDto,
  SyncProfileDto,
  SyncItemDto,
  SyncStatusDto,
} from "./types";
import { AnimatedIcon } from "./animated-icons";
import type { AnimatedIconName } from "./animated-icons-data";

type ViewMode = "compact" | "large" | "list" | "expanded";
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
  "cloud" | "importing" | "display" | "shortcuts" | "theme" | "cards" | "about";
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
  return quitShortcutOptions.find((option) => option.id === value)?.id ?? "Control+W";
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
    { id: "compact", label: "紧凑网格", Icon: GridNineIcon },
    { id: "large", label: "大网格", Icon: GridFourIcon },
    { id: "list", label: "长条列表", Icon: ListBulletsIcon },
    { id: "expanded", label: "展开卡片", Icon: StackSimpleIcon },
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
  { id: "folder", label: "文件夹", animatedName: "folder" },
  { id: "books", label: "书籍", animatedName: "books" },
  { id: "type", label: "字体", animatedName: "text-aa" },
  { id: "star", label: "星标", animatedName: "star" },
  { id: "heart", label: "爱心", animatedName: "heart" },
  { id: "bookmark", label: "书签", animatedName: "bookmark-simple" },
  { id: "tag", label: "标签", animatedName: "tag" },
  { id: "briefcase", label: "工作", animatedName: "briefcase" },
  { id: "sparkles", label: "灵感", animatedName: "sparkle" },
  { id: "sliders-horizontal", label: "调节", animatedName: "sliders-horizontal" },
  { id: "signature", label: "签名", animatedName: "signature" },
  { id: "archive", label: "归档", animatedName: "archive" },
  { id: "book", label: "书本", animatedName: "book" },
  { id: "paperclip", label: "回形针", animatedName: "paperclip" },
  { id: "package", label: "包裹", animatedName: "package" },
  { id: "swatches", label: "色板", animatedName: "swatches" },
  { id: "gift", label: "礼物", animatedName: "gift" },
  { id: "stack", label: "叠层", animatedName: "stack" },
  { id: "number-circle-0", label: "数字 0", animatedName: "number-circle-zero" },
  { id: "number-circle-1", label: "数字 1", animatedName: "number-circle-one" },
  { id: "number-circle-2", label: "数字 2", animatedName: "number-circle-two" },
  { id: "number-circle-3", label: "数字 3", animatedName: "number-circle-three" },
  { id: "number-circle-4", label: "数字 4", animatedName: "number-circle-four" },
  { id: "number-circle-5", label: "数字 5", animatedName: "number-circle-five" },
  { id: "number-circle-6", label: "数字 6", animatedName: "number-circle-six" },
  { id: "number-circle-7", label: "数字 7", animatedName: "number-circle-seven" },
  { id: "number-circle-8", label: "数字 8", animatedName: "number-circle-eight" },
  { id: "number-circle-9", label: "数字 9", animatedName: "number-circle-nine" },
  { id: "number-square-0", label: "数字 0", animatedName: "number-square-zero" },
  { id: "number-square-1", label: "数字 1", animatedName: "number-square-one" },
  { id: "number-square-2", label: "数字 2", animatedName: "number-square-two" },
  { id: "number-square-3", label: "数字 3", animatedName: "number-square-three" },
  { id: "number-square-4", label: "数字 4", animatedName: "number-square-four" },
  { id: "number-square-5", label: "数字 5", animatedName: "number-square-five" },
  { id: "number-square-6", label: "数字 6", animatedName: "number-square-six" },
  { id: "number-square-7", label: "数字 7", animatedName: "number-square-seven" },
  { id: "number-square-8", label: "数字 8", animatedName: "number-square-eight" },
  { id: "number-square-9", label: "数字 9", animatedName: "number-square-nine" },
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
  { id: "red", label: "红色", value: "rgb(219, 56, 64)" },
  { id: "orange", label: "橙色", value: "rgb(232, 99, 31)" },
  { id: "yellow", label: "黄色", value: "rgb(209, 158, 5)" },
  { id: "lime", label: "黄绿色", value: "rgb(125, 176, 41)" },
  { id: "green", label: "绿色", value: "rgb(31, 153, 92)" },
  { id: "cyan", label: "青色", value: "rgb(0, 150, 161)" },
  { id: "blue", label: "蓝色", value: "rgb(46, 120, 214)" },
  { id: "purple", label: "紫色", value: "rgb(125, 79, 207)" },
  { id: "gray", label: "灰色", value: "rgb(122, 128, 135)" },
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
  { id: "cloud", title: "云同步" },
  { id: "importing", title: "导入" },
  { id: "display", title: "显示" },
  { id: "shortcuts", title: "快捷键" },
  { id: "theme", title: "主题色" },
  { id: "cards", title: "字体卡片" },
  { id: "about", title: "关于" },
];

// WebDAV 服务商预设，与 macOS 版本 WebDAVPreset 保持一致。
const webdavPresets: { id: string; label: string; url: string | null }[] = [
  { id: "none", label: "无", url: null },
  { id: "pan123", label: "123 云盘", url: "https://webdav.123pan.cn/webdav" },
  { id: "jianguoyun", label: "坚果云", url: "https://dav.jianguoyun.com/dav" },
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
  | "installed"
  | "available"
  | "external"
  | "system"
  | "unavailable";

const fontStateOptions: {
  id: FontStateId;
  label: string;
  animatedName: AnimatedIconName;
  help: string;
}[] = [
  {
    id: "active",
    label: "已挂载",
    animatedName: "seal-check",
    help: "操作系统当前可用的字体",
  },
  {
    id: "installed",
    label: "已安装",
    animatedName: "download-simple",
    help: "安装到当前用户字体目录的字体",
  },
  {
    id: "available",
    label: "仅在字体库",
    animatedName: "book",
    help: "Folio 字体库中尚未安装的副本",
  },
  {
    id: "external",
    label: "外部文件",
    animatedName: "file",
    help: "引用的文件和已添加文件夹中的字体",
  },
  {
    id: "system",
    label: "系统字体",
    animatedName: "laptop",
    help: "操作系统自带的字体",
  },
  {
    id: "unavailable",
    label: "文件不可用",
    animatedName: "warning",
    help: "来源文件已不可访问",
  },
];

function fontStateLabel(id: FontStateId) {
  return fontStateOptions.find((option) => option.id === id)?.label ?? "字体状态";
}

// 应用 lisse 平滑圆角的外壳；边框与阴影改用 SVG 效果跟随曲线轮廓。
function MenuPopover({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
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
        color: "#141820",
        opacity: 0.18,
      },
    },
  });
  return (
    <div
      ref={ref}
      className={`menu-popover${className ? ` ${className}` : ""}`}
      style={{ borderRadius: 10 }}
      id={id}
      role="menu"
      aria-label={label}
    >
      {children}
    </div>
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

function initialTheme() {
  return localStorage.getItem("folio-theme") ?? "system";
}

export default function App() {
  const settingsWindow = isSettingsWindow();
  const [theme, setTheme] = useState(initialTheme);
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
    () => localStorage.getItem("folio-card-hover") === "true",
  );
  const [cardMetadata, setCardMetadata] = useState(
    () => localStorage.getItem("folio-card-metadata") !== "false",
  );
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
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<FamilyDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuMode, setMenuMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState("Folio 字体预览");
  const [previewSize, setPreviewSize] = useState(48);
  const [syncProfile, setSyncProfile] = useState<SyncProfileDto | null>(null);
  const [syncServerUrl, setSyncServerUrl] = useState("");
  const [syncDirectory, setSyncDirectory] = useState("Folio");
  const [syncUsername, setSyncUsername] = useState("");
  const [syncPassword, setSyncPassword] = useState("");
  const [syncAutomatic, setSyncAutomatic] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatusDto | null>(null);
  const [syncMessage, setSyncMessage] = useState("");
  const [cloudFonts, setCloudFonts] = useState<CloudFontDto[]>([]);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflictDto[]>([]);
  const wasSyncRunning = useRef(false);
  const lastAutomaticSyncAt = useRef(0);
  const queryRevision = useRef(0);

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
    root.dataset.themePreference = theme;
    localStorage.setItem("folio-theme", theme);
    const applyTheme = () => {
      root.dataset.theme =
        theme === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : theme;
    };
    applyTheme();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("folio-view-mode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem("folio-quit-shortcut", quitShortcut);
  }, [quitShortcut]);

  useEffect(() => {
    localStorage.setItem("folio-import-mode", importMode);
    localStorage.setItem("folio-card-hover", String(cardHover));
    localStorage.setItem("folio-card-metadata", String(cardMetadata));
  }, [importMode, cardHover, cardMetadata]);

  useEffect(() => {
    const syncPreferences = (event: StorageEvent) => {
      if (event.key === "folio-theme" && event.newValue)
        setTheme(event.newValue);
      if (event.key === "folio-view-mode" && event.newValue)
        setViewMode(event.newValue as ViewMode);
      if (event.key === "folio-quit-shortcut")
        setQuitShortcut(parseQuitShortcut(event.newValue));
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
      const revision = ++queryRevision.current;
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
        if (revision !== queryRevision.current) return;
        setPage((current) =>
          offset > 0 && current
            ? { ...result, families: [...current.families, ...result.families] }
            : result,
        );
        setSelected((current) =>
          current
            ? (result.families.find((family) => family.id === current.id) ??
              null)
            : null,
        );
        const faceIds = result.families
          .map((family) => preferredFace(family)?.id)
          .filter((id): id is string => Boolean(id));
        if (faceIds.length) {
          const rendered = await renderPreviews(
            faceIds,
            previewText,
            previewSize,
          );
          if (revision === queryRevision.current) {
            setPreviews((current) => ({
              ...current,
              ...Object.fromEntries(
                rendered
                  .filter((preview) => preview.dataUrl)
                  .map((preview) => [
                    preview.faceId,
                    preview.dataUrl as string,
                  ]),
              ),
            }));
          }
        } else {
          setPreviews({});
        }
      } catch (cause) {
        if (revision === queryRevision.current) setError(errorMessage(cause));
      } finally {
        if (revision === queryRevision.current) setLoading(false);
      }
    },
    [
      collectionId,
      fontState,
      previewSize,
      previewText,
      selectedFacets,
      smartFolderId,
      sort,
    ],
  );

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

  // 主窗口维护云端连接状态与云字体列表，供侧栏「云端」区段使用。
  useEffect(() => {
    if (settingsWindow) return;
    let active = true;
    let previousRunning = false;
    const loadCloud = async () => {
      try {
        const [profile, status, fonts] = await Promise.all([
          getSyncProfile(),
          getSyncStatus(),
          listCloudFonts(),
        ]);
        if (!active) return;
        setSyncProfile(profile);
        setSyncStatus(status);
        setCloudFonts(fonts);
        previousRunning = status.running;
      } catch {
        // 云端不可用时保持未连接状态，不打断字体库浏览。
      }
    };
    void loadCloud();
    const timer = window.setInterval(() => {
      void getSyncStatus()
        .then((status) => {
          if (!active) return;
          setSyncStatus(status);
          if (previousRunning && !status.running) void loadCloud();
          previousRunning = status.running;
        })
        .catch(() => {});
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [settingsWindow]);

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

  const testCloudConnection = async () => {
    setSyncMessage("正在测试连接…");
    try {
      await testSyncConnection(currentSyncProfile(), syncPassword);
      setSyncMessage("连接测试成功。");
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
      setSyncMessage("连接配置已安全保存。");
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
      setSyncMessage("已断开云端连接。");
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
      setSyncMessage("冲突处理已保存。");
    } catch (cause) {
      setSyncMessage(errorMessage(cause));
    }
  };

  const chooseFolder = useCallback(async () => {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "添加字体文件夹",
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
  }, [loadPage, reloadOrganization, search, scope]);

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
      setOrganizationError("请输入收藏夹名称。");
      return;
    }
    if (draft.facets.roots?.length) {
      setOrganizationError(
        "智慧收藏夹暂不支持按来源目录筛选，请先清除该条件。",
      );
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
          ?.name ?? "手动收藏夹")
      : scope === "smartFolder"
        ? (smartFolders.find((folder) => folder.id === smartFolderId)?.name ??
          "智慧收藏夹")
        : scope === "fontState"
          ? fontStateLabel(fontState)
          : scopeTitle(scope);
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
    { label: "添加字体文件夹…", action: chooseFolder, Icon: FolderPlusIcon },
    { label: "刷新字体库", action: runRefresh, Icon: ArrowClockwiseIcon, shortcut: "Ctrl+R", ariaShortcut: "Control+R", disabled: refreshing },
    { label: "设置…", action: openSettings, shortcut: "Ctrl+,", ariaShortcut: "Control+,", separatorBefore: true },
    { label: "退出 Folio", action: quitApp, shortcut: quitShortcutOptions.find((option) => option.id === quitShortcut)?.label, ariaShortcut: quitShortcut, separatorBefore: true },
  ];
  const appMenus: { name: string; items: MenuEntry[] }[] = [
    {
      name: "编辑",
      items: [
        {
          label: "全选字体",
          action: () => document.querySelector<HTMLElement>(".font-grid")?.focus(),
        },
      ],
    },
    {
      name: "显示",
      items: [
        ...viewModes.map(({ id, label }) => ({
          label,
          action: () => setViewMode(id),
          checked: viewMode === id,
        })),
        {
          label: `${leftSidebarOpen ? "收起" : "展开"}左侧侧边栏`,
          action: () => setLeftSidebarOpen((open) => !open),
          separatorBefore: true,
        },
        {
          label: `${rightSidebarOpen ? "收起" : "展开"}右侧侧边栏`,
          action: () => setRightSidebarOpen((open) => !open),
        },
      ],
    },
    {
      name: "窗口",
      items: [
        { label: "字体库", action: () => window.location.assign("index.html") },
        { label: "设置…", action: openSettings, shortcut: "Ctrl+,", ariaShortcut: "Control+,", separatorBefore: true },
      ],
    },
    {
      name: "帮助",
      items: [
        {
          label: "关于 Folio",
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
    <main className={`app-window${settingsWindow ? " settings-window" : ""}`}>
      <header
        className="titlebar"
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
          if (
            (event.target as HTMLElement).closest(
              "button, input, summary, a, [role='menu']",
            )
          )
            return;
          void toggleWindowMaximize();
        }}
      >
        {!settingsWindow && <Button
          className="titlebar-sidebar-button"
          isIconOnly
          size="sm"
          variant="tertiary"
          isDisabled={menuMode}
          aria-label={leftSidebarOpen ? "收起左侧栏" : "展开左侧栏"}
          aria-pressed={leftSidebarOpen}
          onPress={() => setLeftSidebarOpen((open) => !open)}
        >
          <SidebarSimpleIcon size={14} />
        </Button>}
        <div className="titlebar-leading">
          <button
            type="button"
            className="window-brand"
            aria-label="文件菜单"
            aria-expanded={menuMode && menuOpen === "文件"}
            aria-controls="file-menu"
            onClick={() => {
              if (menuMode) closeMenu();
              else {
                setMenuMode(true);
                setMenuOpen("文件");
              }
            }}
            onMouseEnter={() => {
              if (menuMode) setMenuOpen("文件");
            }}
          >
          <svg height="12" viewBox="0 0 1024 364" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M386.388 112.573C417.93 112.573 444.888 121.213 467.261 138.494C496.236 161.658 510.723 193.83 510.723 235.01C510.723 265.894 501.553 293.103 483.215 316.634C458.641 347.886 424.715 363.513 381.436 363.513C349.893 363.513 322.752 353.953 300.013 334.834C271.404 310.567 257.101 277.66 257.101 236.112C257.101 206.698 265.536 180.961 282.407 158.9C306.614 128.015 341.275 112.573 386.388 112.573ZM899.664 112.573C931.206 112.573 958.164 121.213 980.537 138.494C1009.51 161.658 1024 193.83 1024 235.01C1024 265.894 1014.83 293.103 996.492 316.634C971.919 347.886 937.992 363.513 894.713 363.513C863.171 363.513 836.029 353.953 813.289 334.834C784.681 310.567 770.377 277.66 770.377 236.112C770.377 206.698 778.813 180.961 795.685 158.9C819.892 128.016 854.551 112.573 899.664 112.573ZM270.619 0.615173C273.097 0.615173 275.119 2.59711 275.169 5.07416L277.186 104.62C277.237 107.169 275.185 109.263 272.636 109.264H264.723C262.708 109.264 260.932 107.939 260.359 106.007L249.354 68.9003C249.266 68.6031 249.254 68.3348 249.146 68.0439C248.965 67.5523 248.59 67.0797 248.433 66.58C237.71 32.5309 215.967 15.506 183.203 15.5058H125.586C123.072 15.5058 121.035 17.544 121.035 20.0576V148.282C121.035 150.796 123.072 152.834 125.586 152.834H222.114C224.628 152.834 226.665 154.871 226.665 157.385V164.828C226.665 167.341 224.628 169.379 222.114 169.379H125.586C123.073 169.379 121.035 171.416 121.035 173.93V338.555C121.035 341.068 123.072 343.106 125.586 343.106H181.402C183.916 343.106 185.953 345.144 185.953 347.657V353.446C185.953 355.96 183.916 357.997 181.402 357.997H4.55078C2.0375 357.997 0.000131932 355.96 0 353.446V347.657C6.59676e-05 345.144 2.03746 343.107 4.55078 343.106H39.4619C41.9753 343.106 44.0127 341.068 44.0127 338.555V20.0576C44.0127 17.5442 41.9753 15.506 39.4619 15.5058H4.55078C2.03742 15.5056 0 13.4684 0 10.955V5.16595C0.000226495 2.65275 2.03756 0.615349 4.55078 0.615173H270.619ZM616.606 0.573181C619.417 0.0235637 622.031 2.17596 622.031 5.03998V339.106C622.031 341.62 624.069 343.658 626.582 343.658H649.539C649.897 343.658 650.251 343.664 650.6 343.674C650.895 343.601 651.2 343.554 651.513 343.537C654.461 343.374 657.162 343.047 659.617 342.555C672.454 340.349 678.873 331.157 678.873 314.979V161.797C678.873 159.283 676.836 157.246 674.322 157.246H651.515C649.001 157.246 646.964 155.208 646.964 152.694V146.577C646.964 144.435 648.457 142.583 650.551 142.129L743.228 122.041C746.064 121.426 748.743 123.587 748.743 126.489V339.106C748.743 341.62 750.781 343.658 753.294 343.658H769.099C771.299 343.658 773.317 343.841 775.15 344.209C778.981 344.8 781.273 347.882 782.026 353.456C782.363 355.947 780.265 357.997 777.752 357.997H513.8C511.286 357.997 509.249 355.96 509.249 353.446V348.209C509.249 345.695 511.287 343.665 513.8 343.606C521.985 343.417 528.72 342.699 534.006 341.452C546.109 338.143 552.161 328.951 552.161 313.876V40.4638C552.161 37.9503 550.123 35.912 547.609 35.912H513.8C511.286 35.912 509.249 33.8747 509.249 31.3613V25.3203C509.249 23.1436 510.79 21.2714 512.926 20.8535L616.606 0.573181ZM383.637 126.912C369.699 126.912 358.879 131.141 351.177 139.598C338.707 153.937 332.472 186.844 332.472 238.318C332.472 272.88 334.672 298.066 339.073 313.876C345.675 337.407 360.346 349.173 383.086 349.173C395.923 349.173 406.376 345.312 414.445 337.591C428.383 323.619 435.352 289.793 435.352 236.112C435.352 202.654 433.15 178.203 428.749 162.761C422.147 138.862 407.11 126.912 383.637 126.912ZM896.913 126.912C882.976 126.912 872.156 131.141 864.454 139.598C851.984 153.937 845.749 186.844 845.749 238.318C845.749 272.88 847.949 298.066 852.351 313.876C858.953 337.407 873.623 349.173 896.363 349.173C909.2 349.173 919.654 345.312 927.723 337.591C941.66 323.619 948.628 289.793 948.628 236.112C948.628 202.654 946.428 178.203 942.026 162.761C935.424 138.862 920.386 126.912 896.913 126.912ZM712.433 7.23334C719.401 7.23334 726.003 9.07219 732.238 12.749C746.542 20.4702 753.694 32.4198 753.694 48.5976C753.694 55.5833 751.861 62.2017 748.193 68.4521C740.491 82.056 728.571 88.8574 712.433 88.8574C705.831 88.8573 699.412 87.2036 693.177 83.8945C678.873 76.541 671.721 64.7751 671.721 48.5976C671.721 41.6118 673.372 34.9935 676.673 28.7431C684.742 14.4037 696.661 7.23336 712.433 7.23334Z" fill="white"/>
          </svg>
          </button>
          {menuMode && menuOpen === "文件" && (
            <MenuPopover className="file-menu-popover" id="file-menu" label="文件">
              {renderMenuItems(fileMenuItems)}
            </MenuPopover>
          )}
          {menuMode && <nav className="menubar" aria-label="应用菜单">
            {appMenus.map((menu) => (
              <div
                className="menu-root"
                key={menu.name}
                onMouseEnter={() => setMenuOpen(menu.name)}
              >
                <button
                  type="button"
                  className="menu-trigger"
                  aria-expanded={menuOpen === menu.name}
                  aria-controls={`menu-${menu.name}`}
                  onFocus={() => setMenuOpen(menu.name)}
                  onClick={() => setMenuOpen(menu.name)}
                >
                  {menu.name}
                </button>
                {menuOpen === menu.name && (
                  <MenuPopover id={`menu-${menu.name}`} label={menu.name}>
                    {renderMenuItems(menu.items)}
                  </MenuPopover>
                )}
              </div>
            ))}
          </nav>}
        </div>
        {!menuMode && !settingsWindow && <div className="titlebar-center">
          <div className="titlebar-drag-space" aria-hidden="true" />
          <Toolbar className="titlebar-actions" aria-label="字体库工具">
          <SmoothCorners
            className="view-picker"
            corners={titlebarCapsuleCorners}
            autoEffects={false}
            aria-label="浏览方式"
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
                  aria-label={label}
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
              aria-label="搜索字体"
              value={search}
              onChange={setSearch}
            >
              <SearchField.Group>
                <SearchField.SearchIcon>
                  <MagnifyingGlassIcon />
                </SearchField.SearchIcon>
                <SearchField.Input placeholder="搜索字体" />
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
                aria-label="刷新字体库"
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
                aria-label="添加字体文件夹"
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
        {settingsWindow && <span className="window-caption">
          {settingsWindow
            ? "设置"
            : page
              ? `字体库 · ${page.totalMatches} 个字族`
              : "字体库"}
        </span>}
        <div className="window-controls" aria-label="窗口控制">
          {!settingsWindow && <Button
            className="titlebar-sidebar-button"
            isIconOnly
            size="sm"
            variant="tertiary"
            isDisabled={menuMode}
            aria-label={rightSidebarOpen ? "收起右侧栏" : "展开右侧栏"}
            aria-pressed={rightSidebarOpen}
            onPress={() => setRightSidebarOpen((open) => !open)}
          >
            <SidebarSimpleIcon size={14} mirrored />
          </Button>}
          <Button
            isIconOnly
            variant="tertiary"
            aria-label="最小化"
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
            aria-label={isMaximized ? "还原窗口" : "最大化窗口"}
            onPress={() => void toggleWindowMaximize()}
          >
            {isMaximized ? <CopySimpleIcon size={13} /> : <SquareIcon size={13} />}
          </Button>
          <Button
            className="close-control"
            isIconOnly
            variant="tertiary"
            aria-label="关闭窗口"
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
            aria-label="关闭提示"
            onClick={() => setWindowActionError(null)}
          >
            <XIcon />
          </button>
        </div>
      )}

      {settingsWindow ? (
        <section className="settings-content" aria-label="设置">
          <aside className="settings-nav">
            <div className="settings-title">
              <GearSixIcon />
              设置
            </div>
            {settingsPages.map((item) => (
              <button
                key={item.id}
                className={settingsPage === item.id ? "selected" : ""}
                onClick={() => setSettingsPage(item.id)}
              >
                {item.title}
              </button>
            ))}
          </aside>
          <article className="settings-page">
            <h1>{settings?.title}</h1>
            {settingsPage === "theme" ? (
              <>
                <p>选择 Folio 的外观主题。</p>
                <div className="setting-choice-row">
                  {["system", "light", "dark"].map((choice) => (
                    <Button
                      key={choice}
                      variant={theme === choice ? "primary" : "secondary"}
                      onPress={() => setTheme(choice)}
                    >
                      {choice === "system"
                        ? "跟随系统"
                        : choice === "light"
                          ? "浅色"
                          : "深色"}
                    </Button>
                  ))}
                </div>
              </>
            ) : settingsPage === "display" ? (
              <>
                <p>设置字体库的初始浏览视图和预览字号。</p>
                <label className="setting-field">
                  默认浏览视图
                  <OptionSelect
                    label="默认浏览视图"
                    value={viewMode}
                    options={viewModes.map(({ id, label }) => ({ id, label }))}
                    onChange={(value) => setViewMode(value as ViewMode)}
                  />
                </label>
                <label className="setting-field">
                  预览字号
                  <PreviewSizeSlider
                    value={previewSize}
                    onChange={setPreviewSize}
                  />
                  <output>{previewSize}px</output>
                </label>
              </>
            ) : settingsPage === "shortcuts" ? (
              <>
                <p>选择退出 Folio 时使用的快捷键。</p>
                <label className="setting-field">
                  退出应用
                  <OptionSelect
                    label="退出应用快捷键"
                    value={quitShortcut}
                    options={quitShortcutOptions}
                    onChange={(value) => setQuitShortcut(parseQuitShortcut(value))}
                  />
                </label>
              </>
            ) : settingsPage === "importing" ? (
              <>
                <p>选择添加字体文件时使用的默认方式。</p>
                <label className="setting-field">
                  导入方式
                  <OptionSelect
                    label="导入方式"
                    value={importMode}
                    options={[
                      { id: "copy", label: "复制到 Folio 字体库" },
                      { id: "reference", label: "引用原文件" },
                    ]}
                    onChange={setImportMode}
                  />
                </label>
                <p className="settings-note">
                  复制会保留一份由 Folio
                  管理的字体文件；引用会从原目录读取字体。
                </p>
              </>
            ) : settingsPage === "cards" ? (
              <>
                <p>设置字体卡片的交互方式。</p>
                <Switch
                  className="setting-toggle"
                  isSelected={cardHover}
                  onChange={setCardHover}
                >
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    将指针移到卡片时选中字体
                  </Switch.Content>
                </Switch>
                <Switch
                  className="setting-toggle"
                  isSelected={cardMetadata}
                  onChange={setCardMetadata}
                >
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    显示卡片上的字体信息
                  </Switch.Content>
                </Switch>
              </>
            ) : settingsPage === "cloud" ? (
              <>
                <p>连接 WebDAV 或 123PAN，同步字体文件与收藏状态。</p>
                <div className="setting-field">
                  <span>服务商</span>
                  <div className="setting-choice-row setting-preset-row">
                    {webdavPresets.map((preset) => (
                      <Button
                        key={preset.id}
                        variant={
                          matchingWebdavPreset(syncServerUrl) === preset.id
                            ? "primary"
                            : "secondary"
                        }
                        onPress={() => setSyncServerUrl(preset.url ?? "")}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <TextField className="setting-field">
                  <Label>服务器地址</Label>
                  <Input
                    type="url"
                    autoComplete="url"
                    placeholder="https://"
                    value={syncServerUrl}
                    onChange={(event) => setSyncServerUrl(event.target.value)}
                  />
                </TextField>
                <TextField className="setting-field">
                  <Label>远程目录</Label>
                  <Input
                    value={syncDirectory}
                    onChange={(event) => setSyncDirectory(event.target.value)}
                  />
                </TextField>
                <TextField className="setting-field">
                  <Label>用户名</Label>
                  <Input
                    autoComplete="username"
                    value={syncUsername}
                    onChange={(event) => setSyncUsername(event.target.value)}
                  />
                </TextField>
                <TextField className="setting-field">
                  <Label>密码</Label>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={syncPassword}
                    onChange={(event) => setSyncPassword(event.target.value)}
                    placeholder={
                      syncProfile ? "已保存在系统凭据库，可留空" : "WebDAV 密码"
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
                    连接恢复后自动同步
                  </Switch.Content>
                </Switch>
                <div className="setting-actions">
                  <Button
                    variant="secondary"
                    onPress={() => void testCloudConnection()}
                  >
                    测试连接
                  </Button>
                  <Button
                    onPress={() => void saveCloudConnection()}
                    isDisabled={!syncPassword}
                  >
                    保存连接
                  </Button>
                </div>
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
                            ? `正在同步 ${syncStatus.percent}%`
                            : "已连接"
                          : "未连接"}
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
                      onPress={() => void startCloudSync()}
                      isDisabled={syncStatus.running}
                    >
                      {syncStatus.running ? "正在同步…" : "立即同步"}
                    </Button>
                    {syncStatus.running && (
                      <Button
                        variant="secondary"
                        onPress={() =>
                          void cancelSync().catch((cause) =>
                            setSyncMessage(errorMessage(cause)),
                          )
                        }
                      >
                        取消同步
                      </Button>
                    )}
                    {!syncStatus.running && (
                      <Button
                        variant="tertiary"
                        onPress={() => void disconnectCloud()}
                      >
                        断开连接
                      </Button>
                    )}
                  </div>
                )}
                <h2 className="settings-subheading">云端字体</h2>
                {cloudFonts.length ? (
                  <div className="sync-font-list">
                    {cloudFonts.map((font) => (
                      <div key={font.fingerprint}>
                        <strong>{font.displayName}</strong>
                        <span>
                          {font.deleted
                            ? "已删除"
                            : font.cloudOnly
                              ? "仅在云端"
                              : "已同步到本机"}{" "}
                          · {formatFileSize(font.fileSize)}
                        </span>
                        {(font.deleted || font.cloudOnly) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            isDisabled={syncStatus?.running}
                            onPress={() => void restoreCloudCopy(font)}
                          >
                            {font.deleted ? "恢复" : "下载"}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="settings-note">云端尚无字体记录。</p>
                )}
                <h2 className="settings-subheading">同步冲突</h2>
                {syncConflicts.length ? (
                  <div className="sync-conflict-list">
                    {syncConflicts.map((conflict) => (
                      <section key={conflict.id}>
                        <strong>{conflict.title}</strong>
                        <p>{conflict.detail}</p>
                        <div className="setting-actions">
                          <Button
                            size="sm"
                            variant="secondary"
                            onPress={() =>
                              void applySyncConflict(conflict.id, "keepBoth")
                            }
                          >
                            保留两者
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onPress={() =>
                              void applySyncConflict(conflict.id, "useLocal")
                            }
                          >
                            使用本机版本
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onPress={() =>
                              void applySyncConflict(conflict.id, "useRemote")
                            }
                          >
                            使用云端版本
                          </Button>
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <p className="settings-note">没有待处理冲突。</p>
                )}
              </>
            ) : (
              <p>Folio 字体资产管理工具</p>
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
            aria-label="左侧导航与筛选"
            aria-hidden={!leftSidebarVisible}
            inert={!leftSidebarVisible}
            data-open={leftSidebarVisible}
          >
            <div className="sidebar-inner">
              <div
                className="sidebar-tabs"
                role="tablist"
                aria-label="侧边栏页面"
              >
                <button
                  role="tab"
                  aria-selected={sidebarPage === "navigation"}
                  aria-label="导航"
                  title="导航"
                  onClick={() => setSidebarPage("navigation")}
                >
                  <AnimatedIcon name="map-pin" />
                </button>
                <button
                  role="tab"
                  aria-selected={sidebarPage === "filters"}
                  aria-label="筛选"
                  title="筛选"
                  onClick={() => setSidebarPage("filters")}
                >
                  <AnimatedIcon name="funnel-simple" />
                </button>
              </div>
              <div className="sidebar-scroll">
                {sidebarPage === "navigation" ? (
                  <>
                    <div className="sidebar-section-label">本地</div>
                    <SidebarItem
                      className={`sidebar-link${scope === "all" ? " selected" : ""}`}
                      onClick={() => selectLibraryScope("all")}
                    >
                      <AnimatedIcon name="text-aa" />
                      全部字体{snapshot && <span>{snapshot.familyCount}</span>}
                    </SidebarItem>
                    <SidebarItem
                      className={`sidebar-link${scope === "recent" ? " selected" : ""}`}
                      onClick={() => selectLibraryScope("recent")}
                    >
                      <AnimatedIcon name="clock-counter-clockwise" />
                      最近
                    </SidebarItem>
                    <SidebarItem
                      className={`sidebar-link${scope === "favorites" ? " selected" : ""}`}
                      onClick={() => selectLibraryScope("favorites")}
                    >
                      <AnimatedIcon name="star" />
                      收藏
                    </SidebarItem>
                    <div className="sidebar-section-label sidebar-section-heading">
                      收藏夹
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
                      新建收藏夹
                    </SidebarItem>
                    {organizationError && !favoriteEditor && (
                      <p className="sidebar-error" role="alert">
                        {organizationError}
                      </p>
                    )}
                    <div className="sidebar-section-label sidebar-section-heading">
                      云端
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
                            字体占用 {cloudFontStorage}
                          </span>
                        </span>
                        <span className="sidebar-cloud-count">
                          {activeCloudFonts.length}
                        </span>
                      </SidebarItem>
                    ) : (
                      <p className="sidebar-empty">未连接云端</p>
                    )}
                    <div className="sidebar-section-label sidebar-section-heading">
                      字体状态
                    </div>
                    {fontStateOptions.map((option) => {
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
                      工具
                    </div>
                    <SidebarItem
                      className="sidebar-link sidebar-link-disabled"
                      disabled
                      title="在线字体将在后续版本提供"
                    >
                      <AnimatedIcon name="globe" />
                      在线字体
                    </SidebarItem>
                    <SidebarItem
                      className={`sidebar-link${scope === "fontHealth" ? " selected" : ""}`}
                      onClick={() => selectLibraryScope("fontHealth")}
                    >
                      <AnimatedIcon name="stethoscope" />
                      字体健康
                      <span>{healthCount}</span>
                    </SidebarItem>
                  </>
                ) : (
                  <>
                    <div className="sidebar-section-label">筛选</div>
                    {page?.facets.length ? (
                      <div className="facet-groups">
                        {facetGroups(page.facets).map(([kind, options]) => (
                          <details
                            className="facet-group"
                            key={kind}
                            open={kind === "categories" || kind === "features"}
                          >
                            <summary>
                              {facetGroupTitle(kind)}
                              <span>{selectedFacets[kind]?.length ?? 0}</span>
                            </summary>
                            <div className="facet-options">
                              {options.slice(0, 24).map((option) => (
                                <Checkbox
                                  key={`${kind}:${option.value}`}
                                  isSelected={
                                    selectedFacets[kind]?.includes(
                                      option.value,
                                    ) ?? false
                                  }
                                  onChange={() =>
                                    setSelectedFacets((current) =>
                                      toggleFacet(current, kind, option.value),
                                    )
                                  }
                                >
                                  <Checkbox.Content>
                                    <Checkbox.Control>
                                      <Checkbox.Indicator />
                                    </Checkbox.Control>
                                    <span>{option.label}</span>
                                    <small>{option.familyCount}</small>
                                  </Checkbox.Content>
                                </Checkbox>
                              ))}
                            </div>
                          </details>
                        ))}
                      </div>
                    ) : (
                      <p className="sidebar-empty">
                        当前字体库没有可用的筛选项。
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
            <div className="library-overview">
              <div className="library-title-row">
                <div className="library-summary">
                  <div className="library-summary-heading">
                    <SparkleIcon aria-hidden="true" />
                    <h1>
                      {scope === "all" && page
                        ? `现有 ${page.totalMatches} 个字族，随时可用`
                        : currentScopeTitle}
                    </h1>
                  </div>
                  <p>
                    {page
                      ? `${page.totalMatches} 个字族 · 搜索、筛选并预览本地字体`
                      : "正在加载字体库"}
                  </p>
                  <span className="library-sync-note">
                    <CloudCheckIcon aria-hidden="true" />
                    本地字体目录已就绪
                  </span>
                </div>
                <div className="sort-button">
                  <span>排序</span>
                  <OptionSelect
                    label="排序方式"
                    value={sort}
                    options={[
                      { id: "name", label: "名称" },
                      { id: "recent", label: "最近查看" },
                      { id: "relevance", label: "相关度" },
                    ]}
                    onChange={setSort}
                  />
                </div>
              </div>
            </div>
            {error ? (
              <div className="state-message error-state">
                <h2>无法加载字体库</h2>
                <p>{error}</p>
                <Button onPress={() => void runRefresh()}>重试</Button>
              </div>
            ) : page?.families.length ? (
              <div
                className={`font-grid mode-${viewMode}`}
                tabIndex={-1}
                aria-label="字体列表"
              >
                {page.families.map((family) => (
                  <FontCard
                    key={family.id}
                    family={family}
                    mode={viewMode}
                    preview={previews[preferredFace(family)?.id ?? ""]}
                    selected={selected?.id === family.id}
                    onSelect={() => {
                      setSelected(family);
                      const identityId = preferredFace(family)?.identityId;
                      if (identityId)
                        void recordRecent(identityId)
                          .then(() =>
                            Promise.all([
                              loadPage(search, scope),
                              reloadOrganization(),
                            ]),
                          )
                          .catch((cause) => setError(errorMessage(cause)));
                    }}
                    onFavorite={() => {
                      void setFamilyFavorite(
                        family.faces.map((face) => face.identityId),
                        !family.isFavorite,
                      )
                        .then(() =>
                          Promise.all([
                            loadPage(search, scope),
                            reloadOrganization(),
                          ]),
                        )
                        .catch((cause) => setError(errorMessage(cause)));
                    }}
                  />
                ))}
              </div>
            ) : loading ? (
              <div className="state-message">
                <div className="loading-indicator" />
                <p>正在读取字体库…</p>
              </div>
            ) : (
              <div className="state-message empty-state">
                <div className="empty-icon">
                  <TextAaIcon />
                </div>
                <h2>{search ? "没有匹配的字体" : "字体库还是空的"}</h2>
                <p>
                  {search
                    ? "尝试更改搜索内容，或清除搜索条件。"
                    : "添加一个字体文件夹，Folio 就会建立本地字体目录。"}
                </p>
                {!search && (
                  <Button onPress={() => void chooseFolder()}>
                    <FolderPlusIcon />
                    添加字体文件夹
                  </Button>
                )}
              </div>
            )}
            {page && page.totalMatches > page.families.length && (
              <footer className="pagination-row">
                <span>
                  显示 {page.families.length} / {page.totalMatches}
                </span>
                <Button
                  variant="secondary"
                  onPress={() =>
                    void loadPage(search, scope, page.families.length)
                  }
                >
                  加载更多
                </Button>
              </footer>
            )}
            <footer className="preview-bar">
              <OptionSelect
                label="预览文字样例"
                value={previewText}
                options={[
                  { id: "Aa", label: "Aa" },
                  { id: "Folio", label: "Folio" },
                  {
                    id: "The quick brown fox jumps over the lazy dog.",
                    label: "Pangram",
                  },
                  { id: "1234567890", label: "数字" },
                ]}
                onChange={setPreviewText}
              />
              <TextField
                className="preview-text-field"
                aria-label="自定义预览文字"
              >
                <Input
                  aria-label="自定义预览文字"
                  className="preview-text-input"
                  value={previewText}
                  onChange={(event) => setPreviewText(event.target.value)}
                />
              </TextField>
              <TextAaIcon />
              <PreviewSizeSlider
                value={previewSize}
                onChange={setPreviewSize}
              />
              <output>{previewSize}px</output>
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
            aria-label="右侧字体检查器"
            aria-hidden={!rightSidebarVisible}
            inert={!rightSidebarVisible}
            data-open={rightSidebarVisible}
          >
            <div className="inspector-inner">
              {selected ? (
                <Inspector
                  family={selected}
                  preview={previews[preferredFace(selected)?.id ?? ""]}
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
                  <strong>字体检查器</strong>
                  <p>选择一个字族以查看字体信息。</p>
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
  return (
    <div
      className="menu-popover context-menu"
      role="menu"
      aria-label="收藏夹操作"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <MenuItem
        item={{ label: "编辑收藏夹…", Icon: PencilSimpleIcon, action: onEdit }}
        onSelect={() => onEdit()}
      />
      <div className="menu-separator" role="separator" />
      <MenuItem
        item={{
          label: "删除收藏夹",
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
  const isCreate = intent.kind === "create";
  const [tab, setTab] = useState<"general" | "filters">("general");
  const [name, setName] = useState(seed.name);
  const [text, setText] = useState(seed.text);
  const [facets, setFacets] = useState<Record<string, string[]>>(seed.facets);
  const [icon, setIcon] = useState(seed.icon);
  const [color, setColor] = useState(seed.color);
  const groups = facetGroups(facetOptions);
  const selectedColorLabel =
    collectionColorOptions.find((option) => option.id === color)?.label ?? "灰色";

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
            aria-label={isCreate ? "新建收藏夹" : "编辑收藏夹"}
          >
            <div
              className="favorite-editor-tabs"
              role="tablist"
              aria-label="收藏夹设置"
            >
              <button
                role="tab"
                aria-selected={tab === "general"}
                onClick={() => setTab("general")}
              >
                常规
              </button>
              <button
                role="tab"
                aria-selected={tab === "filters"}
                onClick={() => setTab("filters")}
              >
                筛选条件
              </button>
            </div>

            <div className="favorite-editor-body">
              {tab === "general" ? (
                <div className="favorite-editor-page">
                  <TextField
                    className="favorite-editor-name"
                    aria-label="收藏夹名称"
                  >
                    <Input
                      autoFocus
                      aria-label="收藏夹名称"
                      placeholder="收藏夹名称"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </TextField>
                  <div className="favorite-editor-label">图标</div>
                  <div className="favorite-icon-grid">
                    {collectionIconOptions.map((option) => {
                      const selected = icon === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`favorite-icon-option${selected ? " selected" : ""}`}
                          aria-label={option.label}
                          aria-pressed={selected}
                          title={option.label}
                          onClick={() => setIcon(option.id)}
                        >
                          <AnimatedIcon name={option.animatedName} />
                        </button>
                      );
                    })}
                  </div>
                  <div className="favorite-editor-label-row">
                    <span className="favorite-editor-label">颜色</span>
                    <span className="favorite-editor-color-name">
                      {selectedColorLabel}
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
                          aria-label={option.label}
                          aria-pressed={selected}
                          title={option.label}
                          onClick={() => setColor(option.id)}
                        />
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="favorite-editor-page">
                  <div className="favorite-editor-field-heading">
                    <span className="favorite-editor-label">搜索字体</span>
                    <p className="favorite-editor-hint">
                      按字体名称、设计师或厂商等关键词匹配，多个关键词需同时满足。
                    </p>
                  </div>
                  <TextField
                    className="favorite-editor-search"
                    aria-label="筛选关键词"
                  >
                    <Input
                      aria-label="筛选关键词"
                      placeholder="输入关键词"
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                    />
                  </TextField>
                  <div className="favorite-editor-field-heading">
                    <span className="favorite-editor-label">筛选条件</span>
                    <p className="favorite-editor-hint">
                      添加筛选条件后，符合条件的字体会自动显示在此收藏夹中。
                    </p>
                  </div>
                  {groups.length ? (
                    <div className="facet-groups">
                      {groups.map(([kind, options]) => (
                        <details
                          className="facet-group"
                          key={kind}
                          open={kind === "categories" || kind === "features"}
                        >
                          <summary>
                            {facetGroupTitle(kind)}
                            <span>{facets[kind]?.length ?? 0}</span>
                          </summary>
                          <div className="facet-options">
                            {options.slice(0, 24).map((option) => (
                              <Checkbox
                                key={`${kind}:${option.value}`}
                                isSelected={
                                  facets[kind]?.includes(option.value) ?? false
                                }
                                onChange={() =>
                                  setFacets((current) =>
                                    toggleFacet(current, kind, option.value),
                                  )
                                }
                              >
                                <Checkbox.Content>
                                  <Checkbox.Control>
                                    <Checkbox.Indicator />
                                  </Checkbox.Control>
                                  <span>{option.label}</span>
                                  <small>{option.familyCount}</small>
                                </Checkbox.Content>
                              </Checkbox>
                            ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : (
                    <p className="sidebar-empty">
                      当前字体库没有可用的筛选项。
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
                取消
              </Button>
              <Button onPress={submit} isDisabled={!name.trim()}>
                {isCreate ? "创建" : "保存"}
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
  if (status.uploadedFiles > 0) parts.push(`上传 ${status.uploadedFiles} 个`);
  if (status.downloadedFiles > 0) parts.push(`下载 ${status.downloadedFiles} 个`);
  return parts.join(" · ");
}

function describeSyncItem(item: SyncItemDto): string {
  const action = item.action === "download" ? "下载" : "上传";
  switch (item.status) {
    case "running":
      return `${action}中`;
    case "done":
      return `${action}完成`;
    default:
      return `等待${action}`;
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
  if (!connected) {
    return (
      <div className="sidebar-status-card">
        <CloudIcon aria-hidden="true" />
        <span className="sidebar-status-text">
          <strong>未连接云端</strong>
          <button type="button" onClick={onOpenSettings}>
            在设置中连接 WebDAV
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
            ? `正在同步 ${percent}%`
            : error
              ? "同步未完成"
              : "本地与云端均为最新"}
        </strong>
        {running ? (
          <span className="sync-progress-detail">
            {describeSyncStage(status)}
          </span>
        ) : (
          <button type="button" onClick={onSync}>
            立即同步 ›
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
  if (!connected) {
    return (
      <div className="state-message empty-state">
        <div className="empty-icon">
          <CloudIcon />
        </div>
        <h2>未连接云端</h2>
        <p>在设置中连接 WebDAV，即可在此浏览与同步云字体。</p>
        <Button onPress={onOpenSettings}>
          <GearSixIcon />
          打开设置
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
          <h1>云端字体</h1>
          <p>
            {active.length} 个字体 ·{" "}
            {running ? "正在同步" : (status?.phase ?? "已连接")}
          </p>
        </div>
        <Button onPress={onSync} isDisabled={running}>
          {running ? "正在同步…" : "立即同步"}
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
                    <span>{font.cloudOnly ? "仅在云端" : "已同步到本机"}</span>
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
                    下载
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
          <h2>云端尚无字体</h2>
          <p>同步后，云端字体记录会显示在这里。</p>
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
      aria-label={`${collapsed ? "展开" : "调整"}${side === "left" ? "左" : "右"}侧栏${collapsed ? "" : "宽度"}`}
      aria-controls={`${side}-sidebar`}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={width}
      aria-valuetext={collapsed ? "已收起，向内拖动或按方向键展开" : `${width} 像素`}
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

function FontCard({
  family,
  mode,
  preview,
  selected,
  onSelect,
  onFavorite,
}: {
  family: FamilyDto;
  mode: ViewMode;
  preview?: string;
  selected: boolean;
  onSelect: () => void;
  onFavorite: () => void;
}) {
  const face = preferredFace(family);
  return (
    <Card
      className={`font-card${selected ? " selected" : ""}`}
      variant="secondary"
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div
        className="font-preview"
        aria-label={`${family.displayName} 字体预览`}
      >
        {preview ? (
          <img src={preview} alt="" />
        ) : (
          <span className="preview-unavailable">预览不可用</span>
        )}
      </div>
      <Card.Content className="font-card-content">
        <Card.Title>{family.displayName}</Card.Title>
        <Card.Description>
          {mode === "list"
            ? (face?.styleName ?? "常规")
            : `${family.faces.length} 个样式${family.isVariable ? " · VF" : ""}`}
        </Card.Description>
        {(mode === "large" || mode === "expanded") && (
          <div className="font-card-meta">
            {face?.styleName ?? "常规"} · {face?.format ?? "字体"}
          </div>
        )}
      </Card.Content>
      <button
        className={`favorite-button${family.isFavorite ? " is-favorite" : ""}`}
        aria-label={family.isFavorite ? "取消收藏" : "收藏字体"}
        aria-pressed={family.isFavorite}
        onClick={(event) => {
          event.stopPropagation();
          onFavorite();
        }}
      >
        <StarIcon weight={family.isFavorite ? "fill" : "regular"} />
      </button>
    </Card>
  );
}

function Inspector({
  family,
  preview,
  collections,
  collectionTargetId,
  onCollectionTargetChange,
  onCollectionMembershipChange,
  onClose,
}: {
  family: FamilyDto;
  preview?: string;
  collections: CollectionDto[];
  collectionTargetId: string;
  onCollectionTargetChange: (id: string) => void;
  onCollectionMembershipChange: (member: boolean) => void;
  onClose: () => void;
}) {
  const face = preferredFace(family);
  const [copyMessage, setCopyMessage] = useState("");
  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(`已复制${label}`);
    } catch {
      setCopyMessage("复制失败，请检查剪贴板权限");
    }
  };
  return (
    <section className="inspector-panel" aria-label="字体检查器">
      <button
        className="inspector-close"
        aria-label="关闭检查器"
        onClick={onClose}
      >
        <XIcon />
      </button>
      <h2>{family.displayName}</h2>
      <p className="inspector-style">
        {face?.styleName ?? "常规"} <span>·</span> {face?.format ?? "字体"} <span>·</span> {family.faces.length} 个样式
      </p>
      <details className="inspector-section" open>
        <summary>预览</summary>
        <div className="inspector-preview">
          {preview ? <img src={preview} alt={`${family.displayName} 预览`} /> : <span>预览不可用</span>}
        </div>
      </details>
      {face?.weight != null && (
        <div className="inspector-weight">
          <span>字重</span>
          <strong>{face.weight}</strong>
        </div>
      )}
      <details className="inspector-section" open>
        <summary>复制为</summary>
        <div className="inspector-copy-list">
          <button type="button" onClick={() => void copyValue(`font-family: "${family.displayName}";`, " CSS 样式")}><CopyIcon />CSS</button>
          <button type="button" onClick={() => void copyValue(`@font-face {\n  font-family: "${family.displayName}";\n  src: url("${face?.sources[0]?.path.split(/[\\/]/).pop() ?? "font-file"}");\n}`, " CSS font-face")}><CopyIcon />CSS font-face</button>
          <button type="button" onClick={() => void copyValue(`.font(.custom("${face?.postscriptName ?? family.displayName}", size: 16))`, " SwiftUI 代码")}><CopyIcon />SwiftUI</button>
          <button type="button" onClick={() => void copyValue(family.displayName, "字族名")}><CopyIcon />字族名</button>
          {face?.postscriptName && <button type="button" onClick={() => void copyValue(face.postscriptName!, " PostScript 名")}><CopyIcon />PostScript 名</button>}
        </div>
        <span className="inspector-copy-status" role="status">{copyMessage}</span>
      </details>
      <details className="inspector-section" open>
        <summary>字体信息</summary>
        <dl>
          <dt>字族样式</dt><dd>{family.faces.length}</dd>
          <dt>格式</dt><dd>{face?.format ?? "—"}</dd>
          <dt>PostScript 名</dt><dd>{face?.postscriptName ?? "—"}</dd>
          <dt>来源</dt><dd className="source-path">{face?.sources[0]?.path ?? "—"}</dd>
        </dl>
      </details>
      {collections.length > 0 && (
        <div className="inspector-membership">
          <h3>手动收藏夹</h3>
          <OptionSelect
            label="选择收藏夹"
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
              加入此收藏夹
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
  return (
    <Select.Root
      className="hero-select"
      aria-label={label}
      selectedKey={value}
      onSelectionChange={(key) => {
        if (key !== null) onChange(String(key));
      }}
    >
      <Select.Trigger className="hero-select-trigger">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox aria-label={`${label}选项`}>
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

function PreviewSizeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Slider.Root
      className="preview-size-slider"
      aria-label="预览字号"
      minValue={24}
      maxValue={104}
      step={1}
      value={[value]}
      onChange={(values) =>
        onChange(Array.isArray(values) ? (values[0] ?? value) : values)
      }
    >
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb />
      </Slider.Track>
    </Slider.Root>
  );
}

function preferredFace(family: FamilyDto) {
  return (
    family.faces.find((face) => family.matchedFaceIds.includes(face.id)) ??
    family.faces[0]
  );
}

function scopeTitle(scope: LibraryScope) {
  switch (scope) {
    case "all":
      return "全部字体";
    case "recent":
      return "最近";
    case "favorites":
      return "收藏";
    case "fontHealth":
      return "字体健康";
    case "cloudFonts":
      return "云端字体";
    default:
      return "字体";
  }
}

function storedSidebarWidth(key: string) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value >= 256 && value <= 480 ? value : null;
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : "发生未知错误，请重试。";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function cloudConnectionName(profile: SyncProfileDto) {
  const directory = profile.remoteDirectory.trim();
  if (directory) return directory;
  try {
    return new URL(profile.serverUrl).host || "云端";
  } catch {
    return profile.serverUrl.trim() || "云端";
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
  return (
    (
      {
        categories: "类型",
        scripts: "文字系统",
        licenses: "许可",
        foundries: "厂牌",
        features: "字体特征",
        states: "状态",
        weights: "字重",
        widths: "字宽",
        multipleVariants: "字族",
      } as Record<string, string>
    )[kind] ?? kind
  );
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
