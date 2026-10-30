package com.folio.poc.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.size
import androidx.compose.ui.unit.dp

// 图标按业务语义映射，M3E 不复用玻璃主题的 SF 图形。
@Composable internal fun FolioMaterialIcon(name: String) {
    val vector = when (name) {
        "local", "text-aa", "house" -> Icons.Default.Home
        "search", "magnifyingglass" -> Icons.Default.Search
        "online", "globe", "safari" -> Icons.Default.Language
        "cloud" -> Icons.Default.Cloud
        "settings", "gear" -> Icons.Default.Settings
        "grid", "square.grid.2x2" -> Icons.Default.GridView
        "list", "list.bullet" -> Icons.AutoMirrored.Filled.List
        "filter", "line.3.horizontal.decrease" -> Icons.Default.FilterList
        "plus" -> Icons.Default.Add
        "check", "checkmark" -> Icons.Default.Check
        "caret", "chevron.down" -> Icons.Default.ArrowDropDown
        "chevron.left" -> Icons.AutoMirrored.Filled.ArrowBack
        "xmark" -> Icons.Default.Close
        "star", "star-fill", "bookmarks", "bookmark" -> Icons.Default.Star
        "clock", "history" -> Icons.Default.History
        "download", "downloads", "arrow.down.circle", "arrow.down.to.line" -> Icons.Default.Download
        "folder-plus" -> Icons.Default.CreateNewFolder
        "reset" -> Icons.Default.RestartAlt
        "trash" -> Icons.Default.Delete
        "pencil" -> Icons.Default.Edit
        else -> Icons.Default.MoreVert
    }
    Icon(vector, contentDescription = null, modifier = Modifier.size(24.dp))
}
