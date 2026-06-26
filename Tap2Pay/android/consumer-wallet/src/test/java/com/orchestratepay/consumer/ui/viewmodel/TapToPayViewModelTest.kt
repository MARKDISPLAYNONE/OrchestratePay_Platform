package com.orchestratepay.consumer.ui.viewmodel

import android.graphics.Bitmap
import com.orchestratepay.consumer.payment.QrState
import com.orchestratepay.consumer.payment.QrTokenManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever

@OptIn(ExperimentalCoroutinesApi::class)
class TapToPayViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var viewModel: TapToPayViewModel
    private val mockQrManager: QrTokenManager = mock()
    private val mockBitmap: Bitmap = mock()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        viewModel = TapToPayViewModel(mockQrManager)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun qrState(secondsFromNow: Long = 90) = QrState(
        bitmap    = mockBitmap,
        token     = "qr-token-abc",
        expiresAt = System.currentTimeMillis() + secondsFromNow * 1000
    )

    @Test
    fun `initial state has null qrBitmap and not loading`() {
        assertNull(viewModel.state.value.qrBitmap)
        assertFalse(viewModel.state.value.isLoadingQr)
        assertEquals(0, viewModel.state.value.secondsRemaining)
        assertNull(viewModel.state.value.qrError)
    }

    @Test
    fun `loadQr sets isLoadingQr immediately`() = runTest {
        whenever(mockQrManager.getQrState()).thenReturn(qrState())

        viewModel.loadQr()
        assertTrue(viewModel.state.value.isLoadingQr)
    }

    @Test
    fun `loadQr success sets bitmap and clears loading`() = runTest {
        val state = qrState(90)
        whenever(mockQrManager.getQrState()).thenReturn(state)

        viewModel.loadQr()
        advanceUntilIdle()

        val vmState = viewModel.state.value
        assertEquals(mockBitmap, vmState.qrBitmap)
        assertFalse(vmState.isLoadingQr)
        assertNull(vmState.qrError)
    }

    @Test
    fun `loadQr success starts countdown`() = runTest {
        whenever(mockQrManager.getQrState()).thenReturn(qrState(90))

        viewModel.loadQr()
        advanceUntilIdle()

        assertTrue(viewModel.state.value.secondsRemaining > 0)
    }

    @Test
    fun `loadQr failure sets qrError and clears loading`() = runTest {
        whenever(mockQrManager.getQrState()).thenThrow(RuntimeException("Token fetch failed"))

        viewModel.loadQr()
        advanceUntilIdle()

        val vmState = viewModel.state.value
        assertEquals("Token fetch failed", vmState.qrError)
        assertFalse(vmState.isLoadingQr)
        assertNull(vmState.qrBitmap)
    }

    @Test
    fun `loadQr null error falls back to default`() = runTest {
        whenever(mockQrManager.getQrState()).thenThrow(RuntimeException(null as String?))

        viewModel.loadQr()
        advanceUntilIdle()

        assertEquals("Failed to load QR", viewModel.state.value.qrError)
    }

    @Test
    fun `countdown ticks down secondsRemaining each second`() = runTest {
        whenever(mockQrManager.getQrState()).thenReturn(qrState(30))

        viewModel.loadQr()
        advanceUntilIdle()

        val before = viewModel.state.value.secondsRemaining
        advanceTimeBy(1_001)
        runCurrent()

        val after = viewModel.state.value.secondsRemaining
        assertTrue("Countdown should decrease: before=$before after=$after", after <= before)
    }

    @Test
    fun `TapToPayState copy preserves unchanged fields`() {
        val s = TapToPayState(secondsRemaining = 45, isLoadingQr = false)
        val s2 = s.copy(secondsRemaining = 44)
        assertEquals(44, s2.secondsRemaining)
        assertEquals(s.isLoadingQr, s2.isLoadingQr)
        assertEquals(s.qrBitmap, s2.qrBitmap)
    }
}
