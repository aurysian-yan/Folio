package com.kyant.capsule.continuities

import androidx.compose.runtime.Immutable
import androidx.compose.ui.util.fastCoerceAtLeast
import androidx.compose.ui.util.fastCoerceIn
import com.kyant.capsule.AdvancedContinuity
import com.kyant.capsule.Continuity
import com.kyant.capsule.core.Point
import com.kyant.capsule.lerp
import com.kyant.capsule.path.PathSegments
import com.kyant.capsule.path.PathSegmentsBuilder
import com.kyant.capsule.path.buildPathSegments
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

@Immutable
data class G2Continuity(
    val profile: G2ContinuityProfile = G2ContinuityProfile.RoundedRectangle,
    val capsuleProfile: G2ContinuityProfile = G2ContinuityProfile.Capsule
) : AdvancedContinuity() {

    private fun resolveBezier(profile: G2ContinuityProfile) =
        when (profile) {
            this.profile -> this.profile.bezier
            this.capsuleProfile -> this.capsuleProfile.bezier
            else -> profile.bezier
        }

    override fun createStandardRoundedRectanglePathSegments(
        width: Double,
        height: Double,
        topLeft: Double,
        topRight: Double,
        bottomRight: Double,
        bottomLeft: Double
    ): PathSegments {
        val centerX = width * 0.5
        val centerY = height * 0.5

        val ratioTLV = ((centerY / topLeft - 1.0) / profile.extendedFraction).fastCoerceIn(0.0, 1.0)
        val ratioTLH = ((centerX / topLeft - 1.0) / profile.extendedFraction).fastCoerceIn(0.0, 1.0)
        val ratioTRH = ((centerX / topRight - 1.0) / profile.extendedFraction).fastCoerceIn(0.0, 1.0)
        val ratioTRV = ((centerY / topRight - 1.0) / profile.extendedFraction).fastCoerceIn(0.0, 1.0)
        val ratioBRV = ((centerY / bottomRight - 1.0) / profile.extendedFraction).fastCoerceIn(0.0, 1.0)
        val ratioBRH = ((centerX / bottomRight - 1.0) / profile.extendedFraction).fastCoerceIn(0.0, 1.0)
        val ratioBLH = ((centerX / bottomLeft - 1.0) / profile.extendedFraction).fastCoerceIn(0.0, 1.0)
        val ratioBLV = ((centerY / bottomLeft - 1.0) / profile.extendedFraction).fastCoerceIn(0.0, 1.0)

        val ratioTL = min(ratioTLV, ratioTLH)
        val ratioTR = min(ratioTRH, ratioTRV)
        val ratioBR = min(ratioBRV, ratioBRH)
        val ratioBL = min(ratioBLH, ratioBLV)

        val extFracTL = lerp(capsuleProfile.extendedFraction, profile.extendedFraction, ratioTL)
        val extFracTR = lerp(capsuleProfile.extendedFraction, profile.extendedFraction, ratioTR)
        val extFracBR = lerp(capsuleProfile.extendedFraction, profile.extendedFraction, ratioBR)
        val extFracBL = lerp(capsuleProfile.extendedFraction, profile.extendedFraction, ratioBL)

        val extFracTLV = extFracTL * ratioTLV
        val extFracTLH = extFracTL * ratioTLH
        val extFracTRH = extFracTR * ratioTRH
        val extFracTRV = extFracTR * ratioTRV
        val extFracBRV = extFracBR * ratioBRV
        val extFracBRH = extFracBR * ratioBRH
        val extFracBLH = extFracBL * ratioBLH
        val extFracBLV = extFracBL * ratioBLV

        val offsetTLV = -topLeft * extFracTLV
        val offsetTLH = -topLeft * extFracTLH
        val offsetTRH = -topRight * extFracTRH
        val offsetTRV = -topRight * extFracTRV
        val offsetBRV = -bottomRight * extFracBRV
        val offsetBRH = -bottomRight * extFracBRH
        val offsetBLH = -bottomLeft * extFracBLH
        val offsetBLV = -bottomLeft * extFracBLV

        val bezKScaleTLV = lerp(capsuleProfile.bezierCurvatureScale, profile.bezierCurvatureScale, ratioTLV)
        val bezKScaleTLH = lerp(capsuleProfile.bezierCurvatureScale, profile.bezierCurvatureScale, ratioTLH)
        val bezKScaleTRH = lerp(capsuleProfile.bezierCurvatureScale, profile.bezierCurvatureScale, ratioTRH)
        val bezKScaleTRV = lerp(capsuleProfile.bezierCurvatureScale, profile.bezierCurvatureScale, ratioTRV)
        val bezKScaleBRV = lerp(capsuleProfile.bezierCurvatureScale, profile.bezierCurvatureScale, ratioBRV)
        val bezKScaleBRH = lerp(capsuleProfile.bezierCurvatureScale, profile.bezierCurvatureScale, ratioBRH)
        val bezKScaleBLH = lerp(capsuleProfile.bezierCurvatureScale, profile.bezierCurvatureScale, ratioBLH)
        val bezKScaleBLV = lerp(capsuleProfile.bezierCurvatureScale, profile.bezierCurvatureScale, ratioBLV)

        val arcFracTL = lerp(capsuleProfile.arcFraction, profile.arcFraction, ratioTL)
        val arcFracTR = lerp(capsuleProfile.arcFraction, profile.arcFraction, ratioTR)
        val arcFracBR = lerp(capsuleProfile.arcFraction, profile.arcFraction, ratioBR)
        val arcFracBL = lerp(capsuleProfile.arcFraction, profile.arcFraction, ratioBL)

        val arcKScaleTL = 1.0 + (profile.arcCurvatureScale - 1.0) * ratioTL
        val arcKScaleTR = 1.0 + (profile.arcCurvatureScale - 1.0) * ratioTR
        val arcKScaleBR = 1.0 + (profile.arcCurvatureScale - 1.0) * ratioBR
        val arcKScaleBL = 1.0 + (profile.arcCurvatureScale - 1.0) * ratioBL

        val bezierTLV = resolveBezier(G2ContinuityProfile(extFracTLV, arcFracTL, bezKScaleTLV, arcKScaleTL))
        val bezierTLH = resolveBezier(G2ContinuityProfile(extFracTLH, arcFracTL, bezKScaleTLH, arcKScaleTL))
        val bezierTRH = resolveBezier(G2ContinuityProfile(extFracTRH, arcFracTR, bezKScaleTRH, arcKScaleTR))
        val bezierTRV = resolveBezier(G2ContinuityProfile(extFracTRV, arcFracTR, bezKScaleTRV, arcKScaleTR))
        val bezierBRV = resolveBezier(G2ContinuityProfile(extFracBRV, arcFracBR, bezKScaleBRV, arcKScaleBR))
        val bezierBRH = resolveBezier(G2ContinuityProfile(extFracBRH, arcFracBR, bezKScaleBRH, arcKScaleBR))
        val bezierBLH = resolveBezier(G2ContinuityProfile(extFracBLH, arcFracBL, bezKScaleBLH, arcKScaleBL))
        val bezierBLV = resolveBezier(G2ContinuityProfile(extFracBLV, arcFracBL, bezKScaleBLV, arcKScaleBL))

        return buildPathSegments {
            var x = 0.0
            var y = topLeft
            moveTo(x, y - offsetTLV)

            if (topLeft > 0.0) {
                
                with(bezierTLV) {
                    cubicTo(
                        x + p1.y * topLeft, y - p1.x * topLeft,
                        x + p2.y * topLeft, y - p2.x * topLeft,
                        x + p3.y * topLeft, y - p3.x * topLeft
                    )
                }

                arcToWithScaledRadius(
                    center = Point(topLeft, topLeft),
                    radius = topLeft,
                    radiusScale = 1.0 / arcKScaleTL,
                    startAngle = PI + PI * 0.5 * (1.0 - arcFracTL) * 0.5,
                    sweepAngle = PI * 0.5 * arcFracTL
                )

                x = topLeft
                y = 0.0
                with(bezierTLH) {
                    cubicTo(
                        x - p2.x * topLeft, y + p2.y * topLeft,
                        x - p1.x * topLeft, y + p1.y * topLeft,
                        x - (p0.x * topLeft).fastCoerceAtLeast(offsetTLH), y + p0.y * topLeft
                    )
                }
            }

            x = width - topRight
            y = 0.0
            lineTo(x + offsetTRH, y)

            if (topRight > 0.0) {
                
                with(bezierTRH) {
                    cubicTo(
                        x + p1.x * topRight, y + p1.y * topRight,
                        x + p2.x * topRight, y + p2.y * topRight,
                        x + p3.x * topRight, y + p3.y * topRight
                    )
                }

                arcToWithScaledRadius(
                    center = Point(width - topRight, topRight),
                    radius = topRight,
                    radiusScale = 1.0 / arcKScaleTR,
                    startAngle = -PI * 0.5 + PI * 0.5 * (1.0 - arcFracTR) * 0.5,
                    sweepAngle = PI * 0.5 * arcFracTR
                )

                x = width
                y = topRight
                with(bezierTRV) {
                    cubicTo(
                        x - p2.y * topRight, y - p2.x * topRight,
                        x - p1.y * topRight, y - p1.x * topRight,
                        x - p0.y * topRight, y - (p0.x * topRight).fastCoerceAtLeast(offsetTRV)
                    )
                }
            }

            x = width
            y = height - bottomRight
            lineTo(x, y + offsetBRV)

            if (bottomRight > 0.0) {
                
                with(bezierBRV) {
                    cubicTo(
                        x - p1.y * bottomRight, y + p1.x * bottomRight,
                        x - p2.y * bottomRight, y + p2.x * bottomRight,
                        x - p3.y * bottomRight, y + p3.x * bottomRight
                    )
                }

                arcToWithScaledRadius(
                    center = Point(width - bottomRight, height - bottomRight),
                    radius = bottomRight,
                    radiusScale = 1.0 / arcKScaleBR,
                    startAngle = 0.0 + PI * 0.5 * (1.0 - arcFracBR) * 0.5,
                    sweepAngle = PI * 0.5 * arcFracBR
                )

                x = width - bottomRight
                y = height
                with(bezierBRH) {
                    cubicTo(
                        x + p2.x * bottomRight, y - p2.y * bottomRight,
                        x + p1.x * bottomRight, y - p1.y * bottomRight,
                        x + (p0.x * bottomRight).fastCoerceAtLeast(offsetBRH), y - p0.y * bottomRight
                    )
                }
            }

            x = bottomLeft
            y = height
            lineTo(x - offsetBLH, y)

            if (bottomLeft > 0.0) {
                
                with(bezierBLH) {
                    cubicTo(
                        x - p1.x * bottomLeft, y - p1.y * bottomLeft,
                        x - p2.x * bottomLeft, y - p2.y * bottomLeft,
                        x - p3.x * bottomLeft, y - p3.y * bottomLeft
                    )
                }

                arcToWithScaledRadius(
                    center = Point(bottomLeft, height - bottomLeft),
                    radius = bottomLeft,
                    radiusScale = 1.0 / arcKScaleBL,
                    startAngle = PI * 0.5 + PI * 0.5 * (1.0 - arcFracBL) * 0.5,
                    sweepAngle = PI * 0.5 * arcFracBL
                )

                x = 0.0
                y = height - bottomLeft
                with(bezierBLV) {
                    cubicTo(
                        x + p2.y * bottomLeft, y + p2.x * bottomLeft,
                        x + p1.y * bottomLeft, y + p1.x * bottomLeft,
                        x + p0.y * bottomLeft, y + (p0.x * bottomLeft).fastCoerceAtLeast(offsetBLV)
                    )
                }
            }

            close()
        }
    }

    override fun createHorizontalCapsulePathSegments(width: Double, height: Double): PathSegments {
        val radius = height * 0.5
        val centerX = width * 0.5

        val ratioH = ((centerX / radius - 1.0) / capsuleProfile.extendedFraction).fastCoerceIn(0.0, 1.0)
        val extFrac = capsuleProfile.extendedFraction
        val extFracH = extFrac * ratioH
        val offsetH = -radius * extFracH
        val bezKScaleH = lerp(capsuleProfile.bezierCurvatureScale, profile.bezierCurvatureScale, ratioH)
        val arcFrac = capsuleProfile.arcFraction
        val bezierH =
            resolveBezier(
                G2ContinuityProfile(
                    extendedFraction = extFracH,
                    arcFraction = arcFrac,
                    bezierCurvatureScale = bezKScaleH,
                    arcCurvatureScale = 1.0
                )
            ) * radius

        val arcRad = PI * 0.5 * arcFrac
        val bezRad = (PI * 0.5 - arcRad) * 0.5
        val sweepRad = (bezRad + arcRad) * 2.0

        return buildPathSegments {
            var x = 0.0
            var y = radius
            moveTo(x, y)

            arcTo(
                center = Point(radius, radius),
                radius = radius,
                startAngle = PI * 0.5 + bezRad,
                sweepAngle = sweepRad
            )

            x = radius
            y = 0.0
            with(bezierH) {
                cubicTo(
                    x - p2.x, y + p2.y,
                    x - p1.x, y + p1.y,
                    x - p0.x.fastCoerceAtLeast(offsetH), y + p0.y
                )
            }

            x = width - radius
            y = 0.0
            lineTo(x + offsetH, y)

            with(bezierH) {
                cubicTo(
                    x + p1.x, y + p1.y,
                    x + p2.x, y + p2.y,
                    x + p3.x, y + p3.y
                )
            }

            arcTo(
                center = Point(width - radius, radius),
                radius = radius,
                startAngle = -(PI * 0.5 - bezRad),
                sweepAngle = sweepRad
            )

            x = width - radius
            y = height
            with(bezierH) {
                cubicTo(
                    x + p2.x, y - p2.y,
                    x + p1.x, y - p1.y,
                    x + p0.x.fastCoerceAtLeast(offsetH), y - p0.y
                )
            }

            x = radius
            y = height
            lineTo(x - offsetH, y)

            with(bezierH) {
                cubicTo(
                    x - p1.x, y - p1.y,
                    x - p2.x, y - p2.y,
                    x - p3.x, y - p3.y
                )
            }
        }
    }

    override fun createVerticalCapsulePathSegments(width: Double, height: Double): PathSegments {
        val radius = width * 0.5
        val centerY = height * 0.5

        val ratioV = ((centerY / radius - 1.0) / capsuleProfile.extendedFraction).fastCoerceIn(0.0, 1.0)
        val extFrac = capsuleProfile.extendedFraction
        val extFracV = extFrac * ratioV
        val offsetV = -radius * extFracV
        val bezKScaleV = lerp(capsuleProfile.bezierCurvatureScale, profile.bezierCurvatureScale, ratioV)
        val arcFrac = capsuleProfile.arcFraction
        val bezierV =
            resolveBezier(
                G2ContinuityProfile(
                    extendedFraction = extFracV,
                    arcFraction = arcFrac,
                    bezierCurvatureScale = bezKScaleV,
                    arcCurvatureScale = 1.0
                )
            ) * radius

        val arcRad = PI * 0.5 * arcFrac
        val bezRad = (PI * 0.5 - arcRad) * 0.5
        val sweepRad = (bezRad + arcRad) * 2.0

        return buildPathSegments {
            var x = 0.0
            var y = radius
            moveTo(x, y - offsetV)

            with(bezierV) {
                cubicTo(
                    x + p1.y, y - p1.x,
                    x + p2.y, y - p2.x,
                    x + p3.y, y - p3.x
                )
            }

            arcTo(
                center = Point(radius, radius),
                radius = radius,
                startAngle = -(PI - bezRad),
                sweepAngle = sweepRad
            )

            x = width
            y = radius
            with(bezierV) {
                cubicTo(
                    x - p2.y, y - p2.x,
                    x - p1.y, y - p1.x,
                    x - p0.y, y - p0.x.fastCoerceAtLeast(offsetV)
                )
            }

            x = width
            y = height - radius
            lineTo(x, y + offsetV)

            with(bezierV) {
                cubicTo(
                    x - p1.y, y + p1.x,
                    x - p2.y, y + p2.x,
                    x - p3.y, y + p3.x
                )
            }

            arcTo(
                center = Point(width - radius, height - radius),
                radius = radius,
                startAngle = bezRad,
                sweepAngle = sweepRad
            )

            x = 0.0
            y = height - radius
            with(bezierV) {
                cubicTo(
                    x + p2.y, y + p2.x,
                    x + p1.y, y + p1.x,
                    x + p0.y, y + p0.x.fastCoerceAtLeast(offsetV)
                )
            }

            close()
        }
    }

    override fun lerp(stop: Continuity, fraction: Double): Continuity {
        return when (stop) {
            is G2Continuity ->
                G2Continuity(
                    profile = lerp(this.profile, stop.profile, fraction),
                    capsuleProfile = lerp(this.capsuleProfile, stop.capsuleProfile, fraction)
                )

            else -> stop.lerp(this, 1f - fraction)
        }
    }
}

private fun PathSegmentsBuilder.arcToWithScaledRadius(
    center: Point,
    radius: Double,
    radiusScale: Double,
    startAngle: Double,
    sweepAngle: Double
) {
    val centerAngle = startAngle + sweepAngle * 0.5
    return arcTo(
        center = center + Point(cos(centerAngle), sin(centerAngle)) * radius * (1.0 - radiusScale),
        radius = radius * radiusScale,
        startAngle = startAngle,
        sweepAngle = sweepAngle
    )
}
