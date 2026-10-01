package com.kyant.backdrop

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.neverEqualPolicy
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.Measurable
import androidx.compose.ui.layout.MeasureResult
import androidx.compose.ui.layout.MeasureScope
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.GlobalPositionAwareModifierNode
import androidx.compose.ui.node.LayoutModifierNode
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.node.ObserverModifierNode
import androidx.compose.ui.node.observeReads
import androidx.compose.ui.node.requireGraphicsContext
import androidx.compose.ui.platform.InspectorInfo
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import com.kyant.backdrop.backdrops.LayerBackdrop
import com.kyant.backdrop.backdrops.SharedBlurBackdrop
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.highlight.HighlightElement
import com.kyant.backdrop.internal.ShapeProvider
import com.kyant.backdrop.internal.recordLayer
import com.kyant.backdrop.shadow.InnerShadow
import com.kyant.backdrop.shadow.InnerShadowElement
import com.kyant.backdrop.shadow.Shadow
import com.kyant.backdrop.shadow.ShadowElement
import kotlin.math.roundToInt

private val DefaultHighlight = { Highlight.Default }
private val DefaultShadow = { Shadow.Default }
private val DefaultOnDrawBackdrop: DrawScope.(DrawScope.() -> Unit) -> Unit = { it() }

fun Modifier.drawPlainBackdrop(
    backdrop: Backdrop,
    shape: () -> Shape,
    effects: BackdropEffectScope.() -> Unit,
    layerBlock: (GraphicsLayerScope.() -> Unit)? = null,
    exportedBackdrop: LayerBackdrop? = null,
    onDrawBehind: (DrawScope.() -> Unit)? = null,
    onDrawBackdrop: DrawScope.(drawBackdrop: DrawScope.() -> Unit) -> Unit = DefaultOnDrawBackdrop,
    onDrawSurface: (DrawScope.() -> Unit)? = null,
    onDrawFront: (DrawScope.() -> Unit)? = null
): Modifier {
    val shapeProvider = ShapeProvider(shape)
    return this
        .then(
            if (layerBlock != null) {
                Modifier.graphicsLayer(layerBlock)
            } else {
                Modifier
            }
        )
        .then(
            DrawBackdropElement(
                backdrop = backdrop,
                shapeProvider = shapeProvider,
                effects = effects,
                layerBlock = layerBlock,
                exportedBackdrop = exportedBackdrop,
                onDrawBehind = onDrawBehind,
                onDrawBackdrop = onDrawBackdrop,
                onDrawSurface = onDrawSurface,
                onDrawFront = onDrawFront
            )
        )
}

val LocalBackdropViewport = androidx.compose.runtime.staticCompositionLocalOf<BackdropViewport?> { null }

class BackdropViewport {
    @Volatile
    var topPx: Float = Float.NEGATIVE_INFINITY

    @Volatile
    var bottomPx: Float = Float.POSITIVE_INFINITY

    @Volatile
    var leftPx: Float = Float.NEGATIVE_INFINITY

    @Volatile
    var rightPx: Float = Float.POSITIVE_INFINITY

    fun containsOrIntersects(top: Float, bottom: Float): Boolean {
        return bottom >= topPx && top <= bottomPx
    }

    fun containsOrIntersectsX(left: Float, right: Float): Boolean {
        return right >= leftPx && left <= rightPx
    }
}

private fun offsetSame(a: Float, b: Float): Boolean {
    if (a.isNaN() && b.isNaN()) return true

    return kotlin.math.abs(a - b) < 0.5f
}

fun Modifier.drawBackdrop(
    backdrop: Backdrop,
    shape: () -> Shape,
    effects: BackdropEffectScope.() -> Unit,
    highlight: (() -> Highlight?)? = DefaultHighlight,
    shadow: (() -> Shadow?)? = DefaultShadow,
    innerShadow: (() -> InnerShadow?)? = null,
    layerBlock: (GraphicsLayerScope.() -> Unit)? = null,
    exportedBackdrop: LayerBackdrop? = null,
    downsampleScale: Float = DOWNSAMPLE_SCALE,
    viewport: BackdropViewport? = null,
    onDrawBehind: (DrawScope.() -> Unit)? = null,
    onDrawBackdrop: DrawScope.(drawBackdrop: DrawScope.() -> Unit) -> Unit = DefaultOnDrawBackdrop,
    onDrawSurface: (DrawScope.() -> Unit)? = null,
    onDrawFront: (DrawScope.() -> Unit)? = null
): Modifier {
    val shapeProvider = ShapeProvider(shape)
    return this
        .then(
            if (layerBlock != null) {
                Modifier.graphicsLayer(layerBlock)
            } else {
                Modifier
            }
        )
        .then(
            if (innerShadow != null) {
                InnerShadowElement(
                    shapeProvider = shapeProvider,
                    shadow = innerShadow
                )
            } else {
                Modifier
            }
        )
        .then(
            if (shadow != null) {
                ShadowElement(
                    shapeProvider = shapeProvider,
                    shadow = shadow
                )
            } else {
                Modifier
            }
        )
        .then(
            if (highlight != null) {
                HighlightElement(
                    shapeProvider = shapeProvider,
                    highlight = highlight
                )
            } else {
                Modifier
            }
        )
        .then(
            DrawBackdropElement(
                backdrop = backdrop,
                shapeProvider = shapeProvider,
                effects = effects,
                layerBlock = layerBlock,
                exportedBackdrop = exportedBackdrop,
                downsampleScale = downsampleScale,
                viewport = viewport,
                onDrawBehind = onDrawBehind,
                onDrawBackdrop = onDrawBackdrop,
                onDrawSurface = onDrawSurface,
                onDrawFront = onDrawFront
            )
        )
}

private class DrawBackdropElement(
    val backdrop: Backdrop,
    val shapeProvider: ShapeProvider,
    val effects: BackdropEffectScope.() -> Unit,
    val layerBlock: (GraphicsLayerScope.() -> Unit)?,
    val exportedBackdrop: LayerBackdrop?,
    val downsampleScale: Float = DOWNSAMPLE_SCALE,
    val viewport: BackdropViewport? = null,
    val onDrawBehind: (DrawScope.() -> Unit)?,
    val onDrawBackdrop: DrawScope.(drawBackdrop: DrawScope.() -> Unit) -> Unit,
    val onDrawSurface: (DrawScope.() -> Unit)?,
    val onDrawFront: (DrawScope.() -> Unit)?
) : ModifierNodeElement<DrawBackdropNode>() {

    override fun create(): DrawBackdropNode {
        return DrawBackdropNode(
            backdrop = backdrop,
            shapeProvider = shapeProvider,
            effects = effects,
            layerBlock = layerBlock,
            exportedBackdrop = exportedBackdrop,
            downsampleScale = downsampleScale,
            viewport = viewport,
            onDrawBehind = onDrawBehind,
            onDrawBackdrop = onDrawBackdrop,
            onDrawSurface = onDrawSurface,
            onDrawFront = onDrawFront
        )
    }

    override fun update(node: DrawBackdropNode) {

        val effectsChanged = node.effects !== effects ||
            node.shapeProvider.innerShape != shapeProvider.innerShape
        node.backdrop = backdrop
        node.shapeProvider = shapeProvider
        node.effects = effects
        node.layerBlock = layerBlock
        if (node.exportedBackdrop != exportedBackdrop) {
            node.exportedBackdrop?.layerCoordinates = null
            node.exportedBackdrop = exportedBackdrop
        }
        node.downsampleScale = downsampleScale
        node.viewport = viewport
        node.onDrawBehind = onDrawBehind
        node.onDrawBackdrop = onDrawBackdrop
        node.onDrawSurface = onDrawSurface
        node.onDrawFront = onDrawFront
        if (effectsChanged) {
            node.invalidateDrawCache()
        }
    }

    override fun InspectorInfo.inspectableProperties() {
        name = "drawBackdrop"
        properties["backdrop"] = backdrop
        properties["shapeProvider"] = shapeProvider
        properties["effects"] = effects
        properties["layerBlock"] = layerBlock
        properties["exportedBackdrop"] = exportedBackdrop
        properties["onDrawBehind"] = onDrawBehind
        properties["onDrawBackdrop"] = onDrawBackdrop
        properties["onDrawSurface"] = onDrawSurface
        properties["onDrawFront"] = onDrawFront
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is DrawBackdropElement) return false

        if (backdrop != other.backdrop) return false

        if (shapeProvider.innerShape != other.shapeProvider.innerShape) return false
        if (effects != other.effects) return false
        if (layerBlock != other.layerBlock) return false
        if (exportedBackdrop != other.exportedBackdrop) return false
        if (downsampleScale != other.downsampleScale) return false
        if (viewport !== other.viewport) return false
        if (onDrawBehind != other.onDrawBehind) return false
        if (onDrawBackdrop != other.onDrawBackdrop) return false
        if (onDrawSurface != other.onDrawSurface) return false
        if (onDrawFront != other.onDrawFront) return false

        return true
    }

    override fun hashCode(): Int {
        var result = backdrop.hashCode()
        
        result = 31 * result + shapeProvider.innerShape.hashCode()
        result = 31 * result + effects.hashCode()
        result = 31 * result + (layerBlock?.hashCode() ?: 0)
        result = 31 * result + (exportedBackdrop?.hashCode() ?: 0)
        result = 31 * result + downsampleScale.hashCode()
        result = 31 * result + (viewport?.hashCode() ?: 0)
        result = 31 * result + (onDrawBehind?.hashCode() ?: 0)
        result = 31 * result + onDrawBackdrop.hashCode()
        result = 31 * result + (onDrawSurface?.hashCode() ?: 0)
        result = 31 * result + (onDrawFront?.hashCode() ?: 0)
        return result
    }
}

private class DrawBackdropNode(
    var backdrop: Backdrop,
    var shapeProvider: ShapeProvider,
    var effects: BackdropEffectScope.() -> Unit,
    var layerBlock: (GraphicsLayerScope.() -> Unit)?,
    var exportedBackdrop: LayerBackdrop?,
    var downsampleScale: Float = DOWNSAMPLE_SCALE,
    var viewport: BackdropViewport? = null,
    var onDrawBehind: (DrawScope.() -> Unit)?,
    var onDrawBackdrop: DrawScope.(drawBackdrop: DrawScope.() -> Unit) -> Unit,
    var onDrawSurface: (DrawScope.() -> Unit)?,
    var onDrawFront: (DrawScope.() -> Unit)?
) : LayoutModifierNode, DrawModifierNode, GlobalPositionAwareModifierNode, ObserverModifierNode, Modifier.Node() {

    private val effectScope =
        object : BackdropEffectScopeImpl() {

            override val shape: Shape get() = shapeProvider.innerShape

            override val downsampleScale: Float get() = this@DrawBackdropNode.downsampleScale
        }

    private var graphicsLayer: GraphicsLayer? = null

    private var lastSampleSource: Any? = null
    private var lastSampleVersion: Int = -1
    private var lastSampleOffsetX = Float.NaN
    private var lastSampleOffsetY = Float.NaN
    private var lastSampleW = -1
    private var lastSampleH = -1
    private var lastSampleLayer: GraphicsLayer? = null

    private var clipPathCache: androidx.compose.ui.graphics.Path? = null
    private var clipPathRadius = Float.NaN
    private var clipPathW = Float.NaN
    private var clipPathH = Float.NaN

    private var layoutCoordinates: LayoutCoordinates? by mutableStateOf(null, neverEqualPolicy())

    private var padding by mutableFloatStateOf(0f)

    private val recordBackdropBlock: (DrawScope.() -> Unit) = {
        val canvas = drawContext.canvas
        val padding = padding

        canvas.save()
        canvas.scale(downsampleScale, downsampleScale)
        if (padding != 0f) {
            canvas.translate(padding, padding)
        }
        onDrawBackdrop {
            with(backdrop) {
                drawBackdrop(
                    density = effectScope,
                    coordinates = layoutCoordinates,
                    layerBlock = layerBlock
                )
            }
        }
        if (padding != 0f) {
            canvas.translate(-padding, -padding)
        }
        canvas.restore()
    }

    private val drawBackdropLayer: DrawScope.() -> Unit = drawBackdropLayer@{
        val layer = graphicsLayer
        if (layer != null) {
            val viewport = viewport
            if (viewport != null && layoutCoordinates != null) {
                val winPos = try {
                    layoutCoordinates!!.positionInWindow()
                } catch (_: Exception) {
                    null
                }
                if (winPos != null) {
                    val winRight = winPos.x + size.width
                    val winBottom = winPos.y + size.height
                    if (!viewport.containsOrIntersects(winPos.y, winBottom) ||
                        !viewport.containsOrIntersectsX(winPos.x, winRight)
                    ) {

                        return@drawBackdropLayer
                    }
                }
            }

            val padding = padding
            val size = size
            val scaledPadding = padding * downsampleScale

            val cardBufferSize = IntSize(
                ((size.width + padding * 2) * downsampleScale)
                    .roundToInt().coerceAtLeast(1),
                ((size.height + padding * 2) * downsampleScale)
                    .roundToInt().coerceAtLeast(1)
            )

            val sharedLayer = backdrop.sharedSampledLayer
            val sharedBackdrop = backdrop as? SharedBlurBackdrop
            val sourceCoords = sharedBackdrop?.sourceLayerCoordinates
            val cardCoords = layoutCoordinates
            
            val sharedScaleMatch = sharedBackdrop?.sharedDownsampleScale == downsampleScale
            val useSharedMode = sharedLayer != null && cardCoords != null && sourceCoords != null && sharedScaleMatch

            if (useSharedMode) {
                
                val cardPos = cardCoords!!
                val sourcePos = sourceCoords!!
                val offset = try {
                    sourcePos.localPositionOf(cardPos)
                } catch (_: Exception) {
                    cardPos.positionInWindow() - sourcePos.positionInWindow()
                }

                val sharedLayerNonNull = sharedLayer!!
                val sourceVersion = backdrop.contentVersion
                
                val canDirectBlit = padding == 0f && graphicsLayer?.renderEffect == null

                if (canDirectBlit) {
                    lastSampleSource = null
                    lastSampleVersion = -1
                    lastSampleOffsetX = Float.NaN
                    lastSampleOffsetY = Float.NaN
                    lastSampleW = -1
                    lastSampleH = -1
                    lastSampleLayer = null

                    drawContext.canvas.save()
                    
                    drawContext.canvas.clipRect(0f, 0f, size.width, size.height)
                    
                    drawContext.canvas.scale(1f / downsampleScale, 1f / downsampleScale)
                    drawContext.canvas.translate(
                        -offset.x * downsampleScale,
                        -offset.y * downsampleScale
                    )
                    drawLayer(sharedLayerNonNull)
                    drawContext.canvas.restore()
                    return@drawBackdropLayer
                }

                val needsRecordSample = lastSampleLayer !== sharedLayerNonNull ||
                    lastSampleVersion != sourceVersion ||
                    !offsetSame(lastSampleOffsetX, offset.x) ||
                    !offsetSame(lastSampleOffsetY, offset.y) ||
                    lastSampleW != cardBufferSize.width ||
                    lastSampleH != cardBufferSize.height

                if (needsRecordSample) {
                    recordLayer(
                        this@DrawBackdropNode,
                        layer,
                        size = cardBufferSize,
                        block = {
                            val canvas = drawContext.canvas
                            canvas.save()

                            canvas.translate(
                                -offset.x * downsampleScale + scaledPadding,
                                -offset.y * downsampleScale + scaledPadding
                            )
                            drawLayer(sharedLayerNonNull)
                            canvas.restore()
                        }
                    )
                    lastSampleSource = sharedBackdrop
                    lastSampleVersion = sourceVersion
                    lastSampleOffsetX = offset.x
                    lastSampleOffsetY = offset.y
                    lastSampleW = cardBufferSize.width
                    lastSampleH = cardBufferSize.height
                    lastSampleLayer = sharedLayerNonNull
                }
            } else {
                
                val sourceVersion = backdrop.contentVersion

                var sampleX = Float.NaN
                var sampleY = Float.NaN
                val sourceCoordsForPlain = (backdrop as? LayerBackdrop)?.layerCoordinates
                    ?: (backdrop as? SharedBlurBackdrop)?.sourceLayerCoordinates
                val canFingerprintOffset = sourceCoordsForPlain != null && cardCoords != null
                if (canFingerprintOffset) {
                    val off = try {
                        sourceCoordsForPlain!!.localPositionOf(cardCoords!!)
                    } catch (_: Exception) {
                        cardCoords!!.positionInWindow() - sourceCoordsForPlain!!.positionInWindow()
                    }
                    sampleX = off.x
                    sampleY = off.y
                }
                val needsRecordSample = !canFingerprintOffset ||
                    lastSampleSource !== backdrop ||
                    lastSampleVersion != sourceVersion ||
                    !offsetSame(lastSampleOffsetX, sampleX) ||
                    !offsetSame(lastSampleOffsetY, sampleY) ||
                    lastSampleW != cardBufferSize.width ||
                    lastSampleH != cardBufferSize.height ||
                    lastSampleLayer !== layer

                if (needsRecordSample) {
                    recordLayer(
                        this@DrawBackdropNode,
                        layer,
                        size = cardBufferSize,
                        block = recordBackdropBlock
                    )
                    lastSampleSource = backdrop
                    lastSampleVersion = sourceVersion
                    lastSampleOffsetX = sampleX
                    lastSampleOffsetY = sampleY
                    lastSampleW = cardBufferSize.width
                    lastSampleH = cardBufferSize.height
                    lastSampleLayer = layer
                }
            }

            layer.topLeft = IntOffset.Zero
            
            drawContext.canvas.save()
            drawContext.canvas.scale(1f / downsampleScale, 1f / downsampleScale)
            drawContext.canvas.translate(-scaledPadding, -scaledPadding)
            drawLayer(layer)
            drawContext.canvas.restore()
        }
    }

    override fun MeasureScope.measure(
        measurable: Measurable,
        constraints: Constraints
    ): MeasureResult {
        val placeable = measurable.measure(constraints)

        return layout(placeable.width, placeable.height) {
            placeable.place(IntOffset.Zero)
        }
    }

    override fun ContentDrawScope.draw() {
        if (effectScope.update(this)) {
            updateEffects()
        }

        val contentScope = this
        val outline = shapeProvider.shape.createOutline(size, layoutDirection, this)
        when (outline) {
            is androidx.compose.ui.graphics.Outline.Rectangle ->
                clipRect(outline.rect.left, outline.rect.top, outline.rect.right, outline.rect.bottom) {
                    contentScope.drawCardContents()
                }
            is androidx.compose.ui.graphics.Outline.Rounded -> {
                val rr = outline.roundRect
                
                val w = size.width
                val h = size.height
                val radius = rr.topLeftCornerRadius.x
                var path = clipPathCache
                if (path == null || clipPathW != w || clipPathH != h || clipPathRadius != radius) {
                    path = androidx.compose.ui.graphics.Path().apply { addRoundRect(rr) }
                    clipPathCache = path
                    clipPathW = w
                    clipPathH = h
                    clipPathRadius = radius
                }
                clipPath(path) { contentScope.drawCardContents() }
            }
            is androidx.compose.ui.graphics.Outline.Generic ->
                clipPath(outline.path) { contentScope.drawCardContents() }
        }
    }

    private fun ContentDrawScope.drawCardContents() {
        onDrawBehind?.invoke(this)
        drawBackdropLayer()
        onDrawSurface?.invoke(this)
        drawContent()
        onDrawFront?.invoke(this)

        exportedBackdrop?.graphicsLayer?.let { layer ->
            recordLayer(this@DrawBackdropNode, layer) {
                onDrawBehind?.invoke(this)
                drawBackdropLayer()
                onDrawSurface?.invoke(this)
                onDrawFront?.invoke(this)
            }
        }
    }

    override fun onGloballyPositioned(coordinates: LayoutCoordinates) {
        if (coordinates.isAttached) {
            if (backdrop.isCoordinatesDependent) {
                layoutCoordinates = coordinates
            } else {
                if (layoutCoordinates != null) {
                    layoutCoordinates = null
                }
            }
            exportedBackdrop?.layerCoordinates = coordinates
        }
    }

    override fun onObservedReadsChanged() {
        invalidateDrawCache()
    }

    fun invalidateDrawCache() {
        observeEffects()
    }

    private fun observeEffects() {
        observeReads { updateEffects() }
    }

    private var cachedEffectSize = androidx.compose.ui.geometry.Size.Unspecified
    private var cachedEffectShape: Shape? = null
    private var cachedEffectFn: (BackdropEffectScope.() -> Unit)? = null
    private var cachedEffectScale = Float.NaN
    private var cachedRenderEffect: androidx.compose.ui.graphics.RenderEffect? = null

    private fun updateEffects() {
        if (!isRenderEffectSupported()) return

        val same = cachedEffectFn === effects &&
            cachedEffectShape === shapeProvider.innerShape &&
            cachedEffectSize == effectScope.size &&
            cachedEffectScale == downsampleScale &&
            cachedRenderEffect != null
        if (same) {
            if (graphicsLayer?.renderEffect !== cachedRenderEffect) {
                graphicsLayer?.renderEffect = cachedRenderEffect
            }
            return
        }
        effectScope.apply(effects)
        cachedEffectFn = effects
        cachedEffectShape = shapeProvider.innerShape
        cachedEffectSize = effectScope.size
        cachedEffectScale = downsampleScale
        cachedRenderEffect = effectScope.renderEffect
        if (graphicsLayer?.renderEffect !== cachedRenderEffect) {
            graphicsLayer?.renderEffect = cachedRenderEffect
        }
        padding = effectScope.padding
    }

    override fun onAttach() {
        val graphicsContext = requireGraphicsContext()
        graphicsLayer = graphicsContext.createGraphicsLayer()

        observeEffects()
    }

    override fun onDetach() {
        val graphicsContext = requireGraphicsContext()
        graphicsLayer?.let { layer ->
            graphicsContext.releaseGraphicsLayer(layer)
            graphicsLayer = null
        }

        effectScope.reset()
        layoutCoordinates = null
        exportedBackdrop?.layerCoordinates = null
        lastSampleSource = null
        lastSampleVersion = -1
        lastSampleOffsetX = Float.NaN
        lastSampleOffsetY = Float.NaN
        lastSampleW = -1
        lastSampleH = -1
        lastSampleLayer = null
        clipPathCache = null
    }
}
