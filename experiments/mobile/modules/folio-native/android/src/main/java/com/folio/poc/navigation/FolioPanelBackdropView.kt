package com.folio.poc.navigation

import android.content.Context
import androidx.compose.foundation.shape.RoundedCornerShape
import com.kyant.backdrop.effects.blur
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.unit.dp
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.kyant.backdrop.drawPlainBackdrop
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

// 悬浮卡片只采样字符网格，保持文字清晰且不采样自身。
class FolioPanelBackdropView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    override val shouldUseAndroidLayout = true
    var sourceId by mutableStateOf("")
    var active by mutableStateOf(true)
    var tintColor by mutableStateOf("")
    var cornerRadius by mutableStateOf(24f)
    private val compose = ComposeView(context)

    init {
        compose.setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool)
        addView(compose, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        compose.setContent {
            if (!active || tintColor.isEmpty()) return@setContent
            val backdrop = FolioBackdropSources.sources[FolioBackdropSources.key(appContext, sourceId)]
                ?: EmptyNavigationBackdrop
            val tint = Color(android.graphics.Color.parseColor(tintColor))
            Box(Modifier.fillMaxSize().drawPlainBackdrop(
                backdrop = backdrop,
                shape = { RoundedCornerShape(cornerRadius.dp) },
                effects = { blur(16.dp.toPx()) },
                onDrawSurface = { drawRect(tint.copy(alpha = 0.78f)) },
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
        requestLayout()
    }
}
