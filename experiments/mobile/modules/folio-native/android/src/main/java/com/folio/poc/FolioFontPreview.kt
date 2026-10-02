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
        val key = "${value.sourcePath}|${value.faceIndex}|${value.revisionId}|${value.axes.toSortedMap()}|${value.text}|${value.fontSize}|${value.centered}"
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
                    onStatus(mapOf("status" to if (supported) "ready" else "missing-glyph"))
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
        val lineHeight = paint.textSize * 1.05f
        val textHeight = lineHeight * lines.size
        val scale = if (selection.centered) minOf(1f,
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
            require(value.axes.all { (tag, number) ->
                tag.matches(Regex("[A-Za-z0-9 ]{4}")) && number.isFinite()
            })
            val settings = value.axes.toSortedMap().map { (tag, number) -> "'$tag' $number" }.joinToString(",")
            val builder = Font.Builder(source).setTtcIndex(value.faceIndex)
            if (settings.isNotEmpty()) builder.setFontVariationSettings(settings)
            val font = builder.build()
            val typeface = Typeface.CustomFallbackBuilder(FontFamily.Builder(font).build()).build()
            val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                this.typeface = typeface
                textSize = value.fontSize.toFloat() * context.resources.displayMetrics.density
            }
            val shaped = value.text.split('\n').map { paragraph ->
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
