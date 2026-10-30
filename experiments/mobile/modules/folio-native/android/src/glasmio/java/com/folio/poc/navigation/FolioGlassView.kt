package com.folio.poc.navigation

import android.content.Context
import androidx.compose.material3.*
import androidx.compose.runtime.key
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
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
abstract class FolioGlassView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    var sourceId by mutableStateOf("")
    var uiTheme by mutableStateOf(emptyMap<String, String>())
        private set
    val material: Boolean get() = uiTheme["style"] == "material3-expressive"
    val themeRevision: String get() = uiTheme["revision"].orEmpty()
    fun payload(vararg values: Pair<String, Any>): Map<String, Any> = mapOf(*values) + ("themeRevision" to themeRevision)
    fun applyUiTheme(value: Map<String, String>) {
        val changed = material != (value["style"] == "material3-expressive")
        uiTheme = value
        if (changed) {
            onUiStyleChanged()
            if (isAttachedToWindow) syncRenderHost()
        }
    }
    private fun materialColors(): ColorScheme {
        val base = if (uiTheme["dark"] == "true") darkColorScheme() else lightColorScheme()
        fun color(name: String, fallback: Color) = uiTheme[name]?.glassColor(fallback) ?: fallback
        return base.copy(
            primary = color("primary", base.primary), onPrimary = color("onPrimary", base.onPrimary),
            primaryContainer = color("primaryContainer", base.primaryContainer), onPrimaryContainer = color("onPrimaryContainer", base.onPrimaryContainer),
            secondary = color("secondary", base.secondary), onSecondary = color("onSecondary", base.onSecondary),
            secondaryContainer = color("secondaryContainer", base.secondaryContainer), onSecondaryContainer = color("onSecondaryContainer", base.onSecondaryContainer),
            tertiary = color("tertiary", base.tertiary), onTertiary = color("onTertiary", base.onTertiary),
            tertiaryContainer = color("tertiaryContainer", base.tertiaryContainer), onTertiaryContainer = color("onTertiaryContainer", base.onTertiaryContainer),
            surface = color("surface", base.surface), onSurface = color("onSurface", base.onSurface),
            surfaceContainer = color("surfaceContainer", base.surfaceContainer), surfaceContainerHigh = color("surfaceContainerHigh", base.surfaceContainerHigh),
            surfaceContainerHighest = color("surfaceContainerHighest", base.surfaceContainerHighest),
            onSurfaceVariant = color("onSurfaceVariant", base.onSurfaceVariant), outline = color("outline", base.outline),
            outlineVariant = color("outlineVariant", base.outlineVariant), error = color("error", base.error),
            onError = color("onError", base.onError), errorContainer = color("errorContainer", base.errorContainer), onErrorContainer = color("onErrorContainer", base.onErrorContainer))
    }
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
            if (material) {
                MaterialExpressiveTheme(colorScheme = materialColors(), motionScheme = MotionScheme.expressive()) {
                    key(uiTheme["style"]) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { if (active) MaterialContent() } }
                }
            } else GlassComposition()
        }
    }

    @Composable private fun GlassComposition() {
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

    protected open fun onUiStyleChanged() = Unit
    @Composable protected abstract fun MaterialContent()
    @Composable protected abstract fun GlassContent()

    override fun onAttachedToWindow() {
        val activity = appContext.currentActivity
        (activity as? LifecycleOwner)?.let { setViewTreeLifecycleOwner(it); compose.setViewTreeLifecycleOwner(it) }
        (activity as? SavedStateRegistryOwner)?.let { setViewTreeSavedStateRegistryOwner(it); compose.setViewTreeSavedStateRegistryOwner(it) }
        super.onAttachedToWindow()
        syncRenderHost()
    }

    private fun syncRenderHost() {
        if (viewTreeObserver.isAlive) viewTreeObserver.removeOnPreDrawListener(preDraw)
        page?.detachGlass(this)
        page = null
        if (compose.parent !== this) {
            (compose.parent as? ViewGroup)?.removeView(compose)
            addView(compose, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        }
        if (material) { samplingPosition = null; requestLayout(); return }
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
