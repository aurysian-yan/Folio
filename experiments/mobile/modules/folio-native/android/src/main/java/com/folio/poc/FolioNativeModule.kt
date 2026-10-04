package com.folio.poc

import android.net.Uri
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
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
    @Field var sourcePath: String = ""
    @Field var faceIndex: Int = 0
    @Field var revisionId: String = ""
    @Field var axes: Map<String, Double> = emptyMap()
    @Field var text: String = ""
    @Field var fontSize: Double = 32.0
    @Field var centered: Boolean = false
    @Field var wrapWidth: Double = 0.0
}

class FolioNativeModule : Module() {
    private val executor = Executors.newSingleThreadExecutor()
    private var engine: FolioEngine? = null
    private var sync: FolioSync? = null
    private val lifecycleLock = Any()
    private var foreground = true

    override fun definition() = ModuleDefinition {
        Name("FolioNative")

        AsyncFunction("initialize") { promise: Promise ->
            perform(promise) {
                if (engine == null) {
                    val root = File(context().filesDir, "FolioMobilePoC")
                    check(root.isDirectory || root.mkdirs())
                    engine = FolioEngine.open(File(root, "folio.sqlite").absolutePath)
                }
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
                    request.smartFolderId, request.facets.map { it.kind to it.value }, request.offset, request.limit))
            }
        }

        AsyncFunction("importFonts") { files: List<FolioImportFile>, promise: Promise ->
            perform(promise) {
                requireSyncIdle()
                val importer = FolioFontImporter(requireEngine(), File(context().filesDir, "FolioMobilePoC"), { uri ->
                    val source = Uri.parse(uri)
                    if (source.scheme !in listOf("file", "content")) throw FontImportFailure("请选择可读取的字体文件。")
                    context().contentResolver.openInputStream(source) ?: throw FontImportFailure("无法读取文件，请确认文件可用。")
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
        AsyncFunction("cancelSync") { promise: Promise -> performSync(promise) { syncEngine().cancel() } }

        AsyncFunction("cloudFontAction") { fingerprint: String, action: String, promise: Promise ->
            performSync(promise) {
                when (action) {
                    "cloudOnly" -> syncEngine().setCloudOnly(fingerprint)
                    "download" -> syncEngine().restoreCloudFont(fingerprint)
                    "delete" -> syncEngine().deleteEverywhere(fingerprint)
                    "restore" -> syncEngine().restoreDeletedFont(fingerprint)
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
        OnActivityEntersForeground { synchronized(lifecycleLock) { foreground = true } }
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
            executor.execute {
                sync?.cancel()
                sync?.destroy()
                sync = null
                engine?.destroy()
                engine = null
            }
            executor.shutdown()
        }

        View(FolioFontPreview::class) {
            Events("onStatus")
            Prop("selection") { view: FolioFontPreview, selection: FolioPreviewSelection ->
                view.selection = selection
            }
            OnViewDidUpdateProps { view: FolioFontPreview -> view.renderSelection() }
        }
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
        sync?.let { return it }
        FolioTls.initialize(context().applicationContext)
        return FolioSync.open(File(rootDirectory(), "folio.sqlite").absolutePath,
            File(rootDirectory(), "fonts").absolutePath).also { sync = it }
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
        return mapOf("profile" to profile?.let { mapOf("serverUrl" to it.serverUrl, "remoteDirectory" to it.remoteDirectory,
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
                "localAvailable" to (!it.cloudOnly && !it.deleted && it.localPath?.let { path -> File(path).canRead() } == true)) })
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
}
