package com.folio.poc.navigation

import android.content.Context
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.RenderNode
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.unit.Density
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.findViewTreeLifecycleOwner
import androidx.lifecycle.findViewTreeViewModelStoreOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.findViewTreeSavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.kyant.backdrop.Backdrop
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import kotlin.math.abs

internal object FolioBackdropSources {
    val sources = mutableStateMapOf<String, FolioViewBackdrop>()
    fun key(appContext: AppContext, sourceId: String) = "${System.identityHashCode(appContext.reactContext)}:$sourceId"
}

// 页面正文和原生玻璃 overlay 分开合成，避免将玻璃重新录入背景。
class FolioBackdropSourceView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    internal val backdrop = FolioViewBackdrop(this)
    var sourceId: String = ""
        set(value) { unregister(); field = value; register() }
    var active = true
        set(value) {
            field = value
            if (value) register() else { unregister(); backdrop.release() }
            glassLayer.visibility = if (value) VISIBLE else GONE
            invalidate()
        }
    var compositingLayer = false
    private val anchors = linkedMapOf<FolioGlassView, View>()
    private val glassLayer = object : FrameLayout(context) {
        override fun drawChild(canvas: Canvas, child: View, drawingTime: Long): Boolean {
            val anchor = anchors.entries.firstOrNull { it.value === child }?.key ?: return false
            val inverse = Matrix()
            if (!Matrix().also { this@FolioBackdropSourceView.transformMatrixToGlobal(it) }.invert(inverse)) return false
            val saved = canvas.save()
            var ancestor = anchor.parent
            while (ancestor is View && ancestor !== this@FolioBackdropSourceView) {
                if (ancestor is ViewGroup && ancestor.clipChildren) {
                    val visible = Rect()
                    if (!ancestor.getGlobalVisibleRect(visible)) { canvas.restoreToCount(saved); return false }
                    val bounds = RectF(visible); inverse.mapRect(bounds); canvas.clipRect(bounds)
                }
                ancestor = ancestor.parent
            }
            val result = super.drawChild(canvas, child, drawingTime)
            canvas.restoreToCount(saved)
            return result
        }
    }.apply { clipChildren = false; clipToPadding = false }
    private var contentDirty = true
    private var gesture: Pair<FolioGlassView, View>? = null
    private var horizontal = false
    private var downX = 0f
    private var downY = 0f
    private val slop = android.view.ViewConfiguration.get(context).scaledTouchSlop
    private val preDraw = ViewTreeObserver.OnPreDrawListener { placeGlass(); true }

    init { setWillNotDraw(false) }
    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

    fun attachGlass(anchor: FolioGlassView, view: View) {
        anchors[anchor] = view
        glassLayer.addView(view)
        placeGlass()
    }
    fun detachGlass(anchor: FolioGlassView) { anchors.remove(anchor)?.let { glassLayer.removeView(it) } }

    private fun placeGlass() {
        glassLayer.layout(0, 0, width, height)
        val parentMatrix = Matrix().also { transformMatrixToGlobal(it) }
        val inverse = Matrix()
        if (!parentMatrix.invert(inverse)) return
        for ((anchor, view) in anchors) {
            val visible = Rect()
            view.visibility = if (active && anchor.isShown && anchor.getGlobalVisibleRect(visible)) VISIBLE else INVISIBLE
            if (view.visibility != VISIBLE) continue
            var opacity = 1f
            var ancestor: View? = anchor
            while (ancestor != null && ancestor !== this) {
                opacity *= ancestor.alpha
                ancestor = ancestor.parent as? View
            }
            view.alpha = opacity
            val matrix = Matrix().also { anchor.transformMatrixToGlobal(it) }
            matrix.postConcat(inverse)
            val values = FloatArray(9).also { matrix.getValues(it) }
            if (view.measuredWidth != anchor.width || view.measuredHeight != anchor.height) {
                view.measure(MeasureSpec.makeMeasureSpec(anchor.width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(anchor.height, MeasureSpec.EXACTLY))
                view.layout(0, 0, anchor.width, anchor.height)
            }
            view.pivotX = 0f; view.pivotY = 0f
            view.translationX = values[Matrix.MTRANS_X]; view.translationY = values[Matrix.MTRANS_Y]
            view.scaleX = values[Matrix.MSCALE_X]; view.scaleY = values[Matrix.MSCALE_Y]
        }
    }

    override fun draw(canvas: Canvas) {
        if (!active || !canvas.isHardwareAccelerated || width <= 0 || height <= 0) { super.draw(canvas); return }
        val node = backdrop.obtainNode(compositingLayer || containsWebView(this))
        if (contentDirty || !node.hasDisplayList()) {
        contentDirty = false
        val recording = node.beginRecording(width, height)
        try {
            background?.let { it.setBounds(0, 0, width, height); it.draw(recording) }
            super.dispatchDraw(recording)
            onDrawForeground(recording)
        } finally { node.endRecording() }
        backdrop.recorded()
        }
        canvas.drawRenderNode(node)
        glassLayer.draw(canvas)
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
            downX = event.x; downY = event.y; horizontal = false
            gesture = anchors.entries.toList().asReversed().firstOrNull { (anchor, view) ->
                val matrix = Matrix().also { anchor.transformMatrixToGlobal(it) }
                val screen = Matrix().also { transformMatrixToGlobal(it) }
                val point = floatArrayOf(event.x, event.y).also { screen.mapPoints(it) }
                val inverse = Matrix()
                matrix.invert(inverse); inverse.mapPoints(point)
                anchor.controlEnabled && view.visibility == VISIBLE && point[0] >= 0 && point[0] < anchor.width && point[1] >= 0 && point[1] < anchor.height
            }?.let { it.key to it.value }
            gesture?.let { (_, view) -> sendToGlass(view, event) }
            return super.dispatchTouchEvent(event) || gesture != null
        }
        val current = gesture ?: return super.dispatchTouchEvent(event)
        if (event.actionMasked == MotionEvent.ACTION_MOVE && !horizontal) {
            val dx = abs(event.x - downX); val dy = abs(event.y - downY)
            if (dy > slop && dy > dx) {
                sendToGlass(current.second, event, MotionEvent.ACTION_CANCEL)
                gesture = null
                return super.dispatchTouchEvent(event)
            }
            if (dx > slop) {
                horizontal = true
                val cancel = MotionEvent.obtain(event).apply { action = MotionEvent.ACTION_CANCEL }
                super.dispatchTouchEvent(cancel); cancel.recycle()
                parent?.requestDisallowInterceptTouchEvent(true)
            }
        }
        if (event.actionMasked == MotionEvent.ACTION_UP && !horizontal) {
            val cancel = MotionEvent.obtain(event).apply { action = MotionEvent.ACTION_CANCEL }
            super.dispatchTouchEvent(cancel); cancel.recycle()
        }
        sendToGlass(current.second, event)
        if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
            gesture = null; horizontal = false
            parent?.requestDisallowInterceptTouchEvent(false)
        }
        return true
    }

    private fun sendToGlass(view: View, event: MotionEvent, action: Int = event.action) {
        val copy = MotionEvent.obtain(event)
        copy.action = action
        val matrix = Matrix().apply { setScale(1f / view.scaleX, 1f / view.scaleY); preTranslate(-view.translationX, -view.translationY) }
        copy.transform(matrix)
        view.dispatchTouchEvent(copy)
        copy.recycle()
    }

    override fun addChildrenForAccessibility(children: ArrayList<View>) {
        super.addChildrenForAccessibility(children)
        for (view in anchors.values) if (view.visibility == VISIBLE) children.add(view)
    }
    override fun onDescendantInvalidated(child: View, target: View) {
        super.onDescendantInvalidated(child, target)
        var ancestor: View? = target
        while (ancestor != null && ancestor !== this) {
            if (ancestor === glassLayer) return
            ancestor = ancestor.parent as? View
        }
        contentDirty = true
        invalidate()
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) { super.onSizeChanged(w, h, oldw, oldh); contentDirty = true }
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        overlay.add(glassLayer)
        // ViewOverlay 的根节点不继承页面 owner，Compose 会从该根节点创建重组器。
        val activity = appContext.currentActivity
        val lifecycleOwner = findViewTreeLifecycleOwner() ?: activity as? LifecycleOwner
        val savedStateOwner = findViewTreeSavedStateRegistryOwner() ?: activity as? SavedStateRegistryOwner
        val viewModelOwner = findViewTreeViewModelStoreOwner() ?: activity as? ViewModelStoreOwner
        for (host in listOfNotNull(glassLayer.parent as? View, glassLayer)) {
            host.setViewTreeLifecycleOwner(lifecycleOwner)
            host.setViewTreeSavedStateRegistryOwner(savedStateOwner)
            host.setViewTreeViewModelStoreOwner(viewModelOwner)
        }
        viewTreeObserver.addOnPreDrawListener(preDraw)
        register()
    }
    override fun onDetachedFromWindow() {
        if (viewTreeObserver.isAlive) viewTreeObserver.removeOnPreDrawListener(preDraw)
        unregister(); backdrop.release(); overlay.remove(glassLayer)
        super.onDetachedFromWindow()
    }
    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility != VISIBLE) backdrop.release() else invalidate()
    }
    private fun register() {
        if (active && isAttachedToWindow && sourceId.isNotEmpty()) FolioBackdropSources.sources[FolioBackdropSources.key(appContext, sourceId)] = backdrop
    }
    private fun unregister() {
        val key = FolioBackdropSources.key(appContext, sourceId)
        if (FolioBackdropSources.sources[key] === backdrop) FolioBackdropSources.sources.remove(key)
    }
    private fun containsWebView(group: ViewGroup): Boolean = (0 until group.childCount).any {
        val child = group.getChildAt(it)
        child is WebView || child is ViewGroup && containsWebView(child)
    }
}

internal object EmptyNavigationBackdrop : Backdrop {
    override val isCoordinatesDependent = false
    override fun DrawScope.drawBackdrop(density: Density, coordinates: LayoutCoordinates?, layerBlock: (GraphicsLayerScope.() -> Unit)?) = Unit
}

internal class FolioViewBackdrop(private val source: FolioBackdropSourceView) {
    private var node: RenderNode? = null
    private var revision by mutableIntStateOf(0)
    fun obtainNode(compositing: Boolean) = (node ?: RenderNode("FolioGlasmioBackdrop").also { node = it }).apply {
        setPosition(0, 0, source.width, source.height)
        setUseCompositingLayer(compositing, null)
    }
    fun recorded() { revision++ }
    fun release() { node?.discardDisplayList(); node = null; revision++ }
    fun consumer(): Backdrop = object : Backdrop {
        override val isCoordinatesDependent = true
        override fun DrawScope.drawBackdrop(density: Density, coordinates: LayoutCoordinates?, layerBlock: (GraphicsLayerScope.() -> Unit)?) {
            revision
            val content = node ?: return
            if (!content.hasDisplayList() || coordinates?.isAttached != true) return
            // 屏幕坐标同时覆盖页面 overlay 与菜单的独立窗口。
            val points = arrayOf(androidx.compose.ui.geometry.Offset.Zero,
                androidx.compose.ui.geometry.Offset(1f, 0f), androidx.compose.ui.geometry.Offset(0f, 1f))
            val screenPoints = points.flatMap {
                val point = coordinates.localToScreen(it)
                listOf(point.x, point.y)
            }.toFloatArray()
            if (screenPoints.any { !it.isFinite() }) return
            val screenToGlass = Matrix()
            if (!screenToGlass.setPolyToPoly(screenPoints, 0, floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f), 0, 3)) return
            val sourceMatrix = Matrix().also { source.transformMatrixToGlobal(it) }
            sourceMatrix.postConcat(screenToGlass)
            val canvas = drawContext.canvas.nativeCanvas
            val saved = canvas.save()
            canvas.concat(sourceMatrix)
            canvas.drawRenderNode(content)
            canvas.restoreToCount(saved)
        }
    }
}
