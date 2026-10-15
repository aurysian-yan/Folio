package com.folio.poc

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.fonts.Font
import android.graphics.fonts.FontFamily
import android.graphics.text.PositionedGlyphs
import android.graphics.text.TextRunShaper
import android.os.Build
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

class FolioFontPreview(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    var selection = FolioPreviewSelection()
    private val onStatus by EventDispatcher()
    private val generation = AtomicInteger()
    private var lastKey: String? = null
    private var lines: List<PositionedGlyphs> = emptyList()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var layout: PreviewLayout? = null

    init { setWillNotDraw(false) }

    fun renderSelection() {
        val value = selection
        val key = "${value.sourcePath}|${value.faceIndex}|${value.revisionId}|${value.axes.toSortedMap()}|${value.text}|${value.fontSize}|${value.centered}|${value.wrapWidth}|${value.foregroundColor}"
        if (key == lastKey) return
        lastKey = key
        val token = generation.incrementAndGet()
        lines = emptyList()
        layout = null
        invalidate()
        if (Build.VERSION.SDK_INT < 31) {
            onStatus(mapOf("status" to "error"))
            return
        }
        worker.execute {
            val result = runCatching {
                val (shaped, supported) = shapeSelection(context, value)
                Triple(shaped, supported, if (supported) measureLines(shaped, value, context.resources.displayMetrics.density) else null)
            }
            post {
                if (generation.get() != token) return@post
                result.fold(onSuccess = { (shaped, supported, measured) ->
                    lines = if (supported) shaped else emptyList()
                    layout = measured
                    onStatus(mapOf("status" to if (supported) "ready" else "missing-glyph",
                        "contentHeight" to (measured?.contentHeight?.div(resources.displayMetrics.density)?.toDouble() ?: 0.0)))
                }, onFailure = { onStatus(mapOf("status" to "error")) })
                invalidate()
            }
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (Build.VERSION.SDK_INT < 31) return
        if (lines.isEmpty() || width <= 0 || height <= 0) return
        val value = android.util.TypedValue()
        context.theme.resolveAttribute(android.R.attr.textColorPrimary, value, true)
        paint.color = if (value.resourceId != 0) context.getColor(value.resourceId) else value.data
        if (selection.foregroundColor.isNotEmpty()) {
            runCatching { android.graphics.Color.parseColor(selection.foregroundColor) }.getOrNull()?.let { paint.color = it }
        }
        paint.textSize = selection.fontSize.toFloat() * resources.displayMetrics.density
        val measured = layout ?: return
        drawPreview(canvas, lines, measured, selection, width.toFloat(), height.toFloat(), paint)
    }

    override fun onDetachedFromWindow() {
        generation.incrementAndGet()
        lines = emptyList()
        layout = null
        lastKey = null
        super.onDetachedFromWindow()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        renderSelection()
    }

    companion object {
        internal fun shapeSelection(context: Context, value: FolioPreviewSelection): Pair<List<PositionedGlyphs>, Boolean> {
            val source = File(value.sourcePath).canonicalFile
            val directory = File(context.filesDir, "FolioMobilePoC/fonts").canonicalFile
            require(source.path.startsWith(directory.path + File.separator) && source.canRead())
            require(value.faceIndex >= 0)
            require(value.fontSize.isFinite() && value.fontSize in 8.0..160.0)
            require(value.wrapWidth.isFinite() && value.wrapWidth >= 0)
            require(value.axes.all { (tag, number) ->
                tag.matches(Regex("[A-Za-z0-9 ]{4}")) && number.isFinite()
            })
            val settings = value.axes.toSortedMap().map { (tag, number) -> "'$tag' $number" }.joinToString(",")
            val builder = Font.Builder(source).setTtcIndex(value.faceIndex)
            if (settings.isNotEmpty()) builder.setFontVariationSettings(settings)
            val font = builder.build()
            val typeface = Typeface.CustomFallbackBuilder(FontFamily.Builder(font).build()).build()
            val textPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                this.typeface = typeface
                textSize = value.fontSize.toFloat() * context.resources.displayMetrics.density
            }
            // 详情按真实字号换行，卡片仍使用原有单行缩放。
            val paragraphs = if (value.wrapWidth > 0 && value.text.isNotEmpty()) {
                val layout = StaticLayout.Builder.obtain(value.text, 0, value.text.length, textPaint,
                    maxOf(1, (value.wrapWidth * context.resources.displayMetrics.density).toInt()))
                    .setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(false).build()
                (0 until layout.lineCount).map { index ->
                    value.text.substring(layout.getLineStart(index), layout.getLineEnd(index)).trimEnd('\n', '\r')
                }
            } else value.text.split('\n')
            val shaped = paragraphs.map { paragraph ->
                TextRunShaper.shapeTextRun(paragraph, 0, paragraph.length,
                    0, paragraph.length, 0f, 0f, false, textPaint)
            }
            // 只绘制来自所选文件及成员的字形，拒绝系统回退。
            val supported = shaped.all { line ->
                (0 until line.glyphCount()).all { index ->
                    val used = line.getFont(index)
                    line.getGlyphId(index) != 0 && used.file?.canonicalFile == source
                        && used.ttcIndex == value.faceIndex
                }
            }
            return Pair(shaped, supported)
        }
        internal fun drawPreview(canvas: Canvas, lines: List<PositionedGlyphs>, measured: PreviewLayout,
            selection: FolioPreviewSelection, width: Float, height: Float, paint: Paint) {
            val scale = if (selection.wrapWidth == 0.0) minOf(1f,
                width / maxOf(1f, measured.bounds.width() + 2f), height / maxOf(1f, measured.contentHeight)) else 1f
            val originX = if (selection.centered) width / scale / 2 else 0f
            val originY = (height / scale - measured.bounds.height()) / 2 - measured.bounds.top
            canvas.save()
            canvas.scale(scale, scale)
            for ((lineIndex, shaped) in lines.withIndex()) {
                val placement = measured.lines[lineIndex]
                for (index in 0 until shaped.glyphCount()) {
                    canvas.drawGlyphs(intArrayOf(shaped.getGlyphId(index)), 0,
                        floatArrayOf(shaped.getGlyphX(index) + placement.x + originX,
                            shaped.getGlyphY(index) + placement.baseline + originY), 0,
                        1, shaped.getFont(index), paint)
                }
            }
            canvas.restore()
        }

        // 度量与绘制共用同一布局，ascent 保留安卓向上的负号。
        internal fun measureLines(lines: List<PositionedGlyphs>, value: FolioPreviewSelection, density: Float): PreviewLayout {
            val size = value.fontSize.toFloat() * density
            val measuringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = size }
            val base = size * (if (value.wrapWidth > 0) 1.3f else 1.05f)
            var cursor = 0f
            val block = RectF()
            val placements = lines.mapIndexed { lineIndex, line ->
                val ink = RectF()
                for (index in 0 until line.glyphCount()) {
                    val bounds = RectF()
                    line.getFont(index).getGlyphBounds(line.getGlyphId(index), measuringPaint, bounds)
                    bounds.offset(line.getGlyphX(index), line.getGlyphY(index))
                    if (!bounds.isEmpty) ink.union(bounds)
                }
                val metricsHeight = line.descent - line.ascent
                val lineHeight = maxOf(base, metricsHeight, ink.height())
                val baseline = cursor + (lineHeight - metricsHeight) / 2 - line.ascent
                val left = minOf(0f, ink.left)
                val right = maxOf(line.advance, ink.right)
                val x = if (value.centered) -(left + right) / 2 else -left
                val visible = if (ink.isEmpty) RectF(x, cursor, x + maxOf(1f, line.advance), cursor + lineHeight)
                    else RectF(ink).apply { offset(x, baseline) }
                if (lineIndex == 0) block.set(visible) else block.union(visible)
                cursor += lineHeight
                PreviewLinePlacement(x, baseline)
            }
            return PreviewLayout(placements, block, kotlin.math.ceil(maxOf(cursor, block.height()).toDouble()).toFloat() + 2f)
        }

        private val worker = Executors.newSingleThreadExecutor()
    }
}

internal data class PreviewLinePlacement(val x: Float, val baseline: Float)
internal data class PreviewLayout(val lines: List<PreviewLinePlacement>, val bounds: RectF, val contentHeight: Float)
