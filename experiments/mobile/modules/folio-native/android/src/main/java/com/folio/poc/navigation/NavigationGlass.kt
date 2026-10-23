package com.folio.poc.navigation

import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.shadow.Shadow
import com.kyant.capsule.ContinuousCapsule
import com.folio.poc.navigation.edgelight.EdgeLight
import com.folio.poc.navigation.edgelight.edgeLight

// 底部导航、搜索与网页标题共用同一材质和边缘参数。
internal fun Modifier.navigationGlass(
    backdrop: Backdrop,
    dark: Boolean,
    layerBlock: (GraphicsLayerScope.() -> Unit)? = null,
    onDrawSurface: (DrawScope.() -> Unit)? = null,
): Modifier = drawBackdrop(
    backdrop = backdrop,
    shape = { ContinuousCapsule() },
    effects = { vibrancy(); blur(8.dp.toPx()) },
    highlight = null,
    shadow = { Shadow.Default },
    layerBlock = layerBlock,
    onDrawSurface = onDrawSurface ?: {
        drawRect(if (dark) Color(0xFF121212).copy(alpha = 0.54f) else Color.White.copy(alpha = 0.6f))
    },
).edgeLight(shape = ContinuousCapsule(), edgeLight = EdgeLight.Uniform(
    color = Color.White.copy(alpha = if (dark) 0.4f else 0.7f),
))
