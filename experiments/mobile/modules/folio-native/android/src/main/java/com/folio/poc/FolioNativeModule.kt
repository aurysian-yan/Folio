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
}

class FolioNativeModule : Module() {
    private val executor = Executors.newSingleThreadExecutor()
    private var engine: FolioEngine? = null

    override fun definition() = ModuleDefinition {
        Name("FolioNative")

        AsyncFunction("initialize") { promise: Promise ->
            perform(promise) {
                if (engine == null) {
                    val root = File(context().filesDir, "FolioMobilePoC")
                    check(root.isDirectory || root.mkdirs())
                    engine = FolioEngine.open(File(root, "folio.sqlite").absolutePath)
                }
                snapshot(requireEngine().refreshLibrary().snapshot)
            }
        }

        AsyncFunction("snapshot") { promise: Promise ->
            perform(promise) { snapshot(requireEngine().loadCachedLibrary()) }
        }

        AsyncFunction("query") { request: FolioQuery, promise: Promise ->
            perform(promise) {
                FolioLibraryMapper.page(FolioLibraryMapper.read(requireEngine(), request.text, request.scope, request.collectionId,
                    request.smartFolderId, request.facets.map { it.kind to it.value }, request.offset, request.limit))
            }
        }

        AsyncFunction("importFonts") { files: List<FolioImportFile>, promise: Promise ->
            perform(promise) {
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

    // 存储统计与缓存清理复用同步引擎，按需打开、用完即释放。
    private fun rootDirectory(): File {
        val root = File(context().filesDir, "FolioMobilePoC")
        check(root.isDirectory || root.mkdirs())
        return root
    }

    private fun syncEngine() = FolioSync.open(
        File(rootDirectory(), "folio.sqlite").absolutePath,
        File(rootDirectory(), "fonts").absolutePath,
    )

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
