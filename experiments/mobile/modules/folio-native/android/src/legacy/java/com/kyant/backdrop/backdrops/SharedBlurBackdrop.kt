package com.kyant.backdrop.backdrops

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.node.invalidateDraw
import androidx.compose.ui.node.requireGraphicsContext
import androidx.compose.ui.platform.InspectorInfo
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.IntSize
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.DOWNSAMPLE_SCALE
import com.kyant.backdrop.internal.InverseLayerScope
import com.kyant.backdrop.isRenderEffectSupported
import kotlin.math.roundToInt

@Stable
class SharedBlurBackdrop(
    internal val source: LayerBackdrop
) : Backdrop {

    override val isCoordinatesDependent: Boolean = true

    override var sharedSampledLayer: GraphicsLayer? by mutableStateOf(null)
        internal set

    var sharedDownsampleScale: Float = DOWNSAMPLE_SCALE
        internal set

    @Volatile
    var sampledBitmap: android.graphics.Bitmap? = null

    override var contentVersion: Int = 0
        internal set

    val sourceLayerCoordinates: LayoutCoordinates?
        get() = source.layerCoordinates

    private var inverseLayerScope: InverseLayerScope? = null

    fun release() {
        
        sharedSampledLayer = null
    }

    fun preRenderModifier(
        blurRadiusPx: Float,
        downsampleScale: Float = DOWNSAMPLE_SCALE,
        sourceKey: Any? = null
    ): Modifier {
        return SharedBlurRecorderElement(this, blurRadiusPx, downsampleScale, sourceKey)
    }

    override fun DrawScope.drawBackdrop(
        density: Density,
        coordinates: LayoutCoordinates?,
        layerBlock: (GraphicsLayerScope.() -> Unit)?
    ) {
        val coordinates = coordinates ?: return
        val layerCoordinates = source.layerCoordinates ?: return
        withTransform({
            if (layerBlock != null) {
                with(obtainInverseLayerScope()) { inverseTransform(density, layerBlock) }
            }
            val offset = try {
                layerCoordinates.localPositionOf(coordinates)
            } catch (_: Exception) {
                coordinates.positionInWindow() - layerCoordinates.positionInWindow()
            }
            translate(-offset.x, -offset.y)
        }) {
            drawLayer(source.graphicsLayer)
        }
    }

    private fun obtainInverseLayerScope(): InverseLayerScope {
        return inverseLayerScope?.apply { reset() }
            ?: InverseLayerScope().also { inverseLayerScope = it }
    }
}

private class SharedBlurRecorderElement(
    private val sharedBackdrop: SharedBlurBackdrop,
    private val blurRadiusPx: Float,
    private val downsampleScale: Float = DOWNSAMPLE_SCALE,
    private val sourceKey: Any? = null
) : ModifierNodeElement<SharedBlurRecorderNode>() {

    override fun create(): SharedBlurRecorderNode {
        return SharedBlurRecorderNode(sharedBackdrop, blurRadiusPx, downsampleScale, sourceKey)
    }

    override fun update(node: SharedBlurRecorderNode) {

        val sourceChanged = node.sharedBackdrop !== sharedBackdrop ||
            node.downsampleScale != downsampleScale ||
            node.sourceKey != sourceKey
        node.sharedBackdrop = sharedBackdrop
        node.blurRadiusPx = blurRadiusPx
        node.downsampleScale = downsampleScale
        node.sourceKey = sourceKey
        if (sourceChanged) {
            node.markNeedsRecord()
        }
        node.invalidateDraw()
    }

    override fun InspectorInfo.inspectableProperties() {
        name = "SharedBlurRecorder"
        properties["sharedBackdrop"] = sharedBackdrop
        properties["blurRadiusPx"] = blurRadiusPx
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is SharedBlurRecorderElement) return false
        return sharedBackdrop == other.sharedBackdrop &&
            blurRadiusPx == other.blurRadiusPx &&
            downsampleScale == other.downsampleScale &&
            sourceKey == other.sourceKey
    }

    override fun hashCode(): Int {
        var result = sharedBackdrop.hashCode()
        result = 31 * result + blurRadiusPx.hashCode()
        result = 31 * result + downsampleScale.hashCode()
        result = 31 * result + (sourceKey?.hashCode() ?: 0)
        return result
    }
}

private class SharedBlurRecorderNode(
    var sharedBackdrop: SharedBlurBackdrop,
    var blurRadiusPx: Float,
    var downsampleScale: Float = DOWNSAMPLE_SCALE,
    var sourceKey: Any? = null
) : DrawModifierNode, Modifier.Node() {

    private var blurLayer: GraphicsLayer? = null

    private var needsRecord = true
    private var recordedW = 0
    private var recordedH = 0
    private var recordedBlurRadius = Float.NaN

    fun markNeedsRecord() { needsRecord = true }

    override fun ContentDrawScope.draw() {
        drawContent()

        if (!isRenderEffectSupported()) return

        val layer = blurLayer ?: return

        val targetW = (size.width * downsampleScale).roundToInt().coerceAtLeast(1)
        val targetH = (size.height * downsampleScale).roundToInt().coerceAtLeast(1)

        if (needsRecord || recordedW != targetW || recordedH != targetH) {
            val sourceLayer = sharedBackdrop.source.graphicsLayer
            
            layer.record(IntSize(targetW, targetH)) {
                drawContext.canvas.save()
                drawContext.canvas.scale(downsampleScale, downsampleScale)
                drawLayer(sourceLayer)
                drawContext.canvas.restore()
            }
            needsRecord = false
            recordedW = targetW
            recordedH = targetH

            sharedBackdrop.sharedSampledLayer = layer
            sharedBackdrop.sharedDownsampleScale = downsampleScale
            sharedBackdrop.contentVersion++
        }

        if (recordedBlurRadius != blurRadiusPx) {
            recordedBlurRadius = blurRadiusPx
            layer.renderEffect = if (blurRadiusPx > 0f) {
                val scaledBlur = blurRadiusPx * downsampleScale
                BlurEffect(
                    null,
                    scaledBlur,
                    scaledBlur,
                    TileMode.Clamp
                )
            } else null
            sharedBackdrop.contentVersion++
        }
    }

    override fun onAttach() {
        val graphicsContext = requireGraphicsContext()
        blurLayer = graphicsContext.createGraphicsLayer()
        needsRecord = true
        recordedBlurRadius = Float.NaN
    }

    override fun onDetach() {
        val graphicsContext = requireGraphicsContext()
        blurLayer?.let { layer ->
            graphicsContext.releaseGraphicsLayer(layer)
            blurLayer = null
        }
        sharedBackdrop.sharedSampledLayer = null
        needsRecord = true
        recordedBlurRadius = Float.NaN
    }
}
