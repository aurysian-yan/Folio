package com.folio.poc.navigation

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.kyant.backdrop.Backdrop
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

// 原生导航自持动画，React 只接收已提交的目的地。
class FolioLiquidTabsView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    var sourceId by mutableStateOf("")
    var selectedId by mutableStateOf("local")
    var dark by mutableStateOf(false)
    var items by mutableStateOf(emptyList<FolioNavigationItem>())
    private val onSelectionChange by EventDispatcher()
    private val compose = ComposeView(context)

    init {
        clipChildren = false
        clipToPadding = false
        compose.setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool)
        addView(compose, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        compose.setContent {
            val backdrop = FolioBackdropSources.sources[FolioBackdropSources.key(appContext, sourceId)] ?: EmptyNavigationBackdrop
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                if (items.isNotEmpty()) {
                    LiquidBottomTabs(
                        selectedTabIndex = { items.indexOfFirst { it.id == selectedId }.coerceAtLeast(0) },
                        onTabSelected = { index ->
                            items.getOrNull(index)?.let { item ->
                                if (item.id != selectedId) {
                                    selectedId = item.id
                                    onSelectionChange(mapOf("id" to item.id))
                                }
                            }
                        },
                        backdrop = backdrop,
                        tabsCount = items.size,
                        dark = dark,
                        modifier = Modifier.fillMaxWidth().height(56.dp).drawWithContent {
                            backdrop.contentVersion
                            drawContent()
                        }
                    ) {
                        items.forEach { item ->
                            LiquidBottomTab(selected = selectedId == item.id,
                                label = item.label, onClick = {
                                    if (item.id != selectedId) {
                                        selectedId = item.id
                                        onSelectionChange(mapOf("id" to item.id))
                                    }
                                }) {
                                FolioTabContent(item.icon, item.label, dark)
                            }
                        }
                    }
                }
            }
        }
    }

    override fun onAttachedToWindow() {
        val activity = appContext.currentActivity
        (activity as? LifecycleOwner)?.let { setViewTreeLifecycleOwner(it) }
        (activity as? SavedStateRegistryOwner)?.let { setViewTreeSavedStateRegistryOwner(it) }
        super.onAttachedToWindow()
    }
}

internal object EmptyNavigationBackdrop : Backdrop {
    override val isCoordinatesDependent = false
    override fun DrawScope.drawBackdrop(density: Density, coordinates: LayoutCoordinates?, layerBlock: (GraphicsLayerScope.() -> Unit)?) = Unit
}
