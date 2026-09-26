import {
  CopySimpleIcon,
  SquareIcon,
  ArrowClockwiseIcon,
  CloudCheckIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  FolderIcon,
  FolderPlusIcon,
  GearSixIcon,
  GridFourIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  StackSimpleIcon,
  SidebarIcon,
  SidebarSimpleIcon,
  SparkleIcon,
  StarIcon,
  TextAaIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  Button,
  Card,
  Checkbox,
  Input,
  Label,
  ListBox,
  SearchField,
  Select,
  Slider,
  Switch,
  TextField,
  Toolbar,
} from "@heroui/react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addLibraryRoot,
  cancelSync,
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
  SmartFolderDto,
  SyncConflictDto,
  SyncProfileDto,
  SyncStatusDto,
} from "./types";

type ViewMode = "compact" | "large" | "list" | "expanded";
type LibraryScope =
  "all" | "recent" | "favorites" | "collection" | "smartFolder";
type SettingsPage =
  "cloud" | "importing" | "display" | "theme" | "cards" | "about";

const viewModes: { id: ViewMode; label: string; Icon: typeof GridFourIcon }[] =
  [
    { id: "compact", label: "紧凑网格", Icon: GridFourIcon },
    { id: "large", label: "大网格", Icon: GridFourIcon },
    { id: "list", label: "长条列表", Icon: ListBulletsIcon },
    { id: "expanded", label: "展开卡片", Icon: StackSimpleIcon },
  ];

const settingsPages: { id: SettingsPage; title: string }[] = [
  { id: "cloud", title: "云同步" },
  { id: "importing", title: "导入" },
  { id: "display", title: "显示" },
  { id: "theme", title: "主题色" },
  { id: "cards", title: "字体卡片" },
  { id: "about", title: "关于" },
];

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
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newSmartFolderName, setNewSmartFolderName] = useState("");
  const [editingCollectionName, setEditingCollectionName] = useState<
    string | null
  >(null);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(
    null,
  );
  const [editingSmartFolderName, setEditingSmartFolderName] = useState<
    string | null
  >(null);
  const [editingSmartFolderId, setEditingSmartFolderId] = useState<
    string | null
  >(null);
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
    };
    window.addEventListener("storage", syncPreferences);
    return () => window.removeEventListener("storage", syncPreferences);
  }, []);

  const loadPage = useCallback(
    async (text: string, currentScope: LibraryScope, offset = 0) => {
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
      .then(() => {
        if (active && !settingsWindow)
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

  const runRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshLibrary();
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
      setSyncStatus(await getSyncStatus());
    } catch (cause) {
      setSyncMessage(errorMessage(cause));
    }
  };

  const startCloudSync = async () => {
    try {
      lastAutomaticSyncAt.current = Date.now();
      await syncNow();
      setSyncStatus(await getSyncStatus());
      setSyncMessage("");
      wasSyncRunning.current = true;
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
      await addLibraryRoot(selectedPath);
      await Promise.all([loadPage(search, scope), reloadOrganization()]);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRefreshing(false);
    }
  }, [loadPage, reloadOrganization, search, scope]);

  const saveManualCollection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = (editingCollectionName ?? newCollectionName).trim();
    if (!name) {
      setOrganizationError("请输入收藏夹名称。");
      return;
    }
    const existing = collections.find(
      (collection) => collection.id === editingCollectionId,
    );
    try {
      const saved = await saveCollection({
        id: editingCollectionId ?? undefined,
        name,
        icon: existing?.icon ?? "folder",
        color: existing?.color ?? "gray",
      });
      await reloadOrganization();
      setEditingCollectionId(null);
      setEditingCollectionName(null);
      setNewCollectionName("");
      setOrganizationError(null);
      setCollectionId(saved.id);
      setScope("collection");
      setSelected(null);
    } catch (cause) {
      setOrganizationError(errorMessage(cause));
    }
  };

  const removeManualCollection = async (collection: CollectionDto) => {
    if (!window.confirm(`删除“${collection.name}”？字体文件不会被删除。`))
      return;
    try {
      await deleteCollection(collection.id);
      await reloadOrganization();
      if (collectionId === collection.id) {
        setScope("all");
        setCollectionId(null);
      }
      setOrganizationError(null);
    } catch (cause) {
      setOrganizationError(errorMessage(cause));
    }
  };

  const openSmartFolder = (folder: SmartFolderDto) => {
    setScope("smartFolder");
    setSmartFolderId(folder.id);
    setSearch(folder.queryText ?? "");
    setSelectedFacets(folder.facets);
    setSelected(null);
  };

  const saveCurrentSmartFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = (editingSmartFolderName ?? newSmartFolderName).trim();
    if (!name) {
      setOrganizationError("请输入智慧收藏夹名称。");
      return;
    }
    if (selectedFacets.roots?.length) {
      setOrganizationError(
        "智慧收藏夹暂不支持按来源目录筛选，请先清除该条件。",
      );
      return;
    }
    try {
      const saved = await saveSmartFolder({
        id: editingSmartFolderId ?? undefined,
        name,
        text: search,
        facets: selectedFacets,
      });
      await reloadOrganization();
      setEditingSmartFolderId(null);
      setEditingSmartFolderName(null);
      setNewSmartFolderName("");
      setOrganizationError(null);
      openSmartFolder(saved);
    } catch (cause) {
      setOrganizationError(errorMessage(cause));
    }
  };

  const removeSmartFolder = async (folder: SmartFolderDto) => {
    if (!window.confirm(`删除智慧收藏夹“${folder.name}”？`)) return;
    try {
      await deleteSmartFolder(folder.id);
      await reloadOrganization();
      if (smartFolderId === folder.id) {
        setScope("all");
        setSmartFolderId(null);
      }
      setOrganizationError(null);
    } catch (cause) {
      setOrganizationError(errorMessage(cause));
    }
  };

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
        : scopeTitle(scope);
  const compactViewport = viewportWidth <= 860;
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
  const fileMenuItems = [
    { label: "添加字体文件夹…", action: chooseFolder },
    { label: "刷新字体库", action: runRefresh },
    { label: "设置…", action: openSettings },
    { label: "退出 Folio", action: quitApp },
  ];
  const closeMenu = () => {
    setMenuOpen(null);
    setMenuMode(false);
  };

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
          <SidebarSimpleIcon size={13} />
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
            <div className="menu-popover file-menu-popover" id="file-menu" role="menu" aria-label="文件">
              {fileMenuItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    void item.action();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
          {menuMode && <nav className="menubar" aria-label="应用菜单">
            {[
              {
                name: "编辑",
                items: [
                  {
                    label: "全选字体",
                    action: () =>
                      document
                        .querySelector<HTMLElement>(".font-grid")
                        ?.focus(),
                  },
                ],
              },
              {
                name: "显示",
                items: [
                  ...viewModes.map(({ id, label }) => ({
                    label,
                    action: () => setViewMode(id),
                  })),
                  {
                    label: `${leftSidebarOpen ? "收起" : "展开"}左侧侧边栏`,
                    action: () => setLeftSidebarOpen((open) => !open),
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
                  {
                    label: "字体库",
                    action: () => window.location.assign("index.html"),
                  },
                  { label: "设置…", action: openSettings },
                ],
              },
              {
                name: "帮助",
                items: [
                  {
                    label: "关于 Folio",
                    action: () =>
                      settingsWindow
                        ? setSettingsPage("about")
                        : void openSettings(),
                  },
                ],
              },
            ].map((menu) => (
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
                {menuOpen === menu.name && <div className="menu-popover" id={`menu-${menu.name}`} role="menu" aria-label={menu.name}>
                  {menu.items.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        closeMenu();
                        void item.action();
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>}
              </div>
            ))}
          </nav>}
        </div>
        {!menuMode && !settingsWindow && <div className="titlebar-center">
          <div className="titlebar-drag-space" aria-hidden="true" />
          <Toolbar className="titlebar-actions" aria-label="字体库工具">
          <div className="view-picker" aria-label="浏览方式">
            {viewModes.map(({ id, label, Icon }) => (
              <Button
                key={id}
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
            ))}
          </div>
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
          <Button
            isIconOnly
            size="sm"
            aria-label="添加字体文件夹"
            variant="tertiary"
            onPress={() => void chooseFolder()}
          >
            <PlusIcon />
          </Button>
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
            <SidebarIcon size={13} />
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
                <TextField className="setting-field">
                  <Label>服务器地址</Label>
                  <Input
                    type="url"
                    autoComplete="url"
                    placeholder="https://dav.example.com"
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
                    <strong>
                      {syncStatus.configured
                        ? syncStatus.running
                          ? "正在同步"
                          : "已连接"
                        : "未连接"}
                    </strong>
                    <span>{syncStatus.error ?? syncStatus.phase}</span>
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
                  onClick={() => setSidebarPage("navigation")}
                >
                  导航
                </button>
                <button
                  role="tab"
                  aria-selected={sidebarPage === "filters"}
                  onClick={() => setSidebarPage("filters")}
                >
                  筛选
                </button>
              </div>
              <div className="sidebar-scroll">
                {sidebarPage === "navigation" ? (
                  <>
                    <div className="sidebar-section-label">本地</div>
                    <button
                      className={`sidebar-link${scope === "all" ? " selected" : ""}`}
                      onClick={() => setScope("all")}
                    >
                      <TextAaIcon />
                      全部字体{page && <span>{page.totalMatches}</span>}
                    </button>
                    <button
                      className={`sidebar-link${scope === "recent" ? " selected" : ""}`}
                      onClick={() => setScope("recent")}
                    >
                      <ClockCounterClockwiseIcon />
                      最近
                    </button>
                    <button
                      className={`sidebar-link${scope === "favorites" ? " selected" : ""}`}
                      onClick={() => setScope("favorites")}
                    >
                      <StarIcon />
                      收藏
                    </button>
                    <div className="sidebar-section-label sidebar-section-heading">
                      手动收藏夹
                    </div>
                    <div className="collection-list">
                      {collections.map((collection) => (
                        <div className="collection-row" key={collection.id}>
                          <button
                            className={`sidebar-link${scope === "collection" && collectionId === collection.id ? " selected" : ""}`}
                            onClick={() => {
                              setScope("collection");
                              setCollectionId(collection.id);
                              setSelected(null);
                            }}
                          >
                            <FolderIcon />
                            {collection.name}
                            <span>{collection.memberCount}</span>
                          </button>
                          <div className="collection-row-actions">
                            <Button
                              isIconOnly
                              size="sm"
                              variant="tertiary"
                              aria-label={`编辑${collection.name}`}
                              onPress={() => {
                                setEditingCollectionId(collection.id);
                                setEditingCollectionName(collection.name);
                              }}
                            >
                              <GearSixIcon />
                            </Button>
                            <Button
                              isIconOnly
                              size="sm"
                              variant="tertiary"
                              aria-label={`删除${collection.name}`}
                              onPress={() =>
                                void removeManualCollection(collection)
                              }
                            >
                              <XIcon />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <details className="sidebar-create-disclosure" open={editingCollectionId !== null}>
                      <summary>{editingCollectionId ? "编辑收藏夹" : "新建收藏夹"}</summary>
                    <form
                      className="sidebar-create-form"
                      onSubmit={saveManualCollection}
                    >
                      <TextField className="sidebar-name-field">
                        <Label>手动收藏夹名称</Label>
                        <Input
                          value={editingCollectionName ?? newCollectionName}
                          onChange={(event) =>
                            editingCollectionId
                              ? setEditingCollectionName(event.target.value)
                              : setNewCollectionName(event.target.value)
                          }
                          placeholder="输入名称"
                        />
                      </TextField>
                      <div className="sidebar-form-actions">
                        <Button size="sm" type="submit">
                          {editingCollectionId ? "保存名称" : "新建收藏夹"}
                        </Button>
                        {editingCollectionId && (
                          <Button
                            size="sm"
                            variant="tertiary"
                            onPress={() => {
                              setEditingCollectionId(null);
                              setEditingCollectionName(null);
                            }}
                          >
                            取消
                          </Button>
                        )}
                      </div>
                    </form>
                    </details>
                    <div className="sidebar-section-label sidebar-section-heading">
                      智慧收藏夹
                    </div>
                    <div className="collection-list">
                      {smartFolders.map((folder) => (
                        <div className="collection-row" key={folder.id}>
                          <button
                            className={`sidebar-link${scope === "smartFolder" && smartFolderId === folder.id ? " selected" : ""}`}
                            onClick={() => openSmartFolder(folder)}
                          >
                            <StarIcon />
                            {folder.name}
                            <span>{folder.matchCount}</span>
                          </button>
                          <div className="collection-row-actions">
                            <Button
                              isIconOnly
                              size="sm"
                              variant="tertiary"
                              aria-label={`编辑${folder.name}`}
                              onPress={() => {
                                openSmartFolder(folder);
                                setEditingSmartFolderId(folder.id);
                                setEditingSmartFolderName(folder.name);
                              }}
                            >
                              <GearSixIcon />
                            </Button>
                            <Button
                              isIconOnly
                              size="sm"
                              variant="tertiary"
                              aria-label={`删除${folder.name}`}
                              onPress={() => void removeSmartFolder(folder)}
                            >
                              <XIcon />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <details className="sidebar-create-disclosure" open={editingSmartFolderId !== null}>
                      <summary>{editingSmartFolderId ? "编辑智慧收藏夹" : "保存当前筛选"}</summary>
                    <form
                      className="sidebar-create-form"
                      onSubmit={saveCurrentSmartFolder}
                    >
                      <TextField className="sidebar-name-field">
                        <Label>智慧收藏夹名称</Label>
                        <Input
                          value={editingSmartFolderName ?? newSmartFolderName}
                          onChange={(event) =>
                            editingSmartFolderId
                              ? setEditingSmartFolderName(event.target.value)
                              : setNewSmartFolderName(event.target.value)
                          }
                          placeholder="保存当前搜索与筛选"
                        />
                      </TextField>
                      <div className="sidebar-form-actions">
                        <Button size="sm" type="submit">
                          {editingSmartFolderId ? "更新条件" : "保存条件"}
                        </Button>
                        {editingSmartFolderId && (
                          <Button
                            size="sm"
                            variant="tertiary"
                            onPress={() => {
                              setEditingSmartFolderId(null);
                              setEditingSmartFolderName(null);
                            }}
                          >
                            取消
                          </Button>
                        )}
                      </div>
                    </form>
                    </details>
                    {organizationError && (
                      <p className="sidebar-error" role="alert">
                        {organizationError}
                      </p>
                    )}
                    <div className="sidebar-spacer" />
                    <Button
                      className="add-folder-button"
                      onPress={() => void chooseFolder()}
                    >
                      <FolderPlusIcon />
                      添加字体文件夹
                    </Button>
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
              <button
                className="sidebar-settings"
                onClick={() => void openSettings()}
              >
                <GearSixIcon />
                设置
              </button>
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
              {page && page.facets.length > 0 && (
                <section className="quick-filters" aria-label="按分类筛选字体">
                  <div className="quick-filters-heading">
                    <span>按分类筛选字体</span>
                    {Object.values(selectedFacets).some((values) => values.length > 0) && (
                      <button type="button" onClick={() => setSelectedFacets({})}>
                        清除筛选
                      </button>
                    )}
                  </div>
                  {facetGroups(page.facets).slice(0, 4).map(([kind, options]) => (
                    <div className="quick-filter-row" key={kind}>
                      <span className="quick-filter-label">{facetGroupTitle(kind)}</span>
                      <div className="quick-filter-options">
                        {options.slice(0, 8).map((option) => {
                          const active = selectedFacets[kind]?.includes(option.value) ?? false;
                          return (
                            <button
                              type="button"
                              key={`${kind}:${option.value}`}
                              className={`quick-filter-chip${active ? " active" : ""}`}
                              aria-pressed={active}
                              onClick={() => setSelectedFacets((current) => toggleFacet(current, kind, option.value))}
                            >
                              {active && <span aria-hidden="true">✓</span>}
                              {option.label}
                              <small>{option.familyCount}</small>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>
              )}
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
    </main>
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
  return scope === "all" ? "全部字体" : scope === "recent" ? "最近" : "收藏";
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
