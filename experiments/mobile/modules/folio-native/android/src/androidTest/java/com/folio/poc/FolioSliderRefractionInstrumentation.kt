package com.folio.poc

import android.app.Activity
import android.app.Instrumentation
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.HardwareRenderer
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.RuntimeShader
import android.hardware.HardwareBuffer
import android.media.ImageReader
import android.os.Build
import android.os.Bundle
import androidx.annotation.RequiresApi
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.asAndroidPath
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import com.folio.poc.navigation.SliderRefractionShader
import com.kyant.capsule.ContinuousCapsule
import java.io.File
import java.time.Duration
import kotlin.math.abs
import kotlin.math.roundToInt

// 离屏运行生产着色器，验证中央等厚、两侧翻起、圆头与轨道连通。
@RequiresApi(33)
class FolioSliderRefractionInstrumentation : Instrumentation() {
    private val scale = 4f
    private val width = (320 * scale).toInt()
    private val height = (48 * scale).toInt()

    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }

    override fun onStart() {
        val result = Bundle()
        try {
            check(Build.VERSION.SDK_INT >= 33)
            var cases = 0
            for ((surface, accent) in listOf(0xff242424.toInt() to 0xff3884ff.toInt(),
                Color.WHITE to 0xfff66b32.toInt())) {
                for (press in listOf(0f, 0.25f, 0.5f, 1f)) {
                    for (stretch in listOf(0f, 1f)) {
                        for (fraction in listOf(0f, 0.01f, 0.25f, 0.5f, 0.99f, 1f)) {
                            for (ltr in listOf(true, false)) {
                                val bitmap = render(surface, accent, press, stretch, fraction, ltr)
                                try {
                                    assertConnected(bitmap, accent)
                                    val endpoint = (16f + 288f * if (ltr) fraction else 1f - fraction) * scale
                                    for (y in 0 until height) for (x in 0 until width) {
                                        if (matches(bitmap.getPixel(x, y), accent)) {
                                            check(if (ltr) x <= endpoint + scale else x >= endpoint - scale) { "Accent crossed thumb center" }
                                            if (abs(y - height / 2f) > 6f * scale + 1f) {
                                                val glassWidth = (32f + 20f * press + 8f * stretch * press) * scale
                                                check(abs(x - endpoint) <= glassWidth / 2f + 1f) { "Outer track became thicker" }
                                            }
                                        }
                                    }
                                    if (press == 1f && stretch == 0f && fraction == 0.5f && ltr) {
                                        val endpoint = width / 2
                                        val innerHeight = (0 until height).count { matches(bitmap.getPixel(endpoint - (8 * scale).toInt(), it), accent) } / scale
                                        val outerHeight = (0 until height).count { matches(bitmap.getPixel((40 * scale).toInt(), it), accent) } / scale
                                        check(abs(outerHeight - 12f) <= 0.5f) { "Outer height: $outerHeight" }
                                        check(abs(innerHeight - 12f) <= 0.5f) { "Central track narrowed: $innerHeight" }
                                        val leftEdgeHeight = (0 until height).count { matches(bitmap.getPixel(endpoint - (22 * scale).toInt(), it), accent) } / scale
                                        val rightEdgeHeight = (0 until height).count { matches(bitmap.getPixel(endpoint + (22 * scale).toInt(), it), 0xff555555.toInt()) } / scale
                                        check(leftEdgeHeight >= 20f && rightEdgeHeight >= 20f) { "Curved edge refraction missing: $leftEdgeHeight / $rightEdgeHeight" }
                                        val capHeights = (1..5).map { dx ->
                                            (0 until height).count { matches(bitmap.getPixel(endpoint - (dx * scale).toInt(), it), accent) }
                                        }
                                        check(capHeights.first() < capHeights.last()) { "Rounded accent cap missing" }
                                        val file = File(context.getExternalFilesDir(null), if (surface == Color.WHITE) "slider-light.png" else "slider-dark.png")
                                        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                                    }
                                } catch (error: Throwable) {
                                    File(context.getExternalFilesDir(null), "slider-failed.png").outputStream().use {
                                        bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                                    }
                                    throw IllegalStateException("press=$press, stretch=$stretch, fraction=$fraction, ltr=$ltr", error)
                                } finally { bitmap.recycle() }
                                cases++
                            }
                        }
                    }
                }
            }
            FolioSliderInteractionSmoke.run(this)
            result.putString("stream", "PASS: $cases GPU renders; native tap, drag, endpoints, stale values, vertical gesture, cancellation, disabled state and light/dark capture\n")
            finish(Activity.RESULT_OK, result)
        } catch (error: Throwable) {
            result.putString("stream", "FAIL: ${error.stackTraceToString()}\n")
            finish(Activity.RESULT_CANCELED, result)
        }
    }

    private fun capsule(width: Float, height: Float) =
        (ContinuousCapsule().createOutline(Size(width, height), LayoutDirection.Ltr, Density(scale)) as Outline.Generic).path.asAndroidPath()

    private fun render(surface: Int, accent: Int, press: Float, stretch: Float, fraction: Float, ltr: Boolean): Bitmap {
        val source = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val sourceCanvas = Canvas(source)
        sourceCanvas.drawColor(surface)
        val top = 18f * scale
        val trackLeft = 0f
        val trackWidth = 320f * scale
        val trackHeight = 12f * scale
        val fillWidth = (16f + 288f * fraction) * scale
        sourceCanvas.drawRoundRect(trackLeft, top, trackLeft + trackWidth, top + trackHeight,
            6f * scale, 6f * scale, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff555555.toInt() })
        if (fillWidth > 0f) {
            val fillLeft = if (ltr) trackLeft else trackLeft + trackWidth - fillWidth
            val radius = minOf(trackHeight / 2f, fillWidth / 2f)
            sourceCanvas.drawRoundRect(fillLeft, top, fillLeft + fillWidth, top + trackHeight,
                radius, radius, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = accent })
        }
        val glassWidth = (32f + 20f * press + 8f * stretch * press) * scale
        val glassHeight = (22f + 18f * press - 3f * stretch * press) * scale
        val padding = 3f * scale * press
        val center = (16f + 288f * if (ltr) fraction else 1f - fraction) * scale
        val left = center - glassWidth / 2f
        val glassTop = (height - glassHeight) / 2f
        val shader = RuntimeShader(SliderRefractionShader).apply {
            setFloatUniform("size", glassWidth, glassHeight)
            setFloatUniform("offset", padding, padding)
            setFloatUniform("trackRadius", 6f * scale)
            setFloatUniform("sidewallWidth", 4f * scale)
            setFloatUniform("press", press)
        }
        val glass = RenderNode("slider-glass-test").apply {
            setPosition(0, 0, (glassWidth + padding * 2).roundToInt(), (glassHeight + padding * 2).roundToInt())
            val canvas = beginRecording()
            canvas.translate(padding - left, padding - glassTop)
            canvas.drawBitmap(source, 0f, 0f, null)
            endRecording()
            setRenderEffect(RenderEffect.createRuntimeShaderEffect(shader, "content"))
        }
        val node = RenderNode("slider-refraction-test").apply {
            setPosition(0, 0, source.width, source.height)
            val canvas = beginRecording()
            canvas.drawBitmap(source, 0f, 0f, null)
            canvas.save()
            canvas.translate(left, glassTop)
            canvas.clipPath(capsule(glassWidth, glassHeight))
            canvas.translate(-padding, -padding)
            canvas.drawRenderNode(glass)
            canvas.restore()
            endRecording()
        }
        val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2,
            HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE or HardwareBuffer.USAGE_GPU_COLOR_OUTPUT)
        val renderer = HardwareRenderer()
        try {
            renderer.setSurface(reader.surface)
            renderer.setContentRoot(node)
            renderer.start()
            val status = renderer.createRenderRequest().setWaitForPresent(true).syncAndDraw()
            check(status == HardwareRenderer.SYNC_OK || status == HardwareRenderer.SYNC_REDRAW_REQUESTED) { "GPU render status: $status" }
            val deadline = System.nanoTime() + 2_000_000_000L
            var frame = reader.acquireNextImage()
            while (frame == null && System.nanoTime() < deadline) {
                Thread.sleep(5)
                frame = reader.acquireNextImage()
            }
            checkNotNull(frame) { "GPU frame unavailable" }.use { image ->
                image.fence.use { fence -> check(!fence.isValid || fence.await(Duration.ofSeconds(2))) }
                checkNotNull(image.hardwareBuffer).use { buffer ->
                    val hardware = checkNotNull(Bitmap.wrapHardwareBuffer(buffer, null))
                    try { return checkNotNull(hardware.copy(Bitmap.Config.ARGB_8888, false)) }
                    finally { hardware.recycle() }
                }
            }
        } finally {
            renderer.destroy()
            reader.close()
            node.discardDisplayList()
            glass.discardDisplayList()
            source.recycle()
        }
    }

    private fun matches(pixel: Int, accent: Int) = Color.alpha(pixel) > 240 &&
        abs(Color.red(pixel) - Color.red(accent)) <= 12 &&
        abs(Color.green(pixel) - Color.green(accent)) <= 12 &&
        abs(Color.blue(pixel) - Color.blue(accent)) <= 12

    private fun assertConnected(bitmap: Bitmap, accent: Int) {
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
        val mask = BooleanArray(pixels.size) { matches(pixels[it], accent) }
        val count = mask.count { it }
        check(count > 0) { "Track missing: center=${bitmap.getPixel(width / 2, height / 2).toUInt().toString(16)}" }
        val queue = IntArray(count)
        queue[0] = (height / 2 * width until (height / 2 + 1) * width).first { mask[it] }
        mask[queue[0]] = false
        var head = 0
        var tail = 1
        while (head < tail) {
            val index = queue[head++]
            for (next in intArrayOf(index - width, index + width,
                if (index % width > 0) index - 1 else -1,
                if (index % width < width - 1) index + 1 else -1)) {
                if (next in mask.indices && mask[next]) {
                    mask[next] = false
                    queue[tail++] = next
                }
            }
        }
        // 曲面轮廓的亚像素抗锯齿允许不足一平方点的孤立边缘覆盖。
        check(count - tail <= scale * scale) { "Disconnected accent: ${count - tail} pixels" }
    }
}
