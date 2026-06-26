/**
 * Tests for src/pages/ConsumerScanPage.tsx
 *
 * Covers: NFC unsupported state, ready state, scanning state, cancel,
 * successful tag read → redirect, invalid tag → error, permission denied,
 * abort error swallowed, reading error handler.
 */
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConsumerScanPage from '@/pages/ConsumerScanPage'

const mockNavigate = jest.fn()

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

jest.mock('@/components/ui/GlassCard', () => ({
  __esModule: true,
  default: ({ children, className }: any) => <div className={className}>{children}</div>,
}))

class MockNDEFReader {
  onreading:      ((e: any) => void) | null = null
  onreadingerror: (() => void) | null       = null
  async scan(_opts?: any) {}
}

beforeEach(() => {
  jest.clearAllMocks()
  delete (window as any).NDEFReader
})

// ── NFC unsupported ────────────────────────────────────────────────────────────

describe('ConsumerScanPage — NFC unsupported', () => {
  it('shows NFC not available message', async () => {
    render(<ConsumerScanPage />)
    await waitFor(() =>
      expect(screen.getByText(/nfc not available/i)).toBeInTheDocument()
    )
  })

  it('does not show Scan button', async () => {
    render(<ConsumerScanPage />)
    await waitFor(() => screen.getByText(/nfc not available/i))
    expect(screen.queryByRole('button', { name: /scan/i })).not.toBeInTheDocument()
  })
})

// ── NFC supported — ready state ───────────────────────────────────────────────

describe('ConsumerScanPage — NFC supported', () => {
  beforeEach(() => {
    ;(window as any).NDEFReader = MockNDEFReader
  })

  it('shows ready state with scan button', async () => {
    render(<ConsumerScanPage />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /scan merchant tag/i })).toBeInTheDocument()
    )
  })

  it('transitions to scanning state when scan button clicked', async () => {
    render(<ConsumerScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /scan merchant tag/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan merchant tag/i }))
    await waitFor(() =>
      expect(screen.getByText(/scanning/i)).toBeInTheDocument()
    )
  })

  it('shows Cancel button during scanning', async () => {
    render(<ConsumerScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /scan merchant tag/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan merchant tag/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    )
  })

  it('returns to ready state on cancel', async () => {
    render(<ConsumerScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /scan merchant tag/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan merchant tag/i }))
    await waitFor(() => screen.getByRole('button', { name: /cancel/i }))
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /scan merchant tag/i })).toBeInTheDocument()
    )
  })
})

// ── Successful tag read ────────────────────────────────────────────────────────

describe('ConsumerScanPage — successful merchant tag read', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
  })

  it('navigates to /pay/:merchantId when a valid pay URL is read', async () => {
    render(<ConsumerScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /scan merchant tag/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan merchant tag/i }))
    await waitFor(() => screen.getByText(/scanning/i))

    const url     = 'https://orchestratepay.co.ke/pay/merch-123'
    const encoded = new TextEncoder().encode('\x00' + url)
    const record  = { data: { buffer: encoded.buffer } }

    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [record] } } as any)
    })

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/pay/merch-123')
    )
  })

  it('shows redirecting state when tag is read', async () => {
    render(<ConsumerScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /scan merchant tag/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan merchant tag/i }))
    await waitFor(() => screen.getByText(/scanning/i))

    const url     = 'https://orchestratepay.co.ke/pay/merch-xyz'
    const encoded = new TextEncoder().encode('\x00' + url)

    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })

    await waitFor(() =>
      expect(screen.getByText(/loading payment/i)).toBeInTheDocument()
    )
  })
})

// ── Invalid / non-merchant tag ─────────────────────────────────────────────────

describe('ConsumerScanPage — invalid tag', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
  })

  it('shows error for a non-merchant tag', async () => {
    render(<ConsumerScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /scan merchant tag/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan merchant tag/i }))
    await waitFor(() => screen.getByText(/scanning/i))

    const url     = 'https://example.com/not-a-merchant'
    const encoded = new TextEncoder().encode('\x00' + url)

    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: { buffer: encoded.buffer } }] } } as any)
    })

    await waitFor(() =>
      expect(screen.getByText(/not a merchant payment tag/i)).toBeInTheDocument()
    )
  })

  it('shows error on reading error', async () => {
    render(<ConsumerScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /scan merchant tag/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan merchant tag/i }))
    await waitFor(() => screen.getByText(/scanning/i))

    await act(async () => {
      ndefInstance.onreadingerror?.()
    })

    await waitFor(() =>
      expect(screen.getByText(/could not read tag/i)).toBeInTheDocument()
    )
  })
})

// ── Permission denied ─────────────────────────────────────────────────────────

describe('ConsumerScanPage — NFC permission denied', () => {
  it('shows permission denied error', async () => {
    ;(window as any).NDEFReader = class {
      async scan() {
        const err = new Error('Permission denied')
        ;(err as any).name = 'NotAllowedError'
        throw err
      }
    }
    render(<ConsumerScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /scan merchant tag/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan merchant tag/i }))
    await waitFor(() =>
      expect(screen.getByText(/nfc permission denied/i)).toBeInTheDocument()
    )
  })
})

// ── Generic scan error ────────────────────────────────────────────────────────

describe('ConsumerScanPage — generic scan error', () => {
  it('shows generic error message', async () => {
    ;(window as any).NDEFReader = class {
      async scan() {
        throw new Error('Hardware failure')
      }
    }
    render(<ConsumerScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /scan merchant tag/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan merchant tag/i }))
    await waitFor(() =>
      expect(screen.getByText(/hardware failure/i)).toBeInTheDocument()
    )
  })
})

// ── AbortError is silently swallowed (branch 38 TRUE) ────────────────────────

describe('ConsumerScanPage — AbortError is ignored (line 38 TRUE)', () => {
  it('does not show an error message when scan throws AbortError', async () => {
    ;(window as any).NDEFReader = class {
      async scan() {
        const err = new Error('User aborted')
        ;(err as any).name = 'AbortError'
        throw err
      }
    }
    render(<ConsumerScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /scan merchant tag/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan merchant tag/i }))
    // After AbortError the component returns early (no setState reset) — page stays in scanning state
    // No error text should appear
    await waitFor(() =>
      expect(screen.queryByText(/abort/i)).not.toBeInTheDocument()
    )
    expect(screen.queryByText(/nfc scan failed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/permission denied/i)).not.toBeInTheDocument()
  })
})

// ── Scan error with no message → ?? fallback (line 39 binary-expr right) ──────

describe('ConsumerScanPage — scan error with no message (line 39 ?? fallback)', () => {
  it('shows "NFC scan failed" when error has no message and is not NotAllowedError', async () => {
    ;(window as any).NDEFReader = class {
      async scan() {
        throw { name: 'SomeOtherError' } // no message property
      }
    }
    render(<ConsumerScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /scan merchant tag/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan merchant tag/i }))
    await waitFor(() =>
      expect(screen.getByText(/nfc scan failed/i)).toBeInTheDocument()
    )
  })
})

// ── Tag with null data ────────────────────────────────────────────────────────

describe('ConsumerScanPage — tag with null record data', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
  })

  it('skips null-data records and shows not-merchant error', async () => {
    render(<ConsumerScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /scan merchant tag/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan merchant tag/i }))
    await waitFor(() => screen.getByText(/scanning/i))

    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [{ data: null }] } } as any)
    })

    await waitFor(() =>
      expect(screen.getByText(/not a merchant payment tag/i)).toBeInTheDocument()
    )
  })
})

describe('ConsumerScanPage — extractUrl fallback (full bytes path)', () => {
  let ndefInstance: MockNDEFReader

  beforeEach(() => {
    ;(window as any).NDEFReader = class extends MockNDEFReader {
      async scan() { ndefInstance = this }
    }
  })

  it('extracts URL from full bytes when slice(1) does not start with http', async () => {
    // No prefix byte — so slice(1) = 'ttps://...' (doesn't match), full = 'https://...' (matches)
    render(<ConsumerScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /scan merchant tag/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan merchant tag/i }))
    await waitFor(() => screen.getByText(/scanning/i))

    const url = 'https://orchestratepay.co.ke/pay/merch-fullbytes'
    const encoded = new TextEncoder().encode(url) // no prefix byte
    const record = { data: { buffer: encoded.buffer } }

    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [record] } } as any)
    })

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/pay/merch-fullbytes')
    )
  })

  it('shows not-merchant error when neither raw nor full bytes are a valid URL', async () => {
    render(<ConsumerScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /scan merchant tag/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan merchant tag/i }))
    await waitFor(() => screen.getByText(/scanning/i))

    // Random bytes that don't decode to http/orchestratepay
    const encoded = new Uint8Array([0xFF, 0x00, 0x01, 0x02])
    const record = { data: { buffer: encoded.buffer } }

    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [record] } } as any)
    })

    await waitFor(() =>
      expect(screen.getByText(/not a merchant payment tag/i)).toBeInTheDocument()
    )
  })

  it('catches extractUrl exception (data.buffer = -1 → RangeError → catch returns null)', async () => {
    render(<ConsumerScanPage />)
    await waitFor(() => screen.getByRole('button', { name: /scan merchant tag/i }))
    await userEvent.click(screen.getByRole('button', { name: /scan merchant tag/i }))
    await waitFor(() => screen.getByText(/scanning/i))

    // data.buffer = -1 → new Uint8Array(-1) throws RangeError → catch { return null }
    const record = { data: { buffer: -1 } }

    await act(async () => {
      ndefInstance.onreading?.({ message: { records: [record] } } as any)
    })

    await waitFor(() =>
      expect(screen.getByText(/not a merchant payment tag/i)).toBeInTheDocument()
    )
  })
})
