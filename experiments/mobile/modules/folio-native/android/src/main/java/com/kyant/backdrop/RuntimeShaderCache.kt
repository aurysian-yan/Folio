package com.kyant.backdrop

import android.annotation.SuppressLint
import org.intellij.lang.annotations.Language

sealed interface RuntimeShaderCache {

    fun obtainRuntimeShader(key: String, @Language("AGSL") string: String): RuntimeShader
}

internal class RuntimeShaderCacheImpl : RuntimeShaderCache {

    @SuppressLint("NewApi")
    override fun obtainRuntimeShader(key: String, string: String): RuntimeShader {
        return ShaderRegistry.runtimeShaders.getOrPut(key) { RuntimeShader(string) }
    }

    fun clear() {

    }
}

private object ShaderRegistry {
    val runtimeShaders = mutableMapOf<String, RuntimeShader>()
}
