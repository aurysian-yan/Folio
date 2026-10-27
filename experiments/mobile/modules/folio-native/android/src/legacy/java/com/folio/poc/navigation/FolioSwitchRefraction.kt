package com.folio.poc.navigation

import androidx.compose.ui.unit.dp
import com.kyant.backdrop.BackdropEffectScope
import com.kyant.backdrop.effects.runtimeShaderEffect
import org.intellij.lang.annotations.Language

// 开关折射保留轨道连接，仅在玻璃内收拢高度并校正原轨道端部。
internal fun BackdropEffectScope.switchRefraction(press: Float, translationX: Float) {
    if (press <= 0f) return
    val scale = downsampleScale
    // 捕获完整折射位移，避免越界透明像素透出底层轨道形成残边。
    padding = maxOf(padding, size.height * 0.15f * press)
    runtimeShaderEffect("FolioSwitchRefraction", SwitchRefractionShader, "content") {
        setFloatUniform("size", size.width * scale, size.height * scale)
        setFloatUniform("offset", padding * scale, padding * scale)
        setFloatUniform("trackCenter", (size.width / 2f - translationX) * scale, size.height / 2f * scale)
        setFloatUniform("trackHalfSize", 28.dp.toPx() * scale, 13.dp.toPx() * scale)
        setFloatUniform("compression", 1f + 0.3f * press)
        setFloatUniform("shoulderWidth", 3.dp.toPx() * scale)
    }
}

@Language("AGSL")
internal const val SwitchRefractionShader = """
uniform shader content;
uniform float2 size;
uniform float2 offset;
uniform float2 trackCenter;
uniform float2 trackHalfSize;
uniform float compression;
uniform float shoulderWidth;

half4 main(float2 bufferCoord) {
    float2 coord = bufferCoord - offset;
    float2 halfSize = size * 0.5;
    float radius = min(halfSize.x, halfSize.y);
    float2 corner = abs(coord - halfSize) - (halfSize - float2(radius));
    float interior = radius - length(max(corner, 0.0)) - min(max(corner.x, corner.y), 0.0);
    // 交界处位移归零，宽轨道通过圆肩连续进入玻璃内的窄轨道。
    float blend = smoothstep(0.0, shoulderWidth, interior);
    // 入口沿水平方向渐进收拢，避免上下边界的采样位移折叠成直角台阶。
    float entry = radius - sqrt(max(0.0, radius * radius - trackHalfSize.y * trackHalfSize.y));
    float leftOverflow = max(0.0, trackHalfSize.x - trackCenter.x);
    float rightOverflow = max(0.0, trackCenter.x + trackHalfSize.x - size.x);
    float leftShoulder = smoothstep(entry, entry + shoulderWidth, coord.x);
    float rightShoulder = smoothstep(entry, entry + shoulderWidth, size.x - coord.x);
    blend *= mix(1.0, leftShoulder, smoothstep(0.0, shoulderWidth, leftOverflow));
    blend *= mix(1.0, rightShoulder, smoothstep(0.0, shoulderWidth, rightOverflow));
    float2 trackCoord = coord - trackCenter;
    float2 sampleCoord = trackCoord;
    sampleCoord.y *= compression;

    // 圆头跟随真实轨道端点，避免在玻璃入口生成第二个胶囊圆头。
    float sourceRadius = trackHalfSize.y;
    float targetRadius = sourceRadius / compression;
    float targetCap = trackHalfSize.x - targetRadius;
    float sourceCap = trackHalfSize.x - sourceRadius;
    float x = abs(trackCoord.x);
    float mappedX;
    if (x >= targetCap) {
        mappedX = sourceCap + (x - targetCap) * compression;
    } else {
        float start = max(0.0, targetCap - targetRadius * 2.0);
        mappedX = x - (sourceRadius - targetRadius) * smoothstep(start, targetCap, x);
    }
    sampleCoord.x = sign(trackCoord.x) * mappedX;
    return content.eval(mix(coord, trackCenter + sampleCoord, blend) + offset);
}
"""
