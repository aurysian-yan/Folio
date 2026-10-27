package com.folio.poc.navigation

import androidx.compose.ui.graphics.Color
import com.kyant.backdrop.BackdropEffectScope
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.runtimeShaderEffect
import com.kyant.backdrop.isRuntimeShaderSupported

private val HorizontalHeaderBlur = headerBlurShader(vertical = false)
private val VerticalHeaderBlur = headerBlurShader(vertical = true)

// 双通道高斯采样参考 MeiloX，模糊半径随纵向位置递减。
private fun headerBlurShader(vertical: Boolean): String {
    val pairedOffset = if (vertical) "vec2(0.0, i + weightH / weight)" else "vec2(i + weightH / weight, 0.0)"
    val tailOffset = if (vertical) "vec2(0.0, r)" else "vec2(r, 0.0)"
    val boundsCheck = if (vertical) {
        "return step(0.0, coord.y) * (1.0 - step(size.y, coord.y));"
    } else {
        "return step(0.0, coord.x) * (1.0 - step(size.x, coord.x));"
    }
    val tintUniform = if (vertical) "layout(color) uniform half4 tint;" else ""
    val output = if (vertical) {
        "return mix(blurred, tint, 0.78 * (1.0 - smoothstep(size.y * 0.42, size.y, coord.y)));"
    } else {
        "return blurred;"
    }

    return """
        uniform shader content;
        uniform float blurRadius;
        uniform float2 size;
        $tintUniform
        const float maxRadius = 150.0;

        float inBounds(vec2 coord) {
            $boundsCheck
        }

        vec4 blur(vec2 coord, float radius) {
            float r = floor(radius);
            if (r < 1.0) { return content.eval(coord); }

            float sigma = max(radius / 2.0, 1.0);
            float weightSum = 1.0;
            vec4 result = content.eval(coord);
            float inverseSigmaSquared = 1.0 / (sigma * sigma);
            float weightRatio = exp(-0.5 * inverseSigmaSquared);
            float weightRatioStep = exp(-inverseSigmaSquared);
            float currentWeight = 1.0;

            for (float i = 1.0; i < maxRadius; i += 2.0) {
                if (i >= r) { break; }
                currentWeight *= weightRatio;
                weightRatio *= weightRatioStep;
                float weightL = currentWeight;
                currentWeight *= weightRatio;
                weightRatio *= weightRatioStep;
                float weightH = currentWeight;
                float weight = weightL + weightH;
                vec2 offset = $pairedOffset;

                vec2 coord1 = coord - offset;
                float mask1 = inBounds(coord1);
                weightSum += weight * mask1;
                if (mask1 > 0.0) { result += weight * content.eval(coord1); }

                vec2 coord2 = coord + offset;
                float mask2 = inBounds(coord2);
                weightSum += weight * mask2;
                if (mask2 > 0.0) { result += weight * content.eval(coord2); }
            }

            float oddMask = mod(r, 2.0) * (1.0 - step(maxRadius, r));
            float oddWeight = currentWeight * weightRatio * oddMask;
            vec2 tailOffset = $tailOffset;
            vec2 tail1 = coord - tailOffset;
            float tailMask1 = inBounds(tail1);
            weightSum += oddWeight * tailMask1;
            if (tailMask1 > 0.0) { result += oddWeight * content.eval(tail1); }

            vec2 tail2 = coord + tailOffset;
            float tailMask2 = inBounds(tail2);
            weightSum += oddWeight * tailMask2;
            if (tailMask2 > 0.0) { result += oddWeight * content.eval(tail2); }
            return result / weightSum;
        }

        half4 main(float2 coord) {
            float intensity = 1.0 - clamp((coord.y - size.y * 0.42) / max(size.y * 0.58, 0.0001), 0.0, 1.0);
            half4 blurred = half4(blur(coord, blurRadius * intensity));
            $output
        }
    """.trimIndent()
}

internal fun BackdropEffectScope.headerProgressiveBlur(radius: Float, tint: Color) {
    if (radius <= 0f || size.width <= 0f || size.height <= 0f) return
    if (!isRuntimeShaderSupported()) {
        blur(radius)
        return
    }

    // 着色器在降采样缓冲中执行，尺寸与半径使用同一坐标比例。
    val scaledRadius = (radius * downsampleScale).coerceAtMost(150f)
    val width = size.width * downsampleScale
    val height = size.height * downsampleScale
    runtimeShaderEffect("FolioHeaderBlurHorizontal", HorizontalHeaderBlur, "content") {
        setFloatUniform("blurRadius", scaledRadius)
        setFloatUniform("size", width, height)
    }
    runtimeShaderEffect("FolioHeaderBlurVertical", VerticalHeaderBlur, "content") {
        setFloatUniform("blurRadius", scaledRadius)
        setFloatUniform("size", width, height)
        setColorUniform("tint", tint)
    }
}
