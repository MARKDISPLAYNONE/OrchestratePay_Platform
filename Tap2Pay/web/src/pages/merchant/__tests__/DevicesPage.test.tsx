/**
 * Tests for the merchant devices / fleet management page.
 *
 * Covers: loading state, table column headers, device rows (serial, model,
 * app version, last-seen time), alert badges (count > 0 → red badge, 0 → dash),
 * empty state ("No devices registered yet"), and error display.
 */

import { render, screen, waitFor } from '@testing-library/react'
import DevicesPage from '@/pages/merchant/DevicesPage'

jest.mock('@/lib/api', () => ({
  devices: {
    getFleet: jest.fn(),
  },
}))

const mockGetFleet = jest.requireMock('@/lib/api').devices.getFleet as jest.Mock

const sampleDevices = [
  {
    id:               'dev-001',
    device_serial:    'SN-SUNMI-001',
    model:            'Sunmi P2 Pro',
    app_version_code: 42,
    last_seen_at:     new Date(Date.now() - 5 * 60_000).toISOString(), // 5 min ago
    active:           true,
    unresolved_alerts: 0,
  },
  {
    id:               'dev-002',
    device_serial:    'SN-SUNMI-002',
    model:            null,
    app_version_code: null,
    last_seen_at:     new Date(Date.now() - 90 * 60_000).toISOString(), // 90 min ago
    active:           false,
    unresolved_alerts: 3,
  },
  {
    id:               'dev-003',
    device_serial:    'SN-SUNMI-003',
    model:            'Sunmi P2 Mini',
    app_version_code: 38,
    last_seen_at:     null,
    active:           true,
    unresolved_alerts: 1,
  },
]

beforeEach(() => jest.clearAllMocks())

// ─── Loading state ────────────────────────────────────────────────────────────

describe('DevicesPage loading', () => {
  it('shows a loading indicator while fetching', () => {
    mockGetFleet.mockReturnValue(new Promise(() => {}))
    render(<DevicesPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows the page heading immediately', () => {
    mockGetFleet.mockReturnValue(new Promise(() => {}))
    render(<DevicesPage />)
    expect(screen.getByText('Devices')).toBeInTheDocument()
  })
})

// ─── Table structure ──────────────────────────────────────────────────────────

describe('DevicesPage table headers', () => {
  beforeEach(() => {
    mockGetFleet.mockResolvedValue(sampleDevices)
  })

  it('renders Serial column header', async () => {
    render(<DevicesPage />)
    await waitFor(() => expect(screen.getByText(/serial/i)).toBeInTheDocument())
  })

  it('renders Model column header', async () => {
    render(<DevicesPage />)
    await waitFor(() => expect(screen.getByText(/model/i)).toBeInTheDocument())
  })

  it('renders App version column header', async () => {
    render(<DevicesPage />)
    await waitFor(() => expect(screen.getByText(/app version/i)).toBeInTheDocument())
  })

  it('renders Last seen column header', async () => {
    render(<DevicesPage />)
    await waitFor(() => expect(screen.getByText(/last seen/i)).toBeInTheDocument())
  })

  it('renders Alerts column header', async () => {
    render(<DevicesPage />)
    await waitFor(() => expect(screen.getByText(/alerts/i)).toBeInTheDocument())
  })
})

// ─── Device rows ──────────────────────────────────────────────────────────────

describe('DevicesPage device data', () => {
  beforeEach(() => {
    mockGetFleet.mockResolvedValue(sampleDevices)
  })

  it('renders device serial numbers', async () => {
    render(<DevicesPage />)
    await waitFor(() => {
      expect(screen.getByText('SN-SUNMI-001')).toBeInTheDocument()
      expect(screen.getByText('SN-SUNMI-002')).toBeInTheDocument()
      expect(screen.getByText('SN-SUNMI-003')).toBeInTheDocument()
    })
  })

  it('renders device model name when present', async () => {
    render(<DevicesPage />)
    await waitFor(() =>
      expect(screen.getByText('Sunmi P2 Pro')).toBeInTheDocument()
    )
  })

  it('shows — for devices without a model', async () => {
    render(<DevicesPage />)
    await waitFor(() => {
      const dashes = screen.getAllByText('—')
      expect(dashes.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('renders app version code when present', async () => {
    render(<DevicesPage />)
    await waitFor(() =>
      expect(screen.getByText('42')).toBeInTheDocument()
    )
  })

  it('shows — for devices without app version', async () => {
    render(<DevicesPage />)
    await waitFor(() => {
      const dashes = screen.getAllByText('—')
      expect(dashes.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows "Never" for devices with no last_seen_at', async () => {
    render(<DevicesPage />)
    await waitFor(() =>
      expect(screen.getByText('Never')).toBeInTheDocument()
    )
  })

  it('shows "Just now" for a device last seen less than 1 minute ago', async () => {
    const justNowDevice = { ...sampleDevices[0], id: 'dev-fresh', last_seen_at: new Date().toISOString() }
    mockGetFleet.mockResolvedValue([justNowDevice])
    render(<DevicesPage />)
    await waitFor(() =>
      expect(screen.getByText('Just now')).toBeInTheDocument()
    )
  })
})

// ─── Alert badges ─────────────────────────────────────────────────────────────

describe('DevicesPage alert badges', () => {
  beforeEach(() => {
    mockGetFleet.mockResolvedValue(sampleDevices)
  })

  it('shows alert badge with count when unresolved_alerts > 0', async () => {
    render(<DevicesPage />)
    await waitFor(() => {
      expect(screen.getByText(/3 alerts/i)).toBeInTheDocument()
    })
  })

  it('shows "1 alert" (singular) when only one unresolved alert', async () => {
    render(<DevicesPage />)
    await waitFor(() => {
      expect(screen.getByText(/1 alert/i)).toBeInTheDocument()
    })
  })

  it('shows — (no badge) for devices with zero alerts', async () => {
    render(<DevicesPage />)
    await waitFor(() => {
      // dev-001 has 0 alerts — the dash placeholder renders
      const dashes = screen.getAllByText('—')
      expect(dashes.length).toBeGreaterThanOrEqual(1)
    })
  })
})

// ─── Empty state ──────────────────────────────────────────────────────────────

describe('DevicesPage empty state', () => {
  it('shows "No devices registered yet" when fleet is empty', async () => {
    mockGetFleet.mockResolvedValue([])
    render(<DevicesPage />)
    await waitFor(() =>
      expect(screen.getByText(/no devices registered yet/i)).toBeInTheDocument()
    )
  })
})

// ─── Error state ──────────────────────────────────────────────────────────────

describe('DevicesPage error state', () => {
  it('shows an error message when getFleet rejects', async () => {
    mockGetFleet.mockRejectedValue(new Error('Fleet fetch failed'))
    render(<DevicesPage />)
    await waitFor(() =>
      expect(screen.getByText(/fleet fetch failed/i)).toBeInTheDocument()
    )
  })
})
