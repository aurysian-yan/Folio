package com.folio.poc

import org.junit.Assert.assertEquals
import org.junit.Test

class FolioAndroidBuildTest {
    @Test fun selectsLegacyThroughAndroid12L() {
        for (sdk in 30..32) assertEquals("legacy", FolioAndroidBuild.requiredVariant(sdk))
    }

    @Test fun selectsGlasmioStartingAtAndroid13() {
        for (sdk in 33..37) assertEquals("glasmio", FolioAndroidBuild.requiredVariant(sdk))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsUnsupportedAndroid() {
        FolioAndroidBuild.requiredVariant(29)
    }
}
