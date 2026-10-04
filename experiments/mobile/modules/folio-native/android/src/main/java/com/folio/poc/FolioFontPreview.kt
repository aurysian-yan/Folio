package com.folio.poc

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
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

    init { setWillNotDraw(false) }

    fun renderSelection() {
        val value = selection
        val key = "${value.sourcePath}|${value.faceIndex}|${value.revisionId}|${value.axes.toSortedMap()}|${value.text}|${value.fontSize}|${value.centered}|${value.wrapWidth}"
        if (key == lastKey) return
        lastKey = key
        val token = generation.incrementAndGet()
        lines = emptyList()
        invalidate()
        if (Build.VERSION.SDK_INT < 31) {
            onStatus(mapOf("status" to "error"))
            return
        }
        worker.execute {
            val result = runCatching {
                shapeSelection(context, value)
            }
            post {
                if (generation.get() != token) return@post
                result.fold(onSuccess = { (shaped, supported) ->
                    lines = if (supported) shaped else emptyList()
                    // 换行预览按真实字形度量取行高，避免 ascent 过大时溢出顶部。
                    val density = context.resources.displayMetrics.density
                    val base = value.fontSize.toFloat() * (if (value.wrapWidth > 0) 1.3f else 1.05f)
                    val lineHeight = if (value.wrapWidth > 0 && supported && shaped.isNotEmpty())
                        maxOf(base, shaped.maxOf { it.ascent + it.descent } / density) else base
                    onStatus(mapOf("status" to if (supported) "ready" else "missing-glyph",
                        "contentHeight" to if (supported) lineHeight.toDouble() * shaped.size else 0.0))
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
        paint.textSize = selection.fontSize.toFloat() * resources.displayMetrics.density
        val baseLineHeight = paint.textSize * (if (selection.wrapWidth > 0) 1.3f else 1.05f)
        val lineHeight = if (selection.wrapWidth > 0 && lines.isNotEmpty())
            maxOf(baseLineHeight, lines.maxOf { it.ascent + it.descent }) else baseLineHeight
        val textHeight = lineHeight * lines.size
        val scale = if (selection.centered && selection.wrapWidth == 0.0) minOf(1f,
            width / maxOf(1f, lines.maxOf { it.advance }), height / maxOf(1f, textHeight)) else 1f
        canvas.save()
        canvas.scale(scale, scale)
        for ((lineIndex, shaped) in lines.withIndex()) {
            val x = if (selection.centered) (width / scale - shaped.advance) / 2 else 0f
            val baseline = (height / scale - textHeight) / 2 + lineIndex * lineHeight
                + (lineHeight - shaped.ascent - shaped.descent) / 2 + shaped.ascent
            for (index in 0 until shaped.glyphCount()) {
                canvas.drawGlyphs(intArrayOf(shaped.getGlyphId(index)), 0,
                    floatArrayOf(shaped.getGlyphX(index) + x, shaped.getGlyphY(index) + baseline), 0,
                    1, shaped.getFont(index), paint)
            }
        }
        canvas.restore()
    }

    override fun onDetachedFromWindow() {
        generation.incrementAndGet()
        lines = emptyList()
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
        private val worker = Executors.newSingleThreadExecutor()
    }
}
