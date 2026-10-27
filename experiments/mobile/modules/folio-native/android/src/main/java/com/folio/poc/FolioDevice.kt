package com.folio.poc

// APK 按 ABI 拆分，架构名称与发布清单保持一致。
internal fun folioAndroidArch(): String =
    if (android.os.Process.is64Bit() && android.os.Build.SUPPORTED_ABIS.firstOrNull()?.startsWith("arm") == true) "arm64" else "x64"
