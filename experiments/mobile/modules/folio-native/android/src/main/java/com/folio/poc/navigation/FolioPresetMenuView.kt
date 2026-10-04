package com.folio.poc.navigation

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.unit.dp
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class FolioPresetMenuLabels : Record {
    @Field var title: String = ""
    @Field var expanded: String = ""
    @Field var collapsed: String = ""
}

// 设置地址入口只桥接预设值，弹层交给主页共用控件。
class FolioPresetMenuView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    var sourceId by mutableStateOf("")
    var selectedId by mutableStateOf("none")
    var disabled by mutableStateOf(false)
    var dark by mutableStateOf(false)
    var colors by mutableStateOf<FolioViewMenuColors?>(null)
    var labels by mutableStateOf<FolioPresetMenuLabels?>(null)
    var items by mutableStateOf(emptyList<FolioNavigationItem>())
    private var expanded by mutableStateOf(false)
    private val onSelectionChange by EventDispatcher()
    private val onExpandedChange by EventDispatcher()
    private val compose = ComposeView(context)

    init {
        clipChildren = false
        clipToPadding = false
        compose.setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool)
        addView(compose, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        compose.setContent {
            val palette = colors ?: return@setContent
            val text = labels ?: return@setContent
            val backdrop = FolioBackdropSources.sources[FolioBackdropSources.key(appContext, sourceId)] ?: EmptyNavigationBackdrop
            LaunchedEffect(disabled) { if (disabled) updateExpanded(false) }
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                FolioGlassMenu(selectedId, expanded, !disabled, dark, palette, backdrop,
                    items, text.title, text.title, text.expanded, text.collapsed,
                    onExpandedChange = ::updateExpanded,
                    onSelect = { id ->
                        if (!disabled && expanded && items.any { it.id == id }) {
                            onSelectionChange(mapOf("id" to id))
                            updateExpanded(false)
                        }
                    }, modifier = Modifier.fillMaxSize(), triggerBackdrop = EmptyNavigationBackdrop) { progress ->
                    ViewMenuIcon("caret", Color(android.graphics.Color.parseColor(palette.secondary)), 20.dp,
                        Modifier.graphicsLayer { rotationZ = 180f * progress; alpha = if (disabled) 0.4f else 1f })
                }
            }
        }
    }

    private fun updateExpanded(value: Boolean) {
        if (expanded == value) return
        expanded = value
        onExpandedChange(mapOf("expanded" to value))
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        if (!isAttachedToWindow) {
            setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
            return
        }
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        if (isAttachedToWindow) super.onLayout(changed, left, top, right, bottom)
    }

    override fun onAttachedToWindow() {
        val activity = appContext.currentActivity
        (activity as? LifecycleOwner)?.let { setViewTreeLifecycleOwner(it) }
        (activity as? SavedStateRegistryOwner)?.let { setViewTreeSavedStateRegistryOwner(it) }
        super.onAttachedToWindow()
        requestLayout()
    }

    override fun onDetachedFromWindow() { expanded = false; super.onDetachedFromWindow() }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility != VISIBLE) updateExpanded(false)
    }
}
