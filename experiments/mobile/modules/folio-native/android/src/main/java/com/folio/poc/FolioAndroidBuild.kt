package com.folio.poc

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build

// 安装包类型与系统兼容策略。
internal object FolioAndroidBuild {
    const val METADATA_KEY = "com.folio.android.GLASS_TIER"
    val variant: String get() = BuildConfig.FLAVOR
    fun requiredVariant(sdk: Int): String {
        require(sdk >= 30)
        return if (sdk >= 33) "glasmio" else "legacy"
    }
    fun requiresUpdate(context: Context): Boolean =
        context.packageName == "com.folio.mobile.poc" &&
            context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0 &&
            variant != requiredVariant(Build.VERSION.SDK_INT)

    fun requireCompatible(context: Context) {
        check(!requiresUpdate(context)) { "softwareUpdate.compatibilityRequired" }
    }
}
