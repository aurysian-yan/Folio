package com.folio.poc

import android.app.Activity
import android.app.Instrumentation
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import com.facebook.react.bridge.BridgeReactContext
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.ModulesProvider
import expo.modules.kotlin.modules.Module
import java.io.File
import java.lang.ref.WeakReference
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
            validateLivePreview(fonts.first { it.name.endsWith("Inter-Variable.ttf") })
            FolioPanelBackdropSmoke.run(this)
            result.putString("stream", "PASS: $cases production preview renders; committed frames, latest axes, failure retries; moving panel samples live stripes and refreshes every animation frame\n")
            finish(Activity.RESULT_OK, result)
        } catch (error: Throwable) {
            result.putString("stream", "FAIL: ${error.stackTraceToString()}\n")
            finish(Activity.RESULT_CANCELED, result)
        } finally { files.forEach { it.delete() } }
    }

    // 直接驱动原生视图，检查后台绘制期间的实际像素与最终参数。
    @Suppress("DEPRECATION")
    private fun validateLivePreview(file: File) {
        lateinit var view: FolioFontPreview
        lateinit var app: AppContext
        runOnMainSync {
            val react = BridgeReactContext(targetContext)
            app = AppContext(object : ModulesProvider {
                override fun getModulesMap(): Map<Class<out Module>, String?> = emptyMap()
            }, expo.modules.core.ModuleRegistry(emptyList(), emptyList()), WeakReference(react))
            view = FolioFontPreview(react, app)
            view.layout(0, 0, 600, 600)
        }
        fun selection(id: String, weight: Double, size: Double = 36.0) = FolioPreviewSelection().apply {
            requestId = id; sourcePath = file.path; revisionId = "preview-test"; text = "Folio Preview"
            fontSize = size; centered = true; wrapWidth = 280.0; foregroundColor = "#FFFFFF"
            axes = mapOf("wght" to weight)
        }
        fun field(name: String): Any? = FolioFontPreview::class.java.getDeclaredField(name).apply { isAccessible = true }.get(view)
        fun pixels(): IntArray {
            val bitmap = Bitmap.createBitmap(600, 600, Bitmap.Config.ARGB_8888)
            view.draw(Canvas(bitmap))
            val values = IntArray(600 * 600)
            bitmap.getPixels(values, 0, 600, 0, 0, 600, 600)
            bitmap.recycle()
            return values
        }
        fun waitFor(predicate: () -> Boolean) {
            val deadline = SystemClock.uptimeMillis() + 10000
            while (SystemClock.uptimeMillis() < deadline) {
                var done = false
                runOnMainSync { done = predicate() }
                if (done) return
                SystemClock.sleep(10)
            }
            error("原生预览未提交预期帧")
        }
        try {
            runOnMainSync { view.selection = selection("initial", 400.0); view.renderSelection() }
            waitFor { (field("committedSelection") as FolioPreviewSelection).requestId == "initial" }
            runOnMainSync {
                val initial = pixels()
                check(initial.any { Color.alpha(it) > 32 })
                for (index in 0..30) {
                    view.selection = selection("axis-$index", 400.0 + index * 10)
                    view.renderSelection()
                }
                view.selection = selection("latest", 900.0, 96.0)
                view.renderSelection()
                check(initial.contentEquals(pixels())) { "更新期间清空或改变了已提交帧" }
            }
            waitFor { (field("committedSelection") as FolioPreviewSelection).requestId == "latest" }
            runOnMainSync {
                val committed = field("committedSelection") as FolioPreviewSelection
                check(committed.axes["wght"] == 900.0 && committed.fontSize == 96.0)
                check(pixels().any { Color.alpha(it) > 32 })
                view.selection = selection("invalid", Double.NaN)
                view.renderSelection()
            }
            waitFor { field("rendering") == false && (field("lines") as List<*>).isEmpty() }
            runOnMainSync { check(pixels().all { Color.alpha(it) == 0 }); view.selection = selection("retry", 500.0); view.renderSelection() }
            waitFor { (field("committedSelection") as FolioPreviewSelection).requestId == "retry" }
        } finally {
            runOnMainSync {
                FolioFontPreview::class.java.getDeclaredMethod("onDetachedFromWindow").apply { isAccessible = true }.invoke(view)
                app.javaClass.declaredMethods.first { it.name.startsWith("onDestroy") }.apply { isAccessible = true }.invoke(app)
            }
        }
    }
}
