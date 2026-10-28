package com.folio.poc.navigation

import android.content.Context
import android.graphics.Matrix
import android.view.ViewTreeObserver
import android.view.ViewGroup
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import io.github.neoruaa.glasmio.icons.LocalGlasmioIconResolver
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import io.github.neoruaa.glasmio.core.GlasmioTheme
import io.github.neoruaa.glasmio.core.defaultGlassColors
import io.github.neoruaa.glasmio.glass.GlasmioBackdropProvider

internal fun String.glassColor(fallback: Color = Color.Unspecified): Color =
    runCatching { Color(android.graphics.Color.parseColor(this)) }.getOrDefault(fallback)

// 顶栏模糊抑制背景文字，图标与玻璃轮廓保持清晰。
internal val FolioHeaderFrostRadius = 24.dp

// 原生控件只在页面采样树之外绘制玻璃，布局锚点仍由 Yoga 管理。
abstract class FolioGlassView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    var sourceId by mutableStateOf("")
    var controlId: String = ""
    var active by mutableStateOf(true)
    var dark by mutableStateOf(false)
    var accentColor by mutableStateOf("")
    var surfaceColor by mutableStateOf("")
    var pageBackgroundColor by mutableStateOf("")
    var controlEnabled by mutableStateOf(true)
    protected val compose = ComposeView(context)
    private var page: FolioBackdropSourceView? = null
    private var samplingRevision by mutableIntStateOf(0)
    private var samplingPosition: List<Float>? = null
    private val preDraw = ViewTreeObserver.OnPreDrawListener {
        val values = FloatArray(9)
        Matrix().also { compose.transformMatrixToGlobal(it); it.getValues(values) }
        val position = values.toList() + listOf(compose.width.toFloat(), compose.height.toFloat())
        if (samplingPosition != position) { samplingPosition = position; samplingRevision++ }
        true
    }

    init {
        clipChildren = false
        clipToPadding = false
        compose.clipChildren = false
        compose.clipToPadding = false
        compose.setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool)
        addView(compose, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        compose.setContent {
            val source = FolioBackdropSources.sources[FolioBackdropSources.key(appContext, sourceId)]
            val backdrop = remember(source) {
                FolioPageBackdrop(source) {
                    samplingRevision
                    pageBackgroundColor.glassColor(defaultGlassColors(dark).groupedBackground)
                }
            }
            val defaults = defaultGlassColors(dark)
            GlasmioTheme(isDark = dark, colors = defaults.copy(
                groupedBackground = pageBackgroundColor.glassColor(defaults.groupedBackground),
                accent = accentColor.glassColor(defaults.accent),
                elevatedBackground = surfaceColor.glassColor(defaults.elevatedBackground),
            )) {
                CompositionLocalProvider(LocalGlasmioIconResolver provides FolioGlassIcons) {
                    GlasmioBackdropProvider(backdrop) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { if (active) GlassContent() }
                    }
                }
            }
        }
    }

    @Composable protected abstract fun GlassContent()

    override fun onAttachedToWindow() {
        val activity = appContext.currentActivity
        (activity as? LifecycleOwner)?.let { setViewTreeLifecycleOwner(it); compose.setViewTreeLifecycleOwner(it) }
        (activity as? SavedStateRegistryOwner)?.let { setViewTreeSavedStateRegistryOwner(it); compose.setViewTreeSavedStateRegistryOwner(it) }
        super.onAttachedToWindow()
        var ancestor = parent
        while (ancestor is android.view.View) {
            if (ancestor is FolioBackdropSourceView) {
                page = ancestor
                (compose.parent as? ViewGroup)?.removeView(compose)
                ancestor.attachGlass(this, compose)
                break
            }
            ancestor = ancestor.parent
        }
        viewTreeObserver.addOnPreDrawListener(preDraw)
        requestLayout()
    }

    override fun onDetachedFromWindow() {
        if (viewTreeObserver.isAlive) viewTreeObserver.removeOnPreDrawListener(preDraw)
        samplingPosition = null
        page?.detachGlass(this)
        page = null
        if (compose.parent !== this) {
            (compose.parent as? ViewGroup)?.removeView(compose)
            addView(compose, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        }
        super.onDetachedFromWindow()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
        if (isAttachedToWindow && page == null) compose.measure(widthMeasureSpec, heightMeasureSpec)
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        if (isAttachedToWindow && page == null) compose.layout(0, 0, width, height)
    }
}
