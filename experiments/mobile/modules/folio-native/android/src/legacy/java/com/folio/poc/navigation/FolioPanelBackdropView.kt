package com.folio.poc.navigation

import android.content.Context
import android.os.Build
import android.view.ViewTreeObserver
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.shadow.Shadow
import com.kyant.capsule.ContinuousCapsule
import com.kyant.backdrop.effects.blur
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.unit.Density
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.unit.dp
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawPlainBackdrop
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

// 悬浮卡片只采样字符网格，保持文字清晰且不采样自身。
class FolioPanelBackdropView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    var sourceId by mutableStateOf("")
    var active by mutableStateOf(true)
    var tintColor by mutableStateOf("")
    var cornerRadius by mutableStateOf(32f)
    var borderColor by mutableStateOf("")
    var navigationGlass by mutableStateOf(false)
    var blurRadius by mutableStateOf(-1f)
    var liquid by mutableStateOf(false)
    var dark by mutableStateOf(false)
    private var sampleVersion by mutableIntStateOf(0)
    private val location = IntArray(2)
    private var lastX = Int.MIN_VALUE
    private var lastY = Int.MIN_VALUE
    private val preDraw = ViewTreeObserver.OnPreDrawListener {
        if (active && isShown) {
            getLocationOnScreen(location)
            if (location[0] != lastX || location[1] != lastY) {
                lastX = location[0]
                lastY = location[1]
                sampleVersion++
            }
        }
        true
    }
    private val compose = ComposeView(context)

    init {
        clipChildren = false
        clipToPadding = false
        compose.setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool)
        addView(compose, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        compose.setContent {
            if (!active || tintColor.isEmpty()) return@setContent
            val source = FolioBackdropSources.sources[FolioBackdropSources.key(appContext, sourceId)]
            val backdrop = remember(source) {
                object : Backdrop {
                    override val isCoordinatesDependent = false
                    override val contentVersion get() = sampleVersion * 31 + (source?.contentVersion ?: 0)
                    override fun DrawScope.drawBackdrop(density: Density, coordinates: LayoutCoordinates?, layerBlock: (GraphicsLayerScope.() -> Unit)?) {
                        getLocationOnScreen(location)
                        source?.let { with(it) { drawAtScreenPosition(location[0].toFloat(), location[1].toFloat(), density, layerBlock) } }
                    }
                }
            }
            val tint = Color(android.graphics.Color.parseColor(tintColor))
            if (navigationGlass && (blurRadius >= 0 || liquid)) {
                Box(Modifier.fillMaxSize().drawBackdrop(
                    backdrop = backdrop, shape = { ContinuousCapsule() },
                    effects = {
                        if (!liquid) vibrancy()
                        blur(blurRadius.coerceAtLeast(0f).dp.toPx())
                        if (liquid) lens(10.dp.toPx(), 24.dp.toPx(), depthEffect = true, chromaticAberration = true)
                    },
                    highlight = { Highlight.Default }, shadow = { Shadow.Default },
                    onDrawSurface = { drawRect(tint.copy(alpha = if (liquid) 0.08f else 0.6f)) },
                ))
                return@setContent
            }
            if (navigationGlass) {
                Box(Modifier.fillMaxSize().navigationGlass(backdrop = backdrop, dark = dark))
                return@setContent
            }
            val shape = RoundedCornerShape(cornerRadius.dp)
            val edge = if (borderColor.isEmpty()) Color.Transparent else Color(android.graphics.Color.parseColor(borderColor))
            Box(Modifier.fillMaxSize().border(0.5.dp, edge, shape).drawPlainBackdrop(
                backdrop = backdrop,
                shape = { shape },
                effects = { blur(16.dp.toPx()) },
                onDrawSurface = {
                    drawRect(tint.copy(alpha = if (Build.VERSION.SDK_INT >= 31 && source != null) 0.78f else 1f))
                },
            ))
        }
    }

    // Expo 的延迟测量可能晚于卸载；离窗时不重建 Compose composition。
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
        viewTreeObserver.addOnPreDrawListener(preDraw)
        requestLayout()
    }

    override fun onDetachedFromWindow() {
        if (viewTreeObserver.isAlive) viewTreeObserver.removeOnPreDrawListener(preDraw)
        lastX = Int.MIN_VALUE
        lastY = Int.MIN_VALUE
        super.onDetachedFromWindow()
    }
}
