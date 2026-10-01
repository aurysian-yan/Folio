package com.folio.poc

import com.folio.poc.ffi.FolioEngine
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files

// 使用生产映射器验证真实 Rust 查询与手动收藏夹边界。
class FolioLibraryMapperTest {
    private val samples = File(requireNotNull(System.getProperty("folio.samples")))

    @Test fun filtersAndCollectionsPersistWithFullIdentities() {
        val root = Files.createTempDirectory("folio-library-test").toFile()
        val path = File(root, "folio.sqlite").absolutePath
        val engine = FolioEngine.open(path)
        try {
            for (name in listOf("Lato-Regular.ttf", "Lato-Bold.ttf", "Inter-Variable.ttf", "SourceSerif4-Regular.otf", "Lato-Collection.ttc")) {
                engine.addFontFile(File(samples, name).absolutePath)
            }
            engine.refreshLibrary()
            val all = engine.queryLibrary(query())
            val family = all.families.first { it.displayName == "Lato" }
            val filtered = engine.queryLibrary(query(text = "Lato", facets = listOf("weight" to "400")))
            assertEquals(1L, filtered.totalMatches.toLong())
            assertEquals(family.identityIds, filtered.families.single().identityIds)
            assertTrue(filtered.families.single().matchedFaceIds.size < family.faces.size)
            val either = engine.queryLibrary(query(text = "Lato", facets = listOf("weight" to "400", "weight" to "700")))
            assertTrue(either.families.single().matchedFaceIds.size > filtered.families.single().matchedFaceIds.size)
            assertEquals(0L, engine.queryLibrary(query(text = "Lato", facets = listOf("feature" to "variable"))).totalMatches.toLong())
            val collection = engine.createCollectionWithIcon("移动测试", "books", "blue")
            engine.setCollectionMembers(collection.id, family.identityIds, true)
            engine.setCollectionMembers(collection.id, family.identityIds, true)
            engine.setFavorite(filtered.families.single().identityIds, true)
            val scoped = engine.queryLibrary(query("Lato", "collection", collection.id.value, listOf("weight" to "400")))
            assertTrue(scoped.families.single().isFavorite)
            assertEquals(family.identityIds.size.toLong(), engine.loadCachedLibrary().collections.single().memberCount.toLong())
            engine.updateCollection(collection.id, "改名后的收藏夹", "heart", "purple")
            val reopened = FolioEngine.open(path)
            try {
                val snapshot = reopened.loadCachedLibrary()
                assertEquals("改名后的收藏夹", snapshot.collections.single().name)
                assertEquals("heart", snapshot.collections.single().icon)
                assertEquals("purple", snapshot.collections.single().color)
                val mapped = FolioLibraryMapper.page(scoped)
                val mappedFamilies = mapped["families"] as List<*>
                assertEquals(family.identityIds.map { it.value }, (mappedFamilies.single() as Map<*, *>)["identityIds"])
                assertTrue((mapped["facets"] as List<*>).isNotEmpty())
                assertTrue((FolioLibraryMapper.snapshot(snapshot)["collections"] as List<*>).isNotEmpty())
                reopened.setCollectionMembers(collection.id, family.identityIds, false)
                assertEquals(0L, reopened.queryLibrary(query(scope = "collection", id = collection.id.value)).totalMatches.toLong())
                reopened.deleteCollection(collection.id)
                assertTrue(reopened.loadCachedLibrary().collections.isEmpty())
                assertTrue(reopened.queryLibrary(query(scope = "favorites")).families.any { it.id == family.id })
                assertEquals(all.totalMatches, reopened.queryLibrary(query()).totalMatches)
            } finally { reopened.destroy() }
        } finally { engine.destroy(); root.deleteRecursively() }
    }

    @Test fun allFacetKindsAndInvalidRequestsAreMapped() {
        for (kind in listOf("category", "script", "foundry", "license", "weight", "width", "feature", "state", "multipleVariants")) {
            assertEquals("value", query(facets = listOf(kind to "value")).facets.single().value)
        }
        for (invalid in listOf(
            { query(scope = "collection") }, { query(id = "unexpected") }, { query(scope = "unknown") },
            { query(facets = listOf("unknown" to "x")) }, { query(facets = listOf("weight" to "")) },
            { query(offset = -1) }, { query(limit = 101) }, { query(limit = 0) }
        )) {
            try { invalid(); fail("非法查询必须拒绝") } catch (_: IllegalArgumentException) { }
        }
    }

    private fun query(text: String = "", scope: String = "all", id: String? = null,
        facets: List<Pair<String, String>> = emptyList(), offset: Long = 0, limit: Int = 100) =
        FolioLibraryMapper.query(text, scope, id, facets, offset, limit)
}
