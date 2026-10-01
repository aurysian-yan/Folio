package com.folio.poc.navigation

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.unit.dp
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.kyant.backdrop.drawPlainBackdrop
import com.kyant.backdrop.isRuntimeShaderSupported
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

// 标题栏背景独立采样，文字、按钮及弹层不参与模糊。
class FolioHeaderBackdropView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    var sourceId by mutableStateOf("")
    var active by mutableStateOf(true)
    var tintColor by mutableStateOf("")
    private val compose = ComposeView(context)

    init {
        compose.setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool)
        addView(compose, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        compose.setContent {
            if (!active || tintColor.isEmpty()) return@setContent
            val backdrop = FolioBackdropSources.sources[FolioBackdropSources.key(appContext, sourceId)]
                ?: EmptyNavigationBackdrop
            val tint = Color(android.graphics.Color.parseColor(tintColor))
            val progressive = isRuntimeShaderSupported()
            Box(Modifier.fillMaxSize()
                .then(if (progressive) Modifier else Modifier.drawWithCache {
                    val paint = Paint()
                    val mask = Brush.verticalGradient(0f to Color.White, 0.42f to Color.White, 1f to Color.Transparent)
                    onDrawWithContent {
                        val canvas = drawContext.canvas
                        canvas.saveLayer(Rect(Offset.Zero, size), paint)
                        drawContent()
                        drawRect(mask, blendMode = BlendMode.DstIn)
                        canvas.restore()
                    }
                })
                .drawPlainBackdrop(
                    backdrop = backdrop,
                    shape = { RectangleShape },
                    effects = { headerProgressiveBlur(10.dp.toPx(), tint) },
                    onDrawSurface = { if (!progressive) drawRect(tint.copy(alpha = 0.78f)) },
                ))
        }
    }

    override fun onAttachedToWindow() {
        val activity = appContext.currentActivity
        (activity as? LifecycleOwner)?.let { setViewTreeLifecycleOwner(it) }
        (activity as? SavedStateRegistryOwner)?.let { setViewTreeSavedStateRegistryOwner(it) }
        super.onAttachedToWindow()
    }
}
