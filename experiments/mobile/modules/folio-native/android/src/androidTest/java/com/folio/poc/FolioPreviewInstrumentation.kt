package com.folio.poc

import android.app.Activity
import android.app.Instrumentation
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Build
import android.os.Bundle
import java.io.File
import java.util.UUID
import kotlin.math.abs
import kotlin.math.ceil

// 直接绘制生产布局，验证大字号、字形上下伸部、空行及卡片缩放。
class FolioPreviewInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }

    override fun onStart() {
        val result = Bundle()
        val files = mutableListOf<File>()
        try {
            check(Build.VERSION.SDK_INT >= 31)
            val directory = File(targetContext.filesDir, "FolioMobilePoC/fonts").apply { mkdirs() }
            val names = mutableListOf("Lato-Regular.ttf", "SourceSerif4-Regular.otf", "Inter-Variable.ttf")
            if (context.assets.list("")!!.contains("AbhayaLibre-Bold.ttf")) names += "AbhayaLibre-Bold.ttf"
            val fonts = names.map { name ->
                File(directory, "preview-${UUID.randomUUID()}-$name").also { file ->
                    context.assets.open(name).use { input -> file.outputStream().use { input.copyTo(it) } }
                    files += file
                }
            }.toMutableList()
            val cjk = File("/system/fonts/NotoSansCJK-Regular.ttc")
            if (cjk.exists()) fonts += File(directory, "preview-${UUID.randomUUID()}-cjk.ttc").also { cjk.copyTo(it); files += it }
            var cases = 0
            for (file in fonts) {
                val chinese = file.name.endsWith("cjk.ttc")
                for (size in listOf(36.0, 61.0, 64.0, 96.0)) {
                    for (wrapped in listOf(true, false)) {
                        val texts = if (chinese) listOf("字体预览，汉字上下", "汉字\n\n预览") else
                            listOf("Sphinx of black quartz, judge my vow.", "ÁÉÅgjpq\n\nFolio Preview")
                        for (text in texts) {
                            val selection = FolioPreviewSelection().apply {
                                sourcePath = file.path; fontSize = size; centered = true; this.text = text
                                wrapWidth = if (wrapped) 280.0 else 0.0
                                axes = if (file.name.endsWith("Inter-Variable.ttf")) mapOf("wght" to 700.0) else emptyMap()
                            }
                            val (lines, supported) = FolioFontPreview.shapeSelection(targetContext, selection)
                            check(supported) { "Missing fixture glyph: ${file.name}" }
                            val density = targetContext.resources.displayMetrics.density
                            val layout = FolioFontPreview.measureLines(lines, selection, density)
                            check(layout.contentHeight >= layout.bounds.height())
                            check(lines.filter { it.glyphCount() > 0 }.all { it.ascent < 0f && it.descent >= 0f })
                            val width = (280 * density).toInt()
                            val height = if (wrapped) ceil(layout.contentHeight.toDouble()).toInt() + 16 else (120 * density).toInt()
                            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = size.toFloat() * density }
                            FolioFontPreview.drawPreview(Canvas(bitmap), lines, layout, selection, width.toFloat(), height.toFloat(), paint)
                            val rows = (0 until height).filter { y -> (0 until width).any { x -> Color.alpha(bitmap.getPixel(x, y)) > 32 } }
                            check(rows.isNotEmpty())
                            check(rows.first() > 0 && rows.last() < height - 1) { "Clipped glyph: ${file.name}, $size, $wrapped" }
                            check(abs(rows.first() - (height - 1 - rows.last())) <= 3) { "Off-center glyph: ${file.name}, $size, $wrapped" }
                            if (size == 61.0 && wrapped && !text.contains('\n')) {
                                File(context.getExternalFilesDir(null), "preview-${file.name.substringAfterLast('-')}-61.png")
                                    .outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                            }
                            bitmap.recycle()
                            cases++
                        }
                    }
                }
            }
            result.putString("stream", "PASS: $cases production preview renders, signed ascent, unclipped ink bounds, centered blocks, blank lines, variable axes and card scaling\n")
            finish(Activity.RESULT_OK, result)
        } catch (error: Throwable) {
            result.putString("stream", "FAIL: ${error.stackTraceToString()}\n")
            finish(Activity.RESULT_CANCELED, result)
        } finally { files.forEach { it.delete() } }
    }
}
