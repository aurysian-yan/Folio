package com.folio.poc

import android.net.Uri
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.view.RoundedCorner
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebViewDatabase
import com.folio.poc.ffi.SmartFolderIdDto
import com.folio.poc.ffi.CollectionIdDto
import com.folio.poc.ffi.FolioEngine
import com.folio.poc.ffi.FolioOnline
import com.folio.poc.ffi.FolioSync
import com.folio.poc.ffi.IdentityIdDto
import com.folio.poc.ffi.LibrarySnapshotDto
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

class FolioSyncProfile : Record {
    @Field var serverUrl: String = ""
    @Field var remoteDirectory: String = ""
    @Field var username: String = ""
    @Field var automatic: Boolean = false
    fun dto() = com.folio.poc.ffi.SyncProfileDto(serverUrl, remoteDirectory, username, automatic)
}

class FolioQuery : Record {
    @Field var text: String = ""
    @Field var scope: String = "all"
    @Field var collectionId: String? = null
    @Field var smartFolderId: String? = null
    @Field var facets: List<FolioFacetSelection> = emptyList()
    @Field var locationFilter: String? = null
    @Field var fileFingerprint: String? = null
    @Field var offset: Long = 0
    @Field var limit: Int = 40
}

class FolioFacetSelection : Record {
    @Field var kind: String = ""
    @Field var value: String = ""
}

class FolioCollectionInput : Record {
    @Field var name: String = ""
    @Field var icon: String = "folder"
    @Field var color: String = "gray"
}

class FolioSmartConditions : Record {
    @Field var text: String = ""
    @Field var facets: List<FolioFacetSelection> = emptyList()
}

class FolioSmartInput : Record {
    @Field var name: String = ""
    @Field var icon: String = "folder"
    @Field var color: String = "gray"
    @Field var query: FolioSmartConditions = FolioSmartConditions()
}

class FolioImportFile : Record {
    @Field var uri: String = ""
    @Field var name: String = ""
}

class FolioPreviewSelection : Record {
    @Field var requestId: String? = null
    @Field var sourcePath: String = ""
    @Field var faceIndex: Int = 0
    @Field var revisionId: String = ""
    @Field var axes: Map<String, Double> = emptyMap()
    @Field var text: String = ""
    @Field var fontSize: Double = 32.0
    @Field var centered: Boolean = false
    @Field var wrapWidth: Double = 0.0
    @Field var foregroundColor: String = ""
}

class FolioNativeModule : Module() {
    private val executor = Executors.newSingleThreadExecutor()
    private val characterExecutor = Executors.newSingleThreadExecutor()
    private val updateExecutor = Executors.newSingleThreadExecutor()
    private val engine: FolioEngine? get() = appContext.reactContext?.let { FolioFileRuntime.get(it).engine }
    private val sync: FolioSync? get() = appContext.reactContext?.let { FolioFileRuntime.get(it).sync }
    private val lifecycleLock = Any()
    @Volatile private var foreground = true

    override fun definition() = ModuleDefinition {
        Name("FolioNative")
        AsyncFunction("updateDownloadState") { promise: Promise -> performUpdate(promise) { FolioUpdater.state(context()) } }
        AsyncFunction("startUpdateDownload") { request: String, promise: Promise -> performUpdate(promise) { FolioUpdater.start(context(), request) } }
        AsyncFunction("cancelUpdateDownload") { promise: Promise -> performUpdate(promise) { FolioUpdater.cancel(context()) } }
        AsyncFunction("installUpdate") { automatic: Boolean, promise: Promise -> launchUpdate(automatic, promise) }
        AsyncFunction("onlineState") { promise:Promise -> perform(promise) {FolioFileRuntime.get(context()).browser.state()} }
        AsyncFunction("onlineImportIcon") { uri:String,promise:Promise -> perform(promise) {FolioOnlineIcons.importFile(context(),uri)} }
        AsyncFunction("onlineAcceptDisclaimer") { promise:Promise -> perform(promise) {FolioFileRuntime.get(context()).browser.acceptDisclaimer();true} }
        AsyncFunction("onlineSaveProviders") { value:String,promise:Promise -> perform(promise) {FolioFileRuntime.get(context()).browser.saveProviders(value);true} }
        AsyncFunction("onlineClearData") { promise:Promise ->
            val app = context()
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                try {
                    CookieManager.getInstance().removeAllCookies(null)
                    CookieManager.getInstance().flush()
                    WebStorage.getInstance().deleteAllData()
                    WebViewDatabase.getInstance(app).clearHttpAuthUsernamePassword()
                    promise.resolve(true)
                } catch (cause: Exception) { promise.reject("online.browser.storageError", cause.message, cause) }
            }
        }
        AsyncFunction("onlineSearch") { id:String,query:String,promise:Promise -> perform(promise) {FolioFileRuntime.get(context()).browser.search(id,query)} }
        AsyncFunction("onlineDownload") { id:String,promise:Promise -> perform(promise) {FolioOnlineTransfers.start(context(),id)} }
        AsyncFunction("onlinePause") { id:String,promise:Promise -> perform(promise) {FolioOnlineTransfers.pause(context(),id);true} }
        AsyncFunction("onlineCancel") { id:String,promise:Promise -> perform(promise) {FolioOnlineTransfers.cancel(context(),id);true} }
        AsyncFunction("onlineRetry") { id:String,promise:Promise -> perform(promise) {FolioOnlineTransfers.retry(context(),id);true} }
        AsyncFunction("onlineInspect") { id:String,promise:Promise -> perform(promise) {FolioOnlineFiles.inspect(context(),id)} }
        AsyncFunction("onlineImport") { id:String,selection:List<String>,promise:Promise -> perform(promise) {FolioOnlineFiles.collect(context(),id,selection)} }
        AsyncFunction("onlineSave") { id:String ->
            val intent=android.content.Intent(context(),FolioOnlineExportActivity::class.java).putExtra("id",id).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            context().startActivity(intent)
        }
        View(FolioOnlineView::class) {
            OnViewDestroys { view: FolioOnlineView -> view.dispose() }
            Prop("active") { view: FolioOnlineView, value: Boolean -> view.setActive(value) }
            Events("onBrowserState","onDownloadIntent","onVisit","onPageScroll")
            Prop("provider") {view:FolioOnlineView,value:String->view.setProvider(value)}
            Prop("command") {view:FolioOnlineView,value:String->view.command(value)}
            Prop("webTheme") {view:FolioOnlineView,value:String->view.setWebTheme(value)}
            Prop("accentColor") {view:FolioOnlineView,value:String->view.setAccentColor(value)}
        }
        AsyncFunction("openCharacterMap") { request: String, promise: Promise ->
            performCharacterMap(promise) {
                FolioFileRuntime.get(context()).readableFont(org.json.JSONObject(request).getString("sourcePath"))
                requireEngine().openCharacterMap(request)
            }
        }
        AsyncFunction("queryCharacterMap") { request: String, promise: Promise ->
            performCharacterMap(promise) { requireEngine().queryCharacterMap(request) }
        }
        AsyncFunction("renderCharacterMap") { request: String, promise: Promise ->
            performCharacterMap(promise) { requireEngine().renderCharacterMap(request) }
        }
        AsyncFunction("closeCharacterMap") { handle: String, promise: Promise ->
            perform(promise) { requireEngine().closeCharacterMap(handle); true }
        }
        Function("aboutInfo") {
            val info = context().packageManager.getPackageInfo(context().packageName, 0)
            mapOf("version" to (info.versionName ?: ""), "build" to info.longVersionCode.toString(),
                "platform" to "android", "arch" to folioAndroidArch(),
                "sdkInt" to Build.VERSION.SDK_INT, "androidVariant" to FolioAndroidBuild.variant,
                "requiresVariantUpdate" to FolioAndroidBuild.requiresUpdate(context()))
        }

        // 外观主题：壁纸种子与 Material3 语义色，由外观页与主题派生同步读取。
        Function("wallpaperSeed") { FolioMaterialColors.wallpaperSeed(context()) }
        Function("materialPalette") { seed: String, dark: Boolean, followWallpaper: Boolean ->
            FolioMaterialColors.scheme(context(), seed, dark, followWallpaper)
        }
        Function("materialWebPalette") { seed: String, dark: Boolean, followWallpaper: Boolean ->
            FolioMaterialColors.webPalette(context(), seed, dark, followWallpaper)
        }

        // 屏幕顶部圆角按当前窗口方向读取，并转换为 dp。
        Function("screenCornerRadius") {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) 0.0
            else {
                val insets = appContext.currentActivity?.windowManager?.currentWindowMetrics?.windowInsets
                val radius = listOf(RoundedCorner.POSITION_TOP_LEFT, RoundedCorner.POSITION_TOP_RIGHT)
                    .mapNotNull { insets?.getRoundedCorner(it)?.radius }.maxOrNull() ?: 0
                radius.toDouble() / context().resources.displayMetrics.density
            }
        }

        // 当前窗口尺寸与四角圆角，统一以 dp 返回；窗口信息不可用时退回显示指标。
        Function("screenMetrics") {
            val activity = appContext.currentActivity
            val metrics = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                activity?.windowManager?.currentWindowMetrics
            } else null
            val density = context().resources.displayMetrics.density
            val bounds = metrics?.bounds
            val width = (bounds?.width() ?: context().resources.displayMetrics.widthPixels) / density
            val height = (bounds?.height() ?: context().resources.displayMetrics.heightPixels) / density
            val insets = metrics?.windowInsets
            fun radius(position: Int): Float {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return 0f
                return insets?.getRoundedCorner(position)?.radius?.toFloat() ?: 0f
            }
            // 圆角只有 API 31+ 的公共接口；更早版本按 0 处理，尺寸仍参与计算。
            val top = maxOf(radius(RoundedCorner.POSITION_TOP_LEFT), radius(RoundedCorner.POSITION_TOP_RIGHT))
            val bottom = maxOf(radius(RoundedCorner.POSITION_BOTTOM_LEFT), radius(RoundedCorner.POSITION_BOTTOM_RIGHT))
            mapOf(
                "width" to width.toDouble(),
                "height" to height.toDouble(),
                "shortestSide" to minOf(width, height).toDouble(),
                "topCornerRadius" to (top / density).toDouble(),
                "bottomCornerRadius" to (bottom / density).toDouble(),
            )
        }

        AsyncFunction("fileWorkflow") { request: String, promise: Promise ->
            val activity = appContext.currentActivity
            if (activity == null) promise.reject("ERR_FOLIO_FILES", "workflow.error.invalidRequest", null)
            else FolioFileRuntime.get(context()).launch(activity,request) { value,error ->
                if(error==null) promise.resolve(value ?: "{}") else promise.reject("ERR_FOLIO_FILES",error.message ?: "workflow.error.operationFailed",error)
            }
        }
        AsyncFunction("cancelFileWorkflow") { id:String -> FolioFileRuntime.activeFiles.values.mapNotNull {it.get()}.filter {it.isRequest(id)}.forEach {it.cancelWorkflow()}; true }
        AsyncFunction("fileState") { promise: Promise -> perform(promise) {
            val runtime=FolioFileRuntime.get(context())
            org.json.JSONObject().put("sources",org.json.JSONArray(runtime.files.sources())).put("batches",org.json.JSONArray(runtime.files.batches())).put("health",org.json.JSONObject(runtime.files.health())).put("inbox",runtime.inbox()).toString()
        } }
        AsyncFunction("removeExternalSource") { id: String, promise: Promise -> perform(promise) { FolioFileRuntime.get(context()).files.removeSource(id);true } }
        AsyncFunction("initialize") { promise: Promise ->
            perform(promise) {
                FolioFileRuntime.get(context()).refreshReferences()
                syncEngine().prepareManagedSources()
                snapshot(requireEngine().refreshLibrary().snapshot)
            }
        }

        AsyncFunction("snapshot") { promise: Promise ->
            perform(promise) { snapshot(if (syncEngine().status().isRunning) requireEngine().loadCachedLibrary() else requireEngine().refreshLibrary().snapshot) }
        }

        AsyncFunction("query") { request: FolioQuery, promise: Promise ->
            perform(promise) {
                FolioLibraryMapper.page(FolioLibraryMapper.read(requireEngine(), request.text, request.scope, request.collectionId,
                    request.smartFolderId, request.facets.map { it.kind to it.value }, request.offset, request.limit,request.locationFilter,request.fileFingerprint))
            }
        }

        AsyncFunction("importFonts") { files: List<FolioImportFile>, promise: Promise ->
            perform(promise) {
                requireSyncIdle()
                val importer = FolioFontImporter(requireEngine(), File(context().filesDir, "FolioMobilePoC"), { uri ->
                    val source = Uri.parse(uri)
                    if (source.scheme !in listOf("file", "content")) throw FontImportFailure("mobile.importErrors.read")
                    context().contentResolver.openInputStream(source) ?: throw FontImportFailure("mobile.importErrors.read")
                })
                val report = importer.importFiles(files.map { SelectedImportFile(it.uri, it.name) })
                mapOf("snapshot" to snapshot(report.snapshot), "items" to report.items.map { it.dictionary() })
            }
        }

        AsyncFunction("setFavorite") { identityIds: List<String>, favorite: Boolean, promise: Promise ->
            perform(promise) {
                requireEngine().setFavorite(identityIds.map { IdentityIdDto(it) }, favorite)
                snapshot(requireEngine().loadCachedLibrary())
            }
        }

        AsyncFunction("createCollection") { input: FolioCollectionInput, promise: Promise ->
            perform(promise) {
                requireEngine().createCollectionWithIcon(input.name, input.icon, input.color)
                snapshot(requireEngine().loadCachedLibrary())
            }
        }

        AsyncFunction("updateCollection") { id: String, input: FolioCollectionInput, promise: Promise ->
            perform(promise) {
                requireEngine().updateCollection(CollectionIdDto(id), input.name, input.icon, input.color)
                snapshot(requireEngine().loadCachedLibrary())
            }
        }

        AsyncFunction("deleteCollection") { id: String, promise: Promise ->
            perform(promise) {
                requireEngine().deleteCollection(CollectionIdDto(id))
                snapshot(requireEngine().loadCachedLibrary())
            }
        }

        AsyncFunction("setCollectionMembers") { id: String, identityIds: List<String>, member: Boolean, promise: Promise ->
            perform(promise) {
                requireEngine().setCollectionMembers(CollectionIdDto(id), identityIds.map { IdentityIdDto(it) }, member)
                snapshot(requireEngine().loadCachedLibrary())
            }
        }

        AsyncFunction("getSmartFolder") { id: String, promise: Promise ->
            perform(promise) { FolioLibraryMapper.smartFolder(requireEngine().getSmartFolder(SmartFolderIdDto(id))) }
        }

        AsyncFunction("saveSmartFolder") { id: String?, input: FolioSmartInput, promise: Promise ->
            perform(promise) {
                val engine = requireEngine()
                val query = FolioLibraryMapper.conditions(input.query.text, input.query.facets.map { it.kind to it.value })
                val savedId = if (id == null) engine.createSmartFolderWithStyle(input.name, query, input.icon, input.color)
                    else SmartFolderIdDto(id).also { engine.updateSmartFolderWithStyle(it, input.name, query, input.icon, input.color) }
                mapOf("snapshot" to snapshot(engine.loadCachedLibrary()), "target" to mapOf("scope" to "smart", "smartFolderId" to savedId.value))
            }
        }

        AsyncFunction("deleteSmartFolder") { id: String, promise: Promise ->
            perform(promise) {
                requireEngine().deleteSmartFolder(SmartFolderIdDto(id))
                snapshot(requireEngine().loadCachedLibrary())
            }
        }

        AsyncFunction("convertCollectionToSmart") { id: String, input: FolioSmartInput, promise: Promise ->
            perform(promise) {
                val engine = requireEngine()
                val query = FolioLibraryMapper.conditions(input.query.text, input.query.facets.map { it.kind to it.value })
                val savedId = engine.convertCollectionToSmartFolder(CollectionIdDto(id), input.name, query, input.icon, input.color)
                mapOf("snapshot" to snapshot(engine.loadCachedLibrary()), "target" to mapOf("scope" to "smart", "smartFolderId" to savedId.value))
            }
        }

        AsyncFunction("convertSmartToCollection") { id: String, input: FolioCollectionInput, promise: Promise ->
            perform(promise) {
                val engine = requireEngine()
                val saved = engine.convertSmartFolderToCollection(SmartFolderIdDto(id), input.name, input.icon, input.color)
                mapOf("snapshot" to snapshot(engine.loadCachedLibrary()), "target" to mapOf("scope" to "collection", "collectionId" to saved.id.value))
            }
        }

        AsyncFunction("recordRecent") { id: String, promise: Promise ->
            perform(promise) {
                requireEngine().recordRecent(IdentityIdDto(id))
                snapshot(requireEngine().loadCachedLibrary())
            }
        }

        AsyncFunction("syncState") { promise: Promise -> performSync(promise) { syncState() } }

        AsyncFunction("testSyncConnection") { profile: FolioSyncProfile, password: String?, promise: Promise ->
            performSync(promise) {
                requireSyncIdle()
                syncEngine().testConnection(profile.dto(), password(password, profile.dto()))
            }
        }
        AsyncFunction("saveSyncConnection") { profile: FolioSyncProfile, password: String?, promise: Promise ->
            performSync(promise) {
                val sync = syncEngine()
                requireSyncIdle()
                val dto = profile.dto()
                val secret = password(password, dto)
                sync.testConnection(dto, secret)
                val credentials = FolioSyncCredentials(context())
                val previous = runCatching { credentials.read(dto) }.getOrNull()
                credentials.write(secret, dto)
                try { sync.saveProfile(dto) }
                catch (error: Exception) { credentials.write(previous, dto); throw error }
            }
        }
        AsyncFunction("disconnectSync") { promise: Promise ->
            performSync(promise) {
                val sync = syncEngine()
                requireSyncIdle()
                sync.profile()?.let { profile ->
                    val credentials = FolioSyncCredentials(context())
                    val previous = runCatching { credentials.read(profile) }.getOrNull()
                    credentials.write(null, profile)
                    try { sync.disconnect() }
                    catch (error: Exception) { credentials.write(previous, profile); throw error }
                }
            }
        }
        AsyncFunction("startSync") { promise: Promise ->
            performSync(promise) {
                val sync = syncEngine()
                synchronized(lifecycleLock) {
                    if (!foreground) throw CodedException("ERR_FOLIO_BUSY", "ERR_FOLIO_BUSY", null)
                    if (sync.status().isRunning) false else {
                        val profile = checkNotNull(sync.profile())
                        val secret = password(null, profile)
                        sync.prepareManagedSources()
                        sync.startSync(secret)
                    }
                }
            }
        }
        AsyncFunction("setAutomaticDownload") { enabled: Boolean, promise: Promise -> performSync(promise) { syncEngine().setAutomaticDownload(enabled) } }
        AsyncFunction("cancelSync") { promise: Promise -> performSync(promise) { syncEngine().cancel() } }

        AsyncFunction("cloudFontAction") { fingerprint: String, action: String, promise: Promise ->
            performSync(promise) {
                when (action) {
                    "cloudOnly" -> syncEngine().setCloudOnly(fingerprint)
                    "download" -> syncEngine().restoreCloudFont(fingerprint)
                    "delete" -> syncEngine().deleteEverywhere(fingerprint)
                    "restore" -> syncEngine().restoreDeletedFont(fingerprint)
                    "excludeUpload" -> syncEngine().setUploadExcluded(fingerprint,true)
                    "includeUpload" -> syncEngine().setUploadExcluded(fingerprint,false)
                    else -> throw IllegalArgumentException()
                }
            }
        }
        AsyncFunction("resolveSyncConflict") { id: String, resolution: String, promise: Promise ->
            performSync(promise) {
                val value = when (resolution) {
                    "keepBoth" -> com.folio.poc.ffi.SyncResolutionDto.KEEP_BOTH
                    "useLocal" -> com.folio.poc.ffi.SyncResolutionDto.USE_LOCAL
                    "useRemote" -> com.folio.poc.ffi.SyncResolutionDto.USE_REMOTE
                    else -> throw IllegalArgumentException()
                }
                syncEngine().resolveConflict(id, value)
            }
        }
        OnActivityEntersForeground {
            synchronized(lifecycleLock) { foreground = true }
            updateExecutor.execute { FolioUpdater.resumePermission(context()) }
            launchUpdate(true)
        }
        OnActivityEntersBackground {
            synchronized(lifecycleLock) { foreground = false }
            executor.execute { sync?.cancel() }
        }

        AsyncFunction("storageUsage") { promise: Promise ->
            perform(promise) {
                val usage = syncEngine().storageUsage()
                mapOf(
                    "databaseBytes" to usage.databaseBytes.toDouble(),
                    "managedFontBytes" to usage.managedFontBytes.toDouble(),
                    "volumeTotalBytes" to usage.volumeTotalBytes.toDouble(),
                    "volumeFreeBytes" to usage.volumeFreeBytes.toDouble(),
                    "catalogCacheEntries" to usage.catalogCacheEntries.toDouble(),
                    "catalogCacheEstimatedBytes" to usage.catalogCacheEstimatedBytes.toDouble(),
                )
            }
        }

        AsyncFunction("clearCatalogCache") { promise: Promise ->
            perform(promise) { syncEngine().clearCatalogCache().toDouble() }
        }

        AsyncFunction("rebuildSyncIndexes") { promise: Promise ->
            perform(promise) { syncEngine().rebuildSyncIndexes() }
        }

        AsyncFunction("previewCacheBytes") { promise: Promise ->
            perform(promise) { FolioOnline.open(previewCacheDirectory().absolutePath).previewCacheBytes().toDouble() }
        }

        AsyncFunction("clearPreviewCache") { promise: Promise ->
            perform(promise) { syncEngine().clearPreviewCache(previewCacheDirectory().absolutePath).toDouble() }
        }

        AsyncFunction("copyText") { text: String ->
            val clipboard = context().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("字体名称", text))
        }

        OnDestroy {
            updateExecutor.shutdown()
            characterExecutor.shutdown()
            executor.execute {

            }
            executor.shutdown()
        }

        View(FolioFontPreview::class) {
            Events("onStatus", "onTextChange")
            Prop("editable") { view: FolioFontPreview, value: Boolean -> view.editable = value }
            Prop("tintColor") { view: FolioFontPreview, value: String -> view.editorTintColor = value }
            Prop("mostRecentTextEventCount") { view: FolioFontPreview, value: Int -> view.mostRecentTextEventCount = value }
            Prop("selection") { view: FolioFontPreview, selection: FolioPreviewSelection ->
                view.selection = selection
            }
            OnViewDidUpdateProps { view: FolioFontPreview -> view.renderSelection() }
        }
    }

    private fun performUpdate(promise: Promise, action: () -> Any) {
        try {
            updateExecutor.execute {
                try { promise.resolve(action()) }
                catch (cause: Exception) { promise.reject("softwareUpdate.errors.download", cause.message, cause) }
            }
        } catch (cause: RejectedExecutionException) { promise.reject("softwareUpdate.errors.download", cause.message, cause) }
    }

    private fun launchUpdate(automatic: Boolean, promise: Promise? = null) {
        try {
            updateExecutor.execute {
                try {
                    if (!foreground || automatic && FolioUpdater.state(context())["autoInstall"] != true) {
                        promise?.resolve(null)
                        return@execute
                    }
                    if (automatic && FolioUpdater.state(context())["status"] != "ready") {
                        promise?.resolve(null)
                        return@execute
                    }
                    val intent = FolioUpdater.installIntent(context())
                    android.os.Handler(android.os.Looper.getMainLooper()).post {
                        try {
                            val activity = appContext.currentActivity
                            if (!foreground || activity == null || activity.isFinishing) {
                                updateExecutor.execute { FolioUpdater.deferInstall(context()) }
                                throw IllegalStateException("softwareUpdate.errors.foreground")
                            }
                            activity.startActivity(intent)
                            promise?.resolve(null)
                        } catch (cause: Exception) { promise?.reject("softwareUpdate.errors.install", cause.message, cause) }
                    }
                } catch (cause: Exception) { promise?.reject("softwareUpdate.errors.install", cause.message, cause) }
            }
        } catch (cause: RejectedExecutionException) { promise?.reject("softwareUpdate.errors.install", cause.message, cause) }
    }

    private fun context() = appContext.reactContext
        ?: throw CodedException("ERR_FOLIO_NOT_READY", "字体库尚未就绪。", null)

    private fun requireEngine() = engine
        ?: throw CodedException("ERR_FOLIO_NOT_READY", "字体库尚未就绪。", null)

    // 存储维护与同步共用同一实例及运行状态。
    private fun rootDirectory(): File {
        val root = File(context().filesDir, "FolioMobilePoC")
        check(root.isDirectory || root.mkdirs())
        return root
    }

    private fun syncEngine(): FolioSync {
        return FolioFileRuntime.get(context()).sync
    }

    private fun requireSyncIdle() {
        if (syncEngine().status().isRunning) throw CodedException("ERR_FOLIO_BUSY", "ERR_FOLIO_BUSY", null)
    }

    private fun password(supplied: String?, profile: com.folio.poc.ffi.SyncProfileDto): String {
        if (!supplied.isNullOrEmpty()) return supplied
        return try { FolioSyncCredentials(context()).read(profile)?.takeIf { it.isNotEmpty() }
            ?: throw IllegalStateException() }
        catch (_: Exception) { throw CodedException("ERR_FOLIO_CREDENTIALS", "ERR_FOLIO_CREDENTIALS", null) }
    }

    private fun syncState(): Map<String, Any?> {
        val sync = syncEngine()
        val status = sync.status()
        val profile = sync.profile()
        var credentialError = false
        val available = try { profile?.let { FolioSyncCredentials(context()).read(it) != null } ?: false }
            catch (_: Exception) { credentialError = true; false }
        return mapOf("automaticDownload" to sync.automaticDownload(),"profile" to profile?.let { mapOf("serverUrl" to it.serverUrl, "remoteDirectory" to it.remoteDirectory,
            "username" to it.username, "automatic" to it.automatic) }, "credentialAvailable" to available, "credentialError" to credentialError,
            "status" to mapOf("phase" to status.phase, "stage" to status.stage, "percent" to status.percent.toInt(),
                "stageCompleted" to status.stageCompleted.toDouble(), "stageTotal" to status.stageTotal.toDouble(),
                "isRunning" to status.isRunning, "uploadedFiles" to status.uploadedFiles.toDouble(),
                "downloadedFiles" to status.downloadedFiles.toDouble(), "uploadedBytes" to status.uploadedBytes.toDouble(),
                "downloadedBytes" to status.downloadedBytes.toDouble(), "completionGeneration" to status.completionGeneration.toDouble(),
                "lastSyncedAtMs" to status.lastSyncedAtMs?.toDouble(), "errorMessage" to status.errorMessage,
                "items" to status.items.map { mapOf("fingerprint" to it.fingerprint, "action" to it.action, "status" to it.status) }),
            "conflicts" to sync.conflicts().map { mapOf("id" to it.id, "kind" to it.kind, "title" to it.title, "detail" to it.detail, "localFingerprint" to it.localFingerprint, "remoteFingerprint" to it.remoteFingerprint) },
            "fonts" to sync.cloudFonts().map { mapOf("fingerprint" to it.fingerprint, "displayName" to it.displayName,
                "filename" to it.filename, "fileSize" to it.fileSize.toDouble(), "cloudOnly" to it.cloudOnly,
                "deleted" to it.deleted, "localPath" to it.localPath, "identityIds" to it.identityIds,
                "localAvailable" to (!it.cloudOnly && !it.deleted)) })
    }

    // 同步错误不附带凭据或原生异常对象。
    private fun performSync(promise: Promise, action: () -> Any?) {
        try {
            executor.execute {
                try { promise.resolve(action()) }
                catch (error: Exception) {
                    val code = if (error is CodedException) error.code else "ERR_FOLIO_SYNC"
                    val detail = if (error is com.folio.poc.ffi.FolioFfiException.Operation) error.detail else code
                    promise.reject(code, detail, null)
                }
            }
        } catch (_: RejectedExecutionException) { promise.reject("ERR_FOLIO_NOT_READY", "ERR_FOLIO_NOT_READY", null) }
    }

    private fun previewCacheDirectory() = File(rootDirectory(), "previews")

    private fun snapshot(value: LibrarySnapshotDto) = FolioLibraryMapper.snapshot(value)

    private fun perform(promise: Promise, action: () -> Any) {
        try {
            executor.execute {
                try {
                    promise.resolve(action())
                } catch (error: Exception) {
                    if (error is FontImportFailure) promise.reject("ERR_FOLIO_IMPORT", error.detail, error)
                    else if (error is CodedException) promise.reject(error)
                    else promise.reject("ERR_FOLIO_OPERATION", "暂时无法完成字体操作，请重试。", error)
                }
            }
        } catch (error: RejectedExecutionException) {
            promise.reject("ERR_FOLIO_NOT_READY", "字体库尚未就绪。", error)
        }
    }

    private fun performCharacterMap(promise: Promise, action: () -> Any?) {
        try {
            characterExecutor.execute {
                try { promise.resolve(action()) }
                catch (error: Exception) {
                    val detail = if (error is com.folio.poc.ffi.FolioFfiException.Operation) error.detail else "characterMap.error.renderFailed"
                    promise.reject("ERR_FOLIO_CHARACTER_MAP", detail, null)
                }
            }
        } catch (_: RejectedExecutionException) {
            promise.reject("ERR_FOLIO_CHARACTER_MAP", "characterMap.error.sessionClosed", null)
        }
    }
}
