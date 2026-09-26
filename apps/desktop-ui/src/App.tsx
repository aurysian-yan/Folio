import {
  CornersInIcon,
  CornersOutIcon,
  ArrowClockwiseIcon,
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
  const [editingSmartFolderId, setEditingSmartFolderId] = useState<string | null>(
    null,
  );
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
  const [rightSidebarWidth, setRightSidebarWidth] = useState<number | null>(() =>
    storedSidebarWidth("folio-right-sidebar-width"),
  );
  const [resizingSidebar, setResizingSidebar] = useState<"left" | "right" | null>(null);
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
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState("Aa");
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
    const updateViewport = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    if (leftSidebarWidth !== null)
      localStorage.setItem("folio-left-sidebar-width", String(leftSidebarWidth));
  }, [leftSidebarWidth]);

  useEffect(() => {
    if (rightSidebarWidth !== null)
      localStorage.setItem("folio-right-sidebar-width", String(rightSidebarWidth));
  }, [rightSidebarWidth]);

  useEffect(() => {
    if (!snapClosingSidebar) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setSnapClosingSidebar(false));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [snapClosingSidebar]);

  useEffect(() => {
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
    void listen("library-updated", () => void runRefresh()).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    }).catch((cause) => {
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
      setOrganizationError("智慧收藏夹暂不支持按来源目录筛选，请先清除该条件。");
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
      ? (collections.find((collection) => collection.id === collectionId)?.name ??
        "手动收藏夹")
      : scope === "smartFolder"
        ? (smartFolders.find((folder) => folder.id === smartFolderId)?.name ??
          "智慧收藏夹")
        : scopeTitle(scope);
  const compactViewport = viewportWidth <= 860;
  const preferredLeftWidth = leftSidebarWidth ?? (compactViewport ? 190 : 256);
  const preferredRightWidth = rightSidebarWidth ?? (compactViewport ? 222 : 276);
  const availableSidebarWidth = Math.max(0, viewportWidth - 288);
  const leftPaneWidth = leftSidebarOpen
    ? Math.min(
        preferredLeftWidth,
        Math.max(0, availableSidebarWidth - (rightSidebarOpen ? 180 : 0)),
      )
    : 0;
  const rightPaneWidth = rightSidebarOpen
    ? Math.min(preferredRightWidth, Math.max(0, availableSidebarWidth - leftPaneWidth))
    : 0;
  const resizeSidebar = (side: "left" | "right", proposedWidth: number) => {
    if (proposedWidth < 256) {
      setSnapClosingSidebar(true);
      if (side === "left") setLeftSidebarOpen(false);
      else setRightSidebarOpen(false);
      setResizingSidebar(null);
      return;
    }
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? viewportWidth;
    const minimum = 256;
    const maximum = Math.max(
      minimum,
      Math.min(
        side === "left" ? 440 : 480,
        workspaceWidth - 288 - (side === "left" ? rightPaneWidth : leftPaneWidth),
      ),
    );
    const width = Math.round(Math.max(minimum, Math.min(maximum, proposedWidth)));
    if (side === "left") setLeftSidebarWidth(width);
    else setRightSidebarWidth(width);
  };
  const resizeFromPointer = (side: "left" | "right", clientX: number) => {
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    resizeSidebar(side, side === "left" ? clientX - rect.left : rect.right - clientX);
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
        <div className="window-brand">
          <span className="brand-mark">
            <TextAaIcon weight="bold" />
          </span>
          <nav className="menubar" aria-label="应用菜单">
            {[
              {
                name: "文件",
                items: [
                  { label: "添加字体文件夹…", action: chooseFolder },
                  { label: "刷新字体库", action: runRefresh },
                  { label: "设置…", action: openSettings },
                  { label: "退出 Folio", action: quitApp },
                ],
              },
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
              <details
                className="menu-root"
                key={menu.name}
                open={menuOpen === menu.name}
                onToggle={(event) => {
                  if ((event.currentTarget as HTMLDetailsElement).open)
                    setMenuOpen(menu.name);
                  else if (menuOpen === menu.name) setMenuOpen(null);
                }}
              >
                <summary
                  onClick={(event) => {
                    event.preventDefault();
                    setMenuOpen((current) =>
                      current === menu.name ? null : menu.name,
                    );
                  }}
                >
                  {menu.name}
                </summary>
                <div className="menu-popover" role="menu">
                  {menu.items.map((item) => (
                    <button
                      key={item.label}
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(null);
                        void item.action();
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </details>
            ))}
          </nav>
        </div>
        <span className="window-caption">
          {settingsWindow
            ? "设置"
            : page
              ? `字体库 · ${page.totalMatches} 个字族`
              : "字体库"}
        </span>
        <div className="window-controls" aria-label="窗口控制">
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
            <MinusIcon />
          </Button>
          <Button
            isIconOnly
            variant="tertiary"
            aria-label={isMaximized ? "还原窗口" : "最大化窗口"}
            onPress={() => void toggleWindowMaximize()}
          >
            {isMaximized ? <CornersInIcon /> : <CornersOutIcon />}
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
            <XIcon />
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
          style={{
            "--left-pane-width": `${leftPaneWidth}px`,
            "--right-pane-width": `${rightPaneWidth}px`,
            "--left-content-width": `${leftSidebarOpen ? leftPaneWidth : preferredLeftWidth}px`,
            "--right-content-width": `${rightSidebarOpen ? rightPaneWidth : preferredRightWidth}px`,
          } as React.CSSProperties}
        >
          <aside
            id="left-sidebar"
            className="sidebar"
            aria-label="左侧导航与筛选"
            aria-hidden={!leftSidebarOpen}
            inert={!leftSidebarOpen}
            data-open={leftSidebarOpen}
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
                  <ArrowClockwiseIcon />
                  最近
                </button>
                <button
                  className={`sidebar-link${scope === "favorites" ? " selected" : ""}`}
                  onClick={() => setScope("favorites")}
                >
                  <TextAaIcon />
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
                        <FolderPlusIcon />
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
                          onPress={() => void removeManualCollection(collection)}
                        >
                          <XIcon />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
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
                                selectedFacets[kind]?.includes(option.value) ??
                                false
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
                  <p className="sidebar-empty">当前字体库没有可用的筛选项。</p>
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
          {leftSidebarOpen && (
            <SidebarResizeHandle
              side="left"
              width={leftPaneWidth}
              min={Math.min(256, leftPaneWidth)}
              max={Math.max(256, Math.min(440, viewportWidth - 288 - rightPaneWidth))}
              onResize={resizeSidebar}
              onPointerResize={resizeFromPointer}
              onDragChange={(dragging) => setResizingSidebar(dragging ? "left" : null)}
            />
          )}

          <section className="library-pane">
            <header className="library-toolbar">
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
              <Toolbar className="toolbar-actions" aria-label="字体库工具">
                <Button
                  isIconOnly
                  size="sm"
                  variant={leftSidebarOpen ? "secondary" : "tertiary"}
                  aria-label={leftSidebarOpen ? "收起左侧栏" : "展开左侧栏"}
                  aria-pressed={leftSidebarOpen}
                  onPress={() => setLeftSidebarOpen((open) => !open)}
                >
                  <SidebarSimpleIcon />
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant={rightSidebarOpen ? "secondary" : "tertiary"}
                  aria-label={rightSidebarOpen ? "收起右侧栏" : "展开右侧栏"}
                  aria-pressed={rightSidebarOpen}
                  onPress={() => setRightSidebarOpen((open) => !open)}
                >
                  <SidebarIcon />
                </Button>
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
                <Button
                  isIconOnly
                  aria-label="刷新字体库"
                  variant="tertiary"
                  onPress={() => void runRefresh()}
                  isDisabled={refreshing}
                >
                  <ArrowClockwiseIcon className={refreshing ? "spin" : ""} />
                </Button>
                <Button
                  isIconOnly
                  aria-label="添加字体文件夹"
                  variant="tertiary"
                  onPress={() => void chooseFolder()}
                >
                  <PlusIcon />
                </Button>
                <Button
                  isIconOnly
                  aria-label="设置"
                  variant="tertiary"
                  onPress={() => void openSettings()}
                >
                  <GearSixIcon />
                </Button>
              </Toolbar>
            </header>

            <div className="library-title-row">
              <div>
                <h1>{currentScopeTitle}</h1>
                <p>{page ? `${page.totalMatches} 个字族` : "正在加载字体库"}</p>
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
          {rightSidebarOpen && (
            <SidebarResizeHandle
              side="right"
              width={rightPaneWidth}
              min={Math.min(256, rightPaneWidth)}
              max={Math.max(256, Math.min(480, viewportWidth - 288 - leftPaneWidth))}
              onResize={resizeSidebar}
              onPointerResize={resizeFromPointer}
              onDragChange={(dragging) => setResizingSidebar(dragging ? "right" : null)}
            />
          )}
          <aside
            id="right-sidebar"
            className="inspector-rail"
            aria-label="右侧字体检查器"
            aria-hidden={!rightSidebarOpen}
            inert={!rightSidebarOpen}
            data-open={rightSidebarOpen}
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
  min,
  max,
  onResize,
  onPointerResize,
  onDragChange,
}: {
  side: "left" | "right";
  width: number;
  min: number;
  max: number;
  onResize: (side: "left" | "right", width: number) => void;
  onPointerResize: (side: "left" | "right", clientX: number) => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onDragChange(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      onPointerResize(side, event.clientX);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    onDragChange(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number;
    if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const direction = event.key === "ArrowRight" ? 1 : -1;
      next = width + direction * (side === "left" ? 1 : -1) * (event.shiftKey ? 20 : 10);
    } else return;
    event.preventDefault();
    onResize(side, next);
  };

  return (
    <div
      className={`sidebar-resizer sidebar-resizer-${side}`}
      role="separator"
      aria-label={`调整${side === "left" ? "左" : "右"}侧栏宽度`}
      aria-controls={`${side}-sidebar`}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      aria-valuetext={`${width} 像素`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={() => onDragChange(false)}
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
          {face?.styleName ?? `${family.faces.length} 个样式`}
        </Card.Description>
        {mode !== "compact" && (
          <div className="font-card-meta">
            {family.isVariable ? "可变字体" : (face?.format ?? "字体")}
            {family.faces.length > 1 ? ` · ${family.faces.length} 个样式` : ""}
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
  return (
    <section className="inspector-panel" aria-label="字体检查器">
      <button
        className="inspector-close"
        aria-label="关闭检查器"
        onClick={onClose}
      >
        <XIcon />
      </button>
      <div className="inspector-preview">
        {preview && <img src={preview} alt="" />}
      </div>
      <h2>{family.displayName}</h2>
      <p className="inspector-style">{face?.styleName ?? "常规"}</p>
      <dl>
        <dt>字族样式</dt>
        <dd>{family.faces.length}</dd>
        <dt>格式</dt>
        <dd>{face?.format ?? "—"}</dd>
        <dt>PostScript 名称</dt>
        <dd>{face?.postscriptName ?? "—"}</dd>
        <dt>来源</dt>
        <dd className="source-path">{face?.sources[0]?.path ?? "—"}</dd>
      </dl>
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
  return Number.isFinite(value) && value >= 256 && value <= 480
    ? value
    : null;
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
