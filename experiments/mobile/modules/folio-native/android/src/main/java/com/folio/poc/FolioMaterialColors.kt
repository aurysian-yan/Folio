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
            return systemLightScheme(context)
        }
        val scheme = SchemeTonalSpot(Hct.fromInt(parseHex(seed)), dark, 0.0)
        return mapOf(
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
