package com.folio.poc

import com.folio.poc.ffi.FolioEngine
import com.folio.poc.ffi.SmartFolderDto
import com.folio.poc.ffi.SmartFolderIdDto
import com.folio.poc.ffi.SmartFolderQueryDto
import com.folio.poc.ffi.CollectionIdDto
import com.folio.poc.ffi.FacetKindDto
import com.folio.poc.ffi.FacetSelectionDto
import com.folio.poc.ffi.LibraryPageDto
import com.folio.poc.ffi.LibraryQueryDto
import com.folio.poc.ffi.LibrarySnapshotDto
import com.folio.poc.ffi.QueryScopeDto

// 移动查询与返回值统一映射到既有 Rust 契约。
internal object FolioLibraryMapper {
    fun query(text: String, scope: String, collectionId: String?, facets: List<Pair<String, String>>,
        offset: Long, limit: Int): LibraryQueryDto {
        require(offset >= 0 && limit in 1..100)
        require(if (scope == "collection") !collectionId.isNullOrBlank() else collectionId == null)
        val queryScope = when (scope) {
            "all" -> QueryScopeDto.ALL
            "favorites" -> QueryScopeDto.FAVORITES
            "recent" -> QueryScopeDto.RECENT
            "collection" -> QueryScopeDto.COLLECTION
            else -> throw IllegalArgumentException("查询范围无效。")
        }
        return LibraryQueryDto(text.takeIf { it.isNotEmpty() }, queryScope,
            collectionId?.let { CollectionIdDto(it) }, facets.map { (kind, value) ->
                require(value.isNotBlank())
                FacetSelectionDto(facetKind(kind), value)
            }, null, null, null, null, offset.toULong(), limit.toULong())
    }

    fun page(page: LibraryPageDto): Map<String, Any> = mapOf(
        "totalMatches" to page.totalMatches.toDouble(), "unresolvedScopeItems" to page.unresolvedScopeItems.toDouble(),
        "facets" to page.facets.map { facet -> mapOf("kind" to facetKey(facet.kind), "value" to facet.value,
            "label" to facet.label, "familyCount" to facet.familyCount.toDouble()) },
        "families" to page.families.map { family ->
            mapOf("id" to family.id.value, "displayName" to family.displayName, "isFavorite" to family.isFavorite,
                "location" to mapOf("state" to family.location.state,"localFaceCount" to family.location.localFaceCount.toDouble(),"totalFaceCount" to family.location.totalFaceCount.toDouble()),
                "identityIds" to family.identityIds.map { it.value }, "matchedFaceIds" to family.matchedFaceIds.map { it.value },
                "faces" to family.faces.map { face ->
                    mapOf("id" to face.id.value, "identityId" to face.identityId.value, "revisionId" to face.revisionId,
                        "styleName" to face.styleName, "sourcePath" to face.sourcePath, "faceIndex" to face.faceIndex.toLong(),
                        "location" to location(face.location), "axes" to face.axes.map { axis -> mapOf("tag" to axis.tag, "name" to axis.name,
                            "minimum" to axis.minValue, "defaultValue" to axis.defaultValue, "maximum" to axis.maxValue) })
                })
        })

    fun location(value: com.folio.poc.ffi.FontLocationDto): Map<String, Any?> = mapOf(
        "state" to value.state,"localAvailable" to value.localAvailable,"cloudAvailable" to value.cloudAvailable,"metadataComplete" to value.metadataComplete,"cloudConfirmedAtMs" to value.cloudConfirmedAtMs?.toDouble(),"files" to value.files.map { file ->
            mapOf("fingerprint" to file.fingerprint,"filename" to file.filename,"fileSize" to file.fileSize.toDouble(),"faceIndex" to file.faceIndex.toLong(),"cloudAvailable" to file.cloudAvailable,"uploadExcluded" to file.uploadExcluded,"downloadPolicy" to file.downloadPolicy,"transferAction" to file.transferAction,"transferStatus" to file.transferStatus,"transferError" to file.transferError,"localSources" to file.localSources.map { mapOf("path" to it.path,"kind" to it.kind,"previewSource" to it.previewSource) })
        })

    fun snapshot(value: LibrarySnapshotDto): Map<String, Any> = mapOf(
        "familyCount" to value.familyCount.toDouble(), "faceCount" to value.faceCount.toDouble(),
        "variableFamilyCount" to value.variableFamilyCount.toDouble(), "recentCount" to value.recentCount.toDouble(),
        "syncSummary" to mapOf("syncedCount" to value.syncSummary.syncedCount.toDouble(),
            "cloudOnlyCount" to value.syncSummary.cloudOnlyCount.toDouble(), "localOnlyFingerprints" to value.syncSummary.localOnlyFingerprints),
        "health" to mapOf("damagedFiles" to value.health.damagedFiles.toDouble(), "multipleRevisions" to value.health.multipleRevisions.toDouble(),
            "metadataConflicts" to value.health.metadataConflicts.toDouble()),
        "damagedCount" to value.health.damagedFiles.toDouble(), "collections" to value.collections.map { collection ->
            mapOf("id" to collection.id.value, "name" to collection.name, "icon" to collection.icon,
                "color" to collection.color, "memberCount" to collection.memberCount.toDouble())
        }, "smartFolders" to value.smartFolders.map { folder ->
            mapOf("id" to folder.id.value, "name" to folder.name, "icon" to folder.icon,
                "color" to folder.color, "matchCount" to folder.matchCount.toDouble())
        })

    fun smartFolder(folder: SmartFolderDto): Map<String, Any> = mapOf(
        "id" to folder.id.value, "name" to folder.name, "icon" to folder.icon, "color" to folder.color,
        "matchCount" to folder.matchCount.toDouble(), "query" to mapOf("text" to (folder.query.text ?: ""),
            "facets" to folder.query.facets.map { mapOf("kind" to facetKey(it.kind), "value" to it.value) }))

    // 智慧范围交给 Rust 合并保存条件和临时浏览条件。
    fun read(engine: FolioEngine, text: String, scope: String, collectionId: String?, smartFolderId: String?,
        facets: List<Pair<String, String>>, offset: Long, limit: Int, locationFilter: String? = null, fileFingerprint: String? = null): LibraryPageDto {
        require(if (scope == "smart") !smartFolderId.isNullOrBlank() && collectionId == null else smartFolderId == null)
        val request = query(text, if (scope == "smart") "all" else scope, collectionId, facets, offset, limit)
        val located = request.copy(locationFilter=locationFilter,fileFingerprint=fileFingerprint)
        return if (scope == "smart") engine.querySmartFolderWithLocation(SmartFolderIdDto(requireNotNull(smartFolderId)),
            request.text, request.facets, request.offset, request.limit,locationFilter,fileFingerprint) else engine.queryLocalLibrary(located)
    }

    fun conditions(text: String, facets: List<Pair<String, String>>): SmartFolderQueryDto {
        val request = query(text, "all", null, facets, 0, 1)
        return SmartFolderQueryDto(request.text, request.facets)
    }

    private fun facetKind(key: String): FacetKindDto = when (key) {
        "category" -> FacetKindDto.CATEGORY
        "script" -> FacetKindDto.SCRIPT
        "foundry" -> FacetKindDto.FOUNDRY
        "license" -> FacetKindDto.LICENSE
        "weight" -> FacetKindDto.WEIGHT
        "width" -> FacetKindDto.WIDTH
        "feature" -> FacetKindDto.FEATURE
        "state" -> FacetKindDto.STATE
        "multipleVariants" -> FacetKindDto.MULTIPLE_VARIANTS
        else -> throw IllegalArgumentException("筛选条件无效。")
    }

    private fun facetKey(kind: FacetKindDto): String = when (kind) {
        FacetKindDto.CATEGORY -> "category"
        FacetKindDto.SCRIPT -> "script"
        FacetKindDto.FOUNDRY -> "foundry"
        FacetKindDto.LICENSE -> "license"
        FacetKindDto.WEIGHT -> "weight"
        FacetKindDto.WIDTH -> "width"
        FacetKindDto.FEATURE -> "feature"
        FacetKindDto.STATE -> "state"
        FacetKindDto.MULTIPLE_VARIANTS -> "multipleVariants"
    }
}
