package com.kyant.backdrop.backdrops

import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.GlobalPositionAwareModifierNode
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.node.invalidateDraw
import androidx.compose.ui.platform.InspectorInfo
import com.kyant.backdrop.internal.recordLayer
import kotlin.math.roundToInt

fun Modifier.layerBackdrop(
    backdrop: LayerBackdrop,
    recordKey: Any? = null,
    mustRecord: (() -> Boolean)? = null
): Modifier =
    this then LayerBackdropElement(backdrop, recordKey, mustRecord)

private class LayerBackdropElement(
    val backdrop: LayerBackdrop,
    val recordKey: Any? = null,
    val mustRecord: (() -> Boolean)? = null
) : ModifierNodeElement<LayerBackdropNode>() {

    override fun create(): LayerBackdropNode {
        return LayerBackdropNode(backdrop, recordKey, mustRecord)
    }

    override fun update(node: LayerBackdropNode) {
        if (node.backdrop != backdrop) {
            node.backdrop.layerCoordinates = null
            node.backdrop = backdrop
        }
        node.recordKey = recordKey
        node.mustRecord = mustRecord
        node.markNeedsRecord()
        node.invalidateDraw()
    }

    override fun InspectorInfo.inspectableProperties() {
        name = "layerBackdrop"
        properties["backdrop"] = backdrop
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is LayerBackdropElement) return false

        if (backdrop != other.backdrop) return false
        if (recordKey != other.recordKey) return false
        
        if (mustRecord !== other.mustRecord) return false

        return true
    }

    override fun hashCode(): Int {
        var result = backdrop.hashCode()
        result = 31 * result + (recordKey?.hashCode() ?: 0)
        result = 31 * result + (mustRecord?.hashCode() ?: 0)
        return result
    }
}

private class LayerBackdropNode(
    var backdrop: LayerBackdrop,
    var recordKey: Any? = null,
    var mustRecord: (() -> Boolean)? = null
) : DrawModifierNode, GlobalPositionAwareModifierNode, Modifier.Node() {

    private var needsRecord = true
    private var recordedW = 0
    private var recordedH = 0

    fun markNeedsRecord() { needsRecord = true }

    override fun ContentDrawScope.draw() {
        val w = size.width.roundToInt()
        val h = size.height.roundToInt()

        val force = mustRecord?.invoke() == true
        val shouldRecord = recordKey == null || force || needsRecord || recordedW != w || recordedH != h
        if (shouldRecord) {
            needsRecord = false
            recordedW = w
            recordedH = h

            recordLayer(this@LayerBackdropNode, backdrop.graphicsLayer) {
                backdrop.onDraw(this@draw)
            }
            backdrop.contentVersion++
            if (backdrop.contentOnlyCapture) {
                drawLayer(backdrop.graphicsLayer)
                return
            }
        }
        drawContent()
    }

    override fun onGloballyPositioned(coordinates: LayoutCoordinates) {
        if (coordinates.isAttached) {
            val prev = backdrop.layerCoordinates

            val changed = prev == null ||
                prev.isAttached != coordinates.isAttached ||
                prev.positionInWindow() != coordinates.positionInWindow() ||
                prev.size != coordinates.size
            if (changed) {
                backdrop.layerCoordinates = coordinates
            }
        }
    }

    override fun onDetach() {
        backdrop.layerCoordinates = null
    }
}
