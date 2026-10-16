package com.folio.poc.navigation

import org.junit.Assert.assertEquals
import org.junit.Test

// 覆盖字体轴的小数步进、负范围与端点收敛。
class FolioSliderValueTest {
    @Test fun snapsFromMinimum() {
        assertEquals(10.3, snapSliderValue(10.31, 10.25, 12.0, 0.05), 0.0)
        assertEquals(-1.75, snapSliderValue(-1.8, -2.0, 2.0, 0.25), 0.0)
        assertEquals(0.15, snapSliderValue(0.125, 0.0, 1.0, 0.05), 0.0)
        assertEquals(0.17, snapSliderValue(0.168, 0.0, 1.0, 0.01), 0.0)
    }

    @Test fun clampsEndpointsAndPartialSteps() {
        assertEquals(16.0, snapSliderValue(-10.0, 16.0, 64.0, 1.0), 0.0)
        assertEquals(64.0, snapSliderValue(90.0, 16.0, 64.0, 1.0), 0.0)
        assertEquals(1.0, snapSliderValue(1.03, 0.0, 1.03, 0.1), 0.0)
        assertEquals(1.03, snapSliderValue(1.1, 0.0, 1.03, 0.1), 0.0)
    }

    @Test fun handlesContinuousAndInvalidInputs() {
        assertEquals(0.1234, snapSliderValue(0.1234, 0.0, 1.0, 0.0), 0.0)
        assertEquals(0.0, snapSliderValue(Double.NaN, 0.0, 1.0, 1.0), 0.0)
        assertEquals(3.0, snapSliderValue(4.0, 3.0, 3.0, 1.0), 0.0)
    }
}
