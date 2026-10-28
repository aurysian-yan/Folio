package com.folio.poc.navigation

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.unit.dp
import com.kyant.backdrop.drawBackdrop
import expo.modules.kotlin.AppContext
import io.github.neoruaa.glasmio.glass.GlassSurface
import io.github.neoruaa.glasmio.glass.GlassSurfaceStyle
import io.github.neoruaa.glasmio.glass.LocalGlassBackdrop
import io.github.neoruaa.glasmio.glass.progressiveBackdropBlur
import com.kyant.capsule.ContinuousRoundedRectangle
import com.kyant.shapes.Capsule

class FolioHeaderBackdropView(context: Context, appContext: AppContext) : FolioGlassView(context, appContext) {
    var tintColor by mutableStateOf("")
    @Composable override fun GlassContent() {
        Box(Modifier.fillMaxSize().drawBackdrop(LocalGlassBackdrop.current, shape = { RectangleShape },
            effects = { progressiveBackdropBlur(24.dp.toPx(), tintColor.glassColor(Color.Transparent), 0.5f) },
            highlight = null, shadow = null))
    }
}

class FolioPanelBackdropView(context: Context, appContext: AppContext) : FolioGlassView(context, appContext) {
    var navigationGlass by mutableStateOf(false)
    var tintColor = ""
    var borderColor = ""
    var cornerRadius by mutableStateOf(0f)
    @Composable override fun GlassContent() {
        GlassSurface(Modifier.fillMaxSize(), style = GlassSurfaceStyle.Navigation,
            shape = if (navigationGlass) Capsule() else ContinuousRoundedRectangle(cornerRadius.dp)) {}
    }
}
