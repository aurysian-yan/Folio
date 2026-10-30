package com.folio.poc

import android.content.Context
import android.os.Build
import androidx.annotation.ColorInt
import androidx.annotation.RequiresApi
import com.google.android.material.color.utilities.Hct
import com.google.android.material.color.utilities.SchemeTonalSpot
import java.util.Locale

// 由种子色派生 Material3 语义色，覆盖卡片、背景、文字与强调色。
object FolioMaterialColors {
    // 壁纸种子取自系统 accent1 主调色，仅 Android 12 及以上提供。
    fun wallpaperSeed(context: Context): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null
        return toHex(systemAccent(context))
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun systemAccent(context: Context): Int = context.getColor(android.R.color.system_accent1_500)

    fun scheme(context: Context, seed: String, dark: Boolean, followWallpaper: Boolean): Map<String, String> {
        if (followWallpaper && !dark && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return systemLightWebPalette(context) + systemLightScheme(context)
        }
        val scheme = SchemeTonalSpot(Hct.fromInt(parseHex(seed)), dark, 0.0)
        return mapOf(
            "onPrimaryContainer" to toHex(scheme.onPrimaryContainer),
            "secondary" to toHex(scheme.secondary), "onSecondary" to toHex(scheme.onSecondary),
            "secondaryContainer" to toHex(scheme.secondaryContainer), "onSecondaryContainer" to toHex(scheme.onSecondaryContainer),
            "tertiary" to toHex(scheme.tertiary), "onTertiary" to toHex(scheme.onTertiary),
            "tertiaryContainer" to toHex(scheme.tertiaryContainer), "onTertiaryContainer" to toHex(scheme.onTertiaryContainer),
            "outline" to toHex(scheme.outline), "onError" to toHex(scheme.onError),
            "errorContainer" to toHex(scheme.errorContainer), "onErrorContainer" to toHex(scheme.onErrorContainer),
            "primary" to toHex(scheme.primary),
            "onPrimary" to toHex(scheme.onPrimary),
            "primaryContainer" to toHex(scheme.primaryContainer),
            "surface" to toHex(scheme.surface),
            "surfaceContainer" to toHex(scheme.surfaceContainer),
            "surfaceContainerHigh" to toHex(scheme.surfaceContainerHigh),
            "surfaceContainerHighest" to toHex(scheme.surfaceContainerHighest),
            "onSurface" to toHex(scheme.onSurface),
            "onSurfaceVariant" to toHex(scheme.onSurfaceVariant),
            "outlineVariant" to toHex(scheme.outlineVariant),
            "error" to toHex(scheme.error),
        )
    }

    // 站内配色使用完整 Material3 角色，供网页 CSS 变量覆盖。
    fun webPalette(context: Context, seed: String, dark: Boolean, followWallpaper: Boolean): Map<String, String> {
        if (followWallpaper && !dark && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return systemLightWebPalette(context)
        }
        val scheme = SchemeTonalSpot(Hct.fromInt(parseHex(seed)), dark, 0.0)
        return mapOf(
            "background" to toHex(scheme.background),
            "onBackground" to toHex(scheme.onBackground),
            "surface" to toHex(scheme.surface),
            "onSurface" to toHex(scheme.onSurface),
            "surfaceVariant" to toHex(scheme.surfaceVariant),
            "onSurfaceVariant" to toHex(scheme.onSurfaceVariant),
            "surfaceDim" to toHex(scheme.surfaceDim),
            "surfaceBright" to toHex(scheme.surfaceBright),
            "surfaceContainerLowest" to toHex(scheme.surfaceContainerLowest),
            "surfaceContainerLow" to toHex(scheme.surfaceContainerLow),
            "surfaceContainer" to toHex(scheme.surfaceContainer),
            "surfaceContainerHigh" to toHex(scheme.surfaceContainerHigh),
            "surfaceContainerHighest" to toHex(scheme.surfaceContainerHighest),
            "outline" to toHex(scheme.outline),
            "outlineVariant" to toHex(scheme.outlineVariant),
            "scrim" to toHex(scheme.scrim),
            "shadow" to toHex(scheme.shadow),
            "surfaceTint" to toHex(scheme.surfaceTint),
            "inverseSurface" to toHex(scheme.inverseSurface),
            "inverseOnSurface" to toHex(scheme.inverseOnSurface),
            "inversePrimary" to toHex(scheme.inversePrimary),
            "primary" to toHex(scheme.primary),
            "onPrimary" to toHex(scheme.onPrimary),
            "primaryContainer" to toHex(scheme.primaryContainer),
            "onPrimaryContainer" to toHex(scheme.onPrimaryContainer),
            "primaryFixed" to toHex(scheme.primaryFixed),
            "primaryFixedDim" to toHex(scheme.primaryFixedDim),
            "onPrimaryFixed" to toHex(scheme.onPrimaryFixed),
            "onPrimaryFixedVariant" to toHex(scheme.onPrimaryFixedVariant),
            "secondary" to toHex(scheme.secondary),
            "onSecondary" to toHex(scheme.onSecondary),
            "secondaryContainer" to toHex(scheme.secondaryContainer),
            "onSecondaryContainer" to toHex(scheme.onSecondaryContainer),
            "secondaryFixed" to toHex(scheme.secondaryFixed),
            "secondaryFixedDim" to toHex(scheme.secondaryFixedDim),
            "onSecondaryFixed" to toHex(scheme.onSecondaryFixed),
            "onSecondaryFixedVariant" to toHex(scheme.onSecondaryFixedVariant),
            "tertiary" to toHex(scheme.tertiary),
            "onTertiary" to toHex(scheme.onTertiary),
            "tertiaryContainer" to toHex(scheme.tertiaryContainer),
            "onTertiaryContainer" to toHex(scheme.onTertiaryContainer),
            "tertiaryFixed" to toHex(scheme.tertiaryFixed),
            "tertiaryFixedDim" to toHex(scheme.tertiaryFixedDim),
            "onTertiaryFixed" to toHex(scheme.onTertiaryFixed),
            "onTertiaryFixedVariant" to toHex(scheme.onTertiaryFixedVariant),
            "error" to toHex(scheme.error),
            "onError" to toHex(scheme.onError),
            "errorContainer" to toHex(scheme.errorContainer),
            "onErrorContainer" to toHex(scheme.onErrorContainer),
        )
    }

    // 壁纸浅色直接复用系统语义色，避免从强调色重建后丢失中性色的色相与饱和度。
    @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private fun systemLightWebPalette(context: Context): Map<String, String> {
        val colors = mapOf(
            "background" to android.R.color.system_background_light,
            "onBackground" to android.R.color.system_on_background_light,
            "surface" to android.R.color.system_surface_light,
            "onSurface" to android.R.color.system_on_surface_light,
            "surfaceVariant" to android.R.color.system_surface_variant_light,
            "onSurfaceVariant" to android.R.color.system_on_surface_variant_light,
            "surfaceDim" to android.R.color.system_surface_dim_light,
            "surfaceBright" to android.R.color.system_surface_bright_light,
            "surfaceContainerLowest" to android.R.color.system_surface_container_lowest_light,
            "surfaceContainerLow" to android.R.color.system_surface_container_low_light,
            "surfaceContainer" to android.R.color.system_surface_container_light,
            "surfaceContainerHigh" to android.R.color.system_surface_container_high_light,
            "surfaceContainerHighest" to android.R.color.system_surface_container_highest_light,
            "outline" to android.R.color.system_outline_light,
            "outlineVariant" to android.R.color.system_outline_variant_light,
            "primary" to android.R.color.system_primary_light,
            "onPrimary" to android.R.color.system_on_primary_light,
            "primaryContainer" to android.R.color.system_primary_container_light,
            "onPrimaryContainer" to android.R.color.system_on_primary_container_light,
            "secondary" to android.R.color.system_secondary_light,
            "onSecondary" to android.R.color.system_on_secondary_light,
            "secondaryContainer" to android.R.color.system_secondary_container_light,
            "onSecondaryContainer" to android.R.color.system_on_secondary_container_light,
            "tertiary" to android.R.color.system_tertiary_light,
            "onTertiary" to android.R.color.system_on_tertiary_light,
            "tertiaryContainer" to android.R.color.system_tertiary_container_light,
            "onTertiaryContainer" to android.R.color.system_on_tertiary_container_light,
            "error" to android.R.color.system_error_light,
            "onError" to android.R.color.system_on_error_light,
            "errorContainer" to android.R.color.system_error_container_light,
            "onErrorContainer" to android.R.color.system_on_error_container_light,
        ).mapValues { (_, resource) -> toHex(context.getColor(resource)) }
        // 系统资源没有 fixed、反色与阴影角色，按语义近似保持对比度。
        return colors + mapOf(
            "scrim" to "#000000",
            "shadow" to "#000000",
            "surfaceTint" to colors.getValue("primary"),
            "inverseSurface" to colors.getValue("onSurface"),
            "inverseOnSurface" to colors.getValue("surface"),
            "inversePrimary" to colors.getValue("primaryContainer"),
            "primaryFixed" to colors.getValue("primaryContainer"),
            "primaryFixedDim" to colors.getValue("primaryContainer"),
            "onPrimaryFixed" to colors.getValue("onPrimaryContainer"),
            "onPrimaryFixedVariant" to colors.getValue("onPrimaryContainer"),
            "secondaryFixed" to colors.getValue("secondaryContainer"),
            "secondaryFixedDim" to colors.getValue("secondaryContainer"),
            "onSecondaryFixed" to colors.getValue("onSecondaryContainer"),
            "onSecondaryFixedVariant" to colors.getValue("onSecondaryContainer"),
            "tertiaryFixed" to colors.getValue("tertiaryContainer"),
            "tertiaryFixedDim" to colors.getValue("tertiaryContainer"),
            "onTertiaryFixed" to colors.getValue("onTertiaryContainer"),
            "onTertiaryFixedVariant" to colors.getValue("onTertiaryContainer"),
        )
    }

    // 壁纸浅色直接复用系统语义色，避免从强调色重建后丢失中性色的色相与饱和度。
    @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private fun systemLightScheme(context: Context): Map<String, String> = mapOf(
        "primary" to android.R.color.system_primary_light,
        "onPrimary" to android.R.color.system_on_primary_light,
        "primaryContainer" to android.R.color.system_primary_container_light,
        "surface" to android.R.color.system_surface_bright_light,
        "surfaceContainer" to android.R.color.system_surface_container_light,
        "surfaceContainerHigh" to android.R.color.system_surface_container_high_light,
        "surfaceContainerHighest" to android.R.color.system_surface_container_highest_light,
        "onSurface" to android.R.color.system_on_surface_light,
        "onSurfaceVariant" to android.R.color.system_on_surface_variant_light,
        "outlineVariant" to android.R.color.system_outline_variant_light,
        "error" to android.R.color.system_error_light,
    ).mapValues { (_, resource) -> toHex(context.getColor(resource)) }

    private fun parseHex(value: String): Int = try {
        (value.removePrefix("#").toLong(16) or 0xFF000000L).toInt()
    } catch (_: Exception) {
        0xFFF06835.toInt()
    }

    private fun toHex(@ColorInt color: Int): String = String.format(Locale.US, "#%06X", color and 0xFFFFFF)
}
