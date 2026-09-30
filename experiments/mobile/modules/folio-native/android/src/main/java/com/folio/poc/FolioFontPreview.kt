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
    private var glyphs: PositionedGlyphs? = null
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    init { setWillNotDraw(false) }

    fun renderSelection() {
        val value = selection
        val key = "${value.sourcePath}|${value.faceIndex}|${value.revisionId}|${value.axes.toSortedMap()}|${value.text}"
        if (key == lastKey) return
        lastKey = key
        val token = generation.incrementAndGet()
        glyphs = null
        invalidate()
        if (Build.VERSION.SDK_INT < 31) {
            onStatus(mapOf("status" to "error"))
            return
        }
        worker.execute {
            val result = runCatching {
                val source = File(value.sourcePath).canonicalFile
                val directory = File(context.filesDir, "FolioMobilePoC/fonts").canonicalFile
                require(source.path.startsWith(directory.path + File.separator) && source.canRead())
                require(value.faceIndex >= 0)
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
                    textSize = 32 * resources.displayMetrics.scaledDensity
                }
                val shaped = TextRunShaper.shapeTextRun(value.text, 0, value.text.length,
                    0, value.text.length, 0f, 0f, false, textPaint)
                // 只绘制来自所选文件及成员的字形，拒绝系统回退。
                val supported = (0 until shaped.glyphCount()).all { index ->
                    val used = shaped.getFont(index)
                    shaped.getGlyphId(index) != 0 && used.file?.canonicalFile == source
                        && used.ttcIndex == value.faceIndex
                }
                Pair(shaped, supported)
            }
            post {
                if (generation.get() != token) return@post
                result.fold(onSuccess = { (shaped, supported) ->
                    glyphs = if (supported) shaped else null
                    onStatus(mapOf("status" to if (supported) "ready" else "missing-glyph"))
                }, onFailure = { onStatus(mapOf("status" to "error")) })
                invalidate()
            }
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (Build.VERSION.SDK_INT < 31) return
        val shaped = glyphs ?: return
        val value = android.util.TypedValue()
        context.theme.resolveAttribute(android.R.attr.textColorPrimary, value, true)
        paint.color = if (value.resourceId != 0) context.getColor(value.resourceId) else value.data
        paint.textSize = 32 * resources.displayMetrics.scaledDensity
        val baseline = (height + 32 * resources.displayMetrics.scaledDensity) / 2
        for (index in 0 until shaped.glyphCount()) {
            canvas.drawGlyphs(intArrayOf(shaped.getGlyphId(index)), 0,
                floatArrayOf(shaped.getGlyphX(index), shaped.getGlyphY(index) + baseline), 0,
                1, shaped.getFont(index), paint)
        }
    }

    override fun onDetachedFromWindow() {
        generation.incrementAndGet()
        glyphs = null
        lastKey = null
        super.onDetachedFromWindow()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        renderSelection()
    }

    companion object {
        private val worker = Executors.newSingleThreadExecutor()
    }
}
