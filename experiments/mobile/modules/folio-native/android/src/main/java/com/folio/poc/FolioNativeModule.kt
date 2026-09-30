package com.folio.poc

import android.net.Uri
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import com.folio.poc.ffi.FolioEngine
import com.folio.poc.ffi.IdentityIdDto
import com.folio.poc.ffi.LibraryQueryDto
import com.folio.poc.ffi.LibrarySnapshotDto
import com.folio.poc.ffi.QueryScopeDto
import com.folio.poc.ffi.RootIdDto
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

class FolioQuery : Record {
    @Field var text: String = ""
    @Field var scope: String = "all"
    @Field var offset: Long = 0
    @Field var limit: Int = 40
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
                snapshot(requireEngine().loadCachedLibrary())
            }
        }

        AsyncFunction("query") { request: FolioQuery, promise: Promise ->
            perform(promise) {
                if (request.offset < 0 || request.limit !in 1..100) {
                    throw CodedException("ERR_FOLIO_QUERY", "查询范围无效。", null)
                }
                val scope = when (request.scope) {
                    "all" -> QueryScopeDto.ALL
                    "favorites" -> QueryScopeDto.FAVORITES
                    "recent" -> QueryScopeDto.RECENT
                    else -> throw CodedException("ERR_FOLIO_QUERY", "查询范围无效。", null)
                }
                val page = requireEngine().queryLibrary(LibraryQueryDto(
                    text = request.text.takeIf { it.isNotEmpty() }, scope = scope, collectionId = null,
                    facets = emptyList(), allowedFaceIds = null, allowedSourcePaths = null,
                    offset = request.offset.toULong(), limit = request.limit.toULong()
                ))
                mapOf("totalMatches" to page.totalMatches.toDouble(), "families" to page.families.map { family ->
                    mapOf("id" to family.id.value, "displayName" to family.displayName,
                        "isFavorite" to family.isFavorite, "faces" to family.faces.map { face ->
                            mapOf("id" to face.id.value, "identityId" to face.identityId.value,
                                "revisionId" to face.revisionId, "styleName" to face.styleName,
                                "sourcePath" to face.sourcePath, "faceIndex" to face.faceIndex.toLong(),
                                "axes" to face.axes.map { axis ->
                                    mapOf("tag" to axis.tag, "name" to axis.name, "minimum" to axis.minValue,
                                        "defaultValue" to axis.defaultValue, "maximum" to axis.maxValue)
                                })
                        })
                })
            }
        }

        AsyncFunction("importFont") { uri: String, promise: Promise ->
            perform(promise) {
                val library = requireEngine()
                val source = Uri.parse(uri)
                if (source.scheme !in listOf("file", "content")) {
                    throw CodedException("ERR_FOLIO_IMPORT", "请选择本地字体文件。", null)
                }
                val directory = File(context().filesDir, "FolioMobilePoC/fonts")
                check(directory.isDirectory || directory.mkdirs())
                val destination = File(directory, UUID.randomUUID().toString() + ".font")
                var rootID: RootIdDto? = null
                try {
                    context().contentResolver.openInputStream(source).use { input ->
                        requireNotNull(input) { "字体文件不可用。" }
                        destination.outputStream().use { output -> input.copyTo(output) }
                    }
                    library.validateFontFile(destination.absolutePath)
                    rootID = library.addFontFile(destination.absolutePath).id
                    snapshot(library.refreshLibrary().snapshot)
                } catch (error: Exception) {
                    rootID?.let { runCatching { library.removeLibraryRoot(it) } }
                    destination.delete()
                    throw error
                }
            }
        }

        AsyncFunction("setFavorite") { identityIds: List<String>, favorite: Boolean, promise: Promise ->
            perform(promise) {
                requireEngine().setFavorite(identityIds.map { IdentityIdDto(it) }, favorite)
            }
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

    private fun snapshot(value: LibrarySnapshotDto) = mapOf(
        "familyCount" to value.familyCount.toDouble(), "faceCount" to value.faceCount.toDouble(),
        "variableFamilyCount" to value.variableFamilyCount.toDouble(), "recentCount" to value.recentCount.toDouble(),
        "damagedCount" to value.health.damagedFiles.toDouble()
    )

    private fun perform(promise: Promise, action: () -> Any) {
        try {
            executor.execute {
                try {
                    promise.resolve(action())
                } catch (error: Exception) {
                    if (error is CodedException) promise.reject(error)
                    else promise.reject("ERR_FOLIO_OPERATION", "暂时无法完成字体操作，请重试。", error)
                }
            }
        } catch (error: RejectedExecutionException) {
            promise.reject("ERR_FOLIO_NOT_READY", "字体库尚未就绪。", error)
        }
    }
}
