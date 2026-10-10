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
import com.folio.poc.navigation.SwitchRefractionShader
import com.kyant.capsule.ContinuousCapsule
import java.io.File
import java.time.Duration
import kotlin.math.abs
import kotlin.math.roundToInt

// 独立离屏渲染生产着色器，验证轨道连通、收拢高度与左右镜像。
@RequiresApi(33)
class FolioSwitchRefractionInstrumentation : Instrumentation() {
    private val scale = 4f
    private val width = (72 * scale).toInt()
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
                        for (translation in listOf(-10f, -5f, 0f, 5f, 10f)) {
                            val bitmap = render(surface, accent, press, stretch, translation)
                            try { assertConnected(bitmap, accent) }
                            catch (error: Throwable) {
                                File(context.getExternalFilesDir(null), "switch-failed.png").outputStream().use {
                                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                                }
                                bitmap.recycle()
                                throw IllegalStateException("press=$press, stretch=$stretch, translation=$translation", error)
                            }
                            if (press == 1f && stretch == 0f && translation == 10f) {
                                val x = (42 * scale).toInt()
                                val coloredHeight = (0 until height).count { matches(bitmap.getPixel(x, it), accent) }
                                check(abs(coloredHeight / scale - 20f) <= 1f) { "Unexpected inner height: ${coloredHeight / scale}" }
                                val outerHeight = (0 until height).count { matches(bitmap.getPixel((21 * scale).toInt(), it), accent) }
                                check(abs(outerHeight / scale - 26f) <= 1f) { "Outer track changed: ${outerHeight / scale}" }
                                val tops = ((24 * scale).toInt()..(32 * scale).toInt()).map { column ->
                                    (0 until height).first { matches(bitmap.getPixel(column, it), accent) }
                                }
                                check(tops.zipWithNext().all { (a, b) -> abs(a - b) <= scale }) { "Sharp shoulder transition" }
                                check(tops.distinct().size >= 4) { "Rounded shoulder missing" }
                                val file = File(context.getExternalFilesDir(null), if (surface == Color.WHITE) "switch-light.png" else "switch-dark.png")
                                file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                            }
                            bitmap.recycle()
                            cases++
                        }
                    }
                }
                val left = render(surface, accent, 1f, 0f, -10f)
                val right = render(surface, accent, 1f, 0f, 10f)
                val mismatches = (0 until height).sumOf { y ->
                    (0 until width).count { x -> matches(left.getPixel(x, y), accent) != matches(right.getPixel(width - 1 - x, y), accent) }
                }
                check(mismatches <= width) { "Asymmetric refraction: $mismatches pixels" }
                left.recycle(); right.recycle()
            }
            result.putString("stream", "PASS: $cases GPU renders, connected track, 20dp inner / 26dp outer height, rounded shoulders, mirrored endpoints\n")
            finish(Activity.RESULT_OK, result)
        } catch (error: Throwable) {
            result.putString("stream", "FAIL: ${error.stackTraceToString()}\n")
            finish(Activity.RESULT_CANCELED, result)
        }
    }

    private fun capsule(width: Float, height: Float) =
        (ContinuousCapsule().createOutline(Size(width, height), LayoutDirection.Ltr, Density(scale)) as Outline.Generic).path.asAndroidPath()

    private fun render(surface: Int, accent: Int, press: Float, stretch: Float, translation: Float): Bitmap {
        val source = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val sourceCanvas = Canvas(source)
        sourceCanvas.drawColor(surface)
        sourceCanvas.translate(8 * scale, 11 * scale)
        sourceCanvas.drawPath(capsule(56 * scale, 26 * scale), Paint(Paint.ANTI_ALIAS_FLAG).apply { color = accent })
        val glassWidth = (32f + 20f * press + 8f * stretch * press) * scale
        val glassHeight = (22f + 14f * press - 3f * stretch * press) * scale
        val padding = glassHeight * 0.15f * press
        val left = width / 2f + translation * scale - glassWidth / 2f
        val top = (height - glassHeight) / 2f
        val shader = RuntimeShader(SwitchRefractionShader).apply {
            setFloatUniform("size", glassWidth, glassHeight)
            setFloatUniform("offset", padding, padding)
            setFloatUniform("trackCenter", glassWidth / 2f - translation * scale, glassHeight / 2f)
            setFloatUniform("trackHalfSize", 28 * scale, 13 * scale)
            setFloatUniform("compression", 1f + 0.3f * press)
            setFloatUniform("shoulderWidth", 3 * scale)
        }
        val glass = RenderNode("switch-glass-test").apply {
            setPosition(0, 0, (glassWidth + padding * 2).roundToInt(), (glassHeight + padding * 2).roundToInt())
            val canvas = beginRecording()
            canvas.translate(padding - left, padding - top)
            canvas.drawBitmap(source, 0f, 0f, null)
            endRecording()
            setRenderEffect(RenderEffect.createRuntimeShaderEffect(shader, "content"))
        }
        val node = RenderNode("switch-refraction-test").apply {
            setPosition(0, 0, source.width, source.height)
            val canvas = beginRecording()
            canvas.drawBitmap(source, 0f, 0f, null)
            canvas.save()
            canvas.translate(left, top)
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
        queue[0] = mask.indexOfFirst { it }
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
        check(tail == count) { "Disconnected accent: ${count - tail} pixels" }
    }
}
