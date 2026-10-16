package com.folio.poc.navigation

import kotlin.math.floor
import kotlin.math.round

// 数值吸附与共享字体轴规则一致，以最小值作为步进起点。
internal fun snapSliderValue(value: Double, minimum: Double, maximum: Double, step: Double): Double {
    if (!minimum.isFinite() || !maximum.isFinite() || maximum <= minimum) return minimum
    if (!value.isFinite()) return minimum
    if (!step.isFinite() || step <= 0.0) return value.coerceIn(minimum, maximum)
    val snapped = minimum + floor((value - minimum) / step + 0.5) * step
    return (round(snapped * 10000.0) / 10000.0).coerceIn(minimum, maximum)
}
