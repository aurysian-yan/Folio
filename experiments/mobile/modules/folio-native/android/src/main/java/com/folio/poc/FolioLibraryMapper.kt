package com.folio.poc

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
            }, null, null, offset.toULong(), limit.toULong())
    }

    fun page(page: LibraryPageDto): Map<String, Any> = mapOf(
        "totalMatches" to page.totalMatches.toDouble(), "unresolvedScopeItems" to page.unresolvedScopeItems.toDouble(),
        "facets" to page.facets.map { facet -> mapOf("kind" to facetKey(facet.kind), "value" to facet.value,
            "label" to facet.label, "familyCount" to facet.familyCount.toDouble()) },
        "families" to page.families.map { family ->
            mapOf("id" to family.id.value, "displayName" to family.displayName, "isFavorite" to family.isFavorite,
                "identityIds" to family.identityIds.map { it.value }, "matchedFaceIds" to family.matchedFaceIds.map { it.value },
                "faces" to family.faces.map { face ->
                    mapOf("id" to face.id.value, "identityId" to face.identityId.value, "revisionId" to face.revisionId,
                        "styleName" to face.styleName, "sourcePath" to face.sourcePath, "faceIndex" to face.faceIndex.toLong(),
                        "axes" to face.axes.map { axis -> mapOf("tag" to axis.tag, "name" to axis.name,
                            "minimum" to axis.minValue, "defaultValue" to axis.defaultValue, "maximum" to axis.maxValue) })
                })
        })

    fun snapshot(value: LibrarySnapshotDto): Map<String, Any> = mapOf(
        "familyCount" to value.familyCount.toDouble(), "faceCount" to value.faceCount.toDouble(),
        "variableFamilyCount" to value.variableFamilyCount.toDouble(), "recentCount" to value.recentCount.toDouble(),
        "damagedCount" to value.health.damagedFiles.toDouble(), "collections" to value.collections.map { collection ->
            mapOf("id" to collection.id.value, "name" to collection.name, "icon" to collection.icon,
                "color" to collection.color, "memberCount" to collection.memberCount.toDouble())
        })

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
