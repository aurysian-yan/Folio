package com.folio.poc.navigation

import androidx.compose.ui.unit.dp
import com.kyant.backdrop.BackdropEffectScope
import com.kyant.backdrop.effects.runtimeShaderEffect
import org.intellij.lang.annotations.Language

// 中央轨道保持原始采样，两侧曲面将轨道圆肩向上下翻起。
internal fun BackdropEffectScope.sliderRefraction(press: Float) {
    if (press <= 0f) return
    val scale = downsampleScale
    padding = maxOf(padding, 3.dp.toPx() * press)
    runtimeShaderEffect("FolioSliderRefraction", SliderRefractionShader, "content") {
        setFloatUniform("size", size.width * scale, size.height * scale)
        setFloatUniform("offset", padding * scale, padding * scale)
        setFloatUniform("trackRadius", 6.dp.toPx() * scale)
        setFloatUniform("sidewallWidth", 4.dp.toPx() * scale)
        setFloatUniform("press", press)
    }
}

@Language("AGSL")
internal const val SliderRefractionShader = """
uniform shader content;
uniform float2 size;
uniform float2 offset;
uniform float trackRadius;
uniform float sidewallWidth;
uniform float press;

half4 main(float2 bufferCoord) {
    float2 coord = bufferCoord - offset;
    float2 center = size * 0.5;
    float2 local = coord - center;
    float side = abs(local.x);
    float wallStart = center.x - sidewallWidth;
    float shoulderStart = wallStart - trackRadius;
    float shoulder = clamp(side - shoulderStart, 0.0, trackRadius);
    // 圆肩以原轨道边缘为切线，中心与强调色圆头不发生缩放。
    float halfHeight = trackRadius * 2.0 - sqrt(max(0.0, trackRadius * trackRadius - shoulder * shoulder));
    float wallBlend = smoothstep(wallStart - sidewallWidth * 0.05, wallStart + sidewallWidth * 0.05, side);
    halfHeight = mix(halfHeight, center.y, wallBlend);
    float magnification = mix(1.0, halfHeight / trackRadius, press);
    return content.eval(center + float2(local.x, local.y / magnification) + offset);
}
"""
