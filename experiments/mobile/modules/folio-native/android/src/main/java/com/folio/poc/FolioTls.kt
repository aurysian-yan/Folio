package com.folio.poc

import android.content.Context

// 与共享 Rust 的系统证书校验器建立 JVM 连接，不绕过 HTTPS 校验。
object FolioTls {
    init { System.loadLibrary("folio_ffi") }
    @JvmStatic external fun initialize(context: Context)
}
