package com.folio.poc.navigation

import android.content.Context
import android.graphics.Canvas
import android.graphics.RenderNode
import android.os.Build
import android.view.View
import androidx.annotation.RequiresApi
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.unit.Density
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.internal.InverseLayerScope
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

// 背景源仅记录 RN 内容，不包含导航和弹层。
internal object FolioBackdropSources {
    val sources = mutableStateMapOf<String, FolioViewBackdrop>()
    fun key(appContext: AppContext, sourceId: String) = "${System.identityHashCode(appContext.reactContext)}:$sourceId"
}

class FolioBackdropSourceView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    internal val backdrop = FolioViewBackdrop(this)
    var sourceId: String = ""
        set(value) {
            if (field == value) return
            unregister()
            field = value
            register()
        }
    var active: Boolean = true
        set(value) {
            if (field == value) return
            field = value
            if (!value) backdrop.release()
            invalidate()
        }

    init { setWillNotDraw(false) }

    // 内容布局由 Yoga 管理，原生容器只负责绘制采样。
    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    override fun draw(canvas: Canvas) {
        if (Build.VERSION.SDK_INT >= 31 && active && windowVisibility == VISIBLE && canvas.isHardwareAccelerated && width > 0 && height > 0) {
            val node = backdrop.obtainNode()
            val recording = node.beginRecording(width, height)
            try {
                super.draw(recording)
            } finally {
                node.endRecording()
            }
            backdrop.recorded()
            canvas.drawRenderNode(node)
        } else {
            super.draw(canvas)
        }
    }

    override fun onDescendantInvalidated(child: View, target: View) {
        super.onDescendantInvalidated(child, target)
        if (active && Build.VERSION.SDK_INT >= 31) invalidate()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        register()
    }

    override fun onDetachedFromWindow() {
        unregister()
        backdrop.release()
        super.onDetachedFromWindow()
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility != VISIBLE) backdrop.release() else invalidate()
    }

    private fun register() {
        if (sourceId.isNotEmpty() && isAttachedToWindow) {
            FolioBackdropSources.sources[FolioBackdropSources.key(appContext, sourceId)] = backdrop
        }
    }

    private fun unregister() {
        val key = FolioBackdropSources.key(appContext, sourceId)
        if (FolioBackdropSources.sources[key] === backdrop) FolioBackdropSources.sources.remove(key)
    }
}

internal class FolioViewBackdrop(private val source: FolioBackdropSourceView) : Backdrop {
    private var node: RenderNode? = null
    private val location = IntArray(2)
    private val inverse = InverseLayerScope()
    override val isCoordinatesDependent = true
    override var contentVersion by mutableIntStateOf(0)
        private set

    @RequiresApi(31)
    fun obtainNode(): RenderNode = (node ?: RenderNode("FolioBackdrop").also { node = it }).apply {
        setPosition(0, 0, source.width, source.height)
    }

    fun recorded() { contentVersion++ }

    fun release() {
        if (Build.VERSION.SDK_INT >= 31) node?.discardDisplayList()
        node = null
        contentVersion++
    }

    override fun DrawScope.drawBackdrop(density: Density, coordinates: LayoutCoordinates?, layerBlock: (GraphicsLayerScope.() -> Unit)?) {
        if (Build.VERSION.SDK_INT < 31 || coordinates?.isAttached != true) return
        val content = node ?: return
        if (!content.hasDisplayList()) return
        val canvas = drawContext.canvas.nativeCanvas
        if (!canvas.isHardwareAccelerated) return
        source.getLocationInWindow(location)
        val position = coordinates.positionInWindow()
        withTransform({
            if (layerBlock != null) {
                inverse.reset()
                with(inverse) { inverseTransform(density, layerBlock) }
            }
            translate(location[0] - position.x, location[1] - position.y)
        }) { drawContext.canvas.nativeCanvas.drawRenderNode(content) }
    }
}
