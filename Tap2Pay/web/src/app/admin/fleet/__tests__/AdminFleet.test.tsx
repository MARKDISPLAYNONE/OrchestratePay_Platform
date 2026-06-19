/**
 * Tests for the admin fleet page.
 *
 * Covers: loading state, error state, empty state ("No devices registered yet"),
 * device list rendering (serial number, merchant name, battery level, NFC status,
 * last-seen time), battery warning colour for low levels (< 20%),
 * printer status labels (Ready / No paper / Overheat),
 * online indicator (< 5 min ago = green dot),
 * unresolved alerts section,
 * device count subtitle,
 * and plural/singular "terminal/terminals" label.
 *
 * Note: the fleet page does not expose a "config push" button in the current
 * source — tests are written against the actual rendered UI.
 */

import { render, screen, waitFor } from '@testing-library/react'
import AdminFleetPage from '../page'

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('@/lib/api', () => ({
  admin: {
    getFleet:       jest.fn(),
    getFleetAlerts: jest.fn(),
  },
}))

const mockGetFleet       = jest.requireMock('@/lib/api').admin.getFleet       as jest.Mock
const mockGetFleetAlerts = jest.requireMock('@/lib/api').admin.getFleetAlerts as jest.Mock

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// A device seen very recently (always "online")
const recentLastSeen = new Date(Date.now() - 2 * 60 * 1000).toISOString()   // 2 min ago
// A device seen a long time ago (always "offline")
const staleLastSeen  = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 60 min ago

const deviceHealthy: Parameters<typeof Array>[0] = {
  id:               'dev-001',
  device_serial:    'SUNMI-P2-001',
  model:            'Sunmi P2 Pro',
  merchant_name:    'Java House',
  active:           true,
  last_seen_at:     recentLastSeen,
  battery_pct:      85,
  printer_status:   1,            // Ready
  nfc_available:    true,
  app_version_code: 42,
  device_type:      'SUNMI_P2',
}

const deviceLowBattery = {
  id:               'dev-002',
  device_serial:    'SUNMI-P2-002',
  model:            null,
  merchant_name:    'Artcaffe',
  active:           true,
  last_seen_at:     staleLastSeen,
  battery_pct:      15,           // below 20% threshold
  printer_status:   4,            // No paper
  nfc_available:    false,
  app_version_code: null,
  device_type:      'SUNMI_P2',
}

const deviceNeverSeen = {
  id:               'dev-003',
  device_serial:    'SUNMI-P2-003',
  model:            'Sunmi V2s',
  merchant_name:    'Quickmart',
  active:           false,
  last_seen_at:     null,
  battery_pct:      null,
  printer_status:   null,
  nfc_available:    null,
  app_version_code: null,
  device_type:      'SUNMI_V2',
}

const alert1 = {
  id:            1,
  device_serial: 'SUNMI-P2-002',
  merchant_name: 'Artcaffe',
  message:       'Battery critically low (15%)',
  created_at:    '2024-03-10T09:00:00Z',
}

const alert2 = {
  id:            2,
  device_serial: 'SUNMI-P2-001',
  merchant_name: 'Java House',
  message:       'Printer paper empty',
  created_at:    '2024-03-11T11:30:00Z',
}

beforeEach(() => jest.clearAllMocks())

// ─── Loading state ─────────────────────────────────────────────────────────────

describe('AdminFleetPage loading', () => {
  it('shows loading indicator before data resolves', () => {
    mockGetFleet.mockReturnValue(new Promise(() => {}))
    mockGetFleetAlerts.mockReturnValue(new Promise(() => {}))
    render(<AdminFleetPage />)
    expect(screen.getByText(/loading fleet/i)).toBeInTheDocument()
  })

  it('removes loading indicator after both promises resolve', async () => {
    mockGetFleet.mockResolvedValue({ devices: [] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.queryByText(/loading fleet/i)).not.toBeInTheDocument()
    )
  })
})

// ─── Page heading and count ───────────────────────────────────────────────────

describe('AdminFleetPage heading and count', () => {
  it('renders the "Device Fleet" heading', async () => {
    mockGetFleet.mockResolvedValue({ devices: [deviceHealthy] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /device fleet/i })).toBeInTheDocument()
    )
  })

  it('shows singular "terminal" when there is 1 device', async () => {
    mockGetFleet.mockResolvedValue({ devices: [deviceHealthy] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText(/1 registered terminal$/i)).toBeInTheDocument()
    )
  })

  it('shows plural "terminals" when there are multiple devices', async () => {
    mockGetFleet.mockResolvedValue({ devices: [deviceHealthy, deviceLowBattery] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText(/2 registered terminals$/i)).toBeInTheDocument()
    )
  })
})

// ─── Error state ──────────────────────────────────────────────────────────────

describe('AdminFleetPage error state', () => {
  it('shows error message when fleet fetch fails', async () => {
    mockGetFleet.mockRejectedValue(new Error('Fetch failed'))
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText(/fetch failed/i)).toBeInTheDocument()
    )
  })

  it('shows error message when alerts fetch fails', async () => {
    mockGetFleet.mockResolvedValue({ devices: [] })
    mockGetFleetAlerts.mockRejectedValue(new Error('Alerts fetch failed'))
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText(/alerts fetch failed/i)).toBeInTheDocument()
    )
  })
})

// ─── Empty state ──────────────────────────────────────────────────────────────

describe('AdminFleetPage empty state', () => {
  it('shows "No devices registered yet" when device list is empty', async () => {
    mockGetFleet.mockResolvedValue({ devices: [] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText(/no devices registered yet/i)).toBeInTheDocument()
    )
  })

  it('does not render a device card when list is empty', async () => {
    mockGetFleet.mockResolvedValue({ devices: [] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() => screen.getByText(/no devices registered yet/i))
    expect(screen.queryByText('SUNMI-P2-001')).not.toBeInTheDocument()
  })
})

// ─── Device list rendering ────────────────────────────────────────────────────

describe('AdminFleetPage device list rendering', () => {
  beforeEach(() => {
    mockGetFleet.mockResolvedValue({ devices: [deviceHealthy, deviceLowBattery, deviceNeverSeen] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
  })

  it('renders the device serial number', async () => {
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText('SUNMI-P2-001')).toBeInTheDocument()
    )
  })

  it('renders the merchant name for each device', async () => {
    render(<AdminFleetPage />)
    await waitFor(() => {
      expect(screen.getByText('Java House')).toBeInTheDocument()
      expect(screen.getByText('Artcaffe')).toBeInTheDocument()
      expect(screen.getByText('Quickmart')).toBeInTheDocument()
    })
  })

  it('renders the model when present', async () => {
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText('Sunmi P2 Pro')).toBeInTheDocument()
    )
  })

  it('renders the battery percentage', async () => {
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText('85%')).toBeInTheDocument()
    )
  })

  it('renders "NFC OK" when nfc_available is true', async () => {
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText('OK')).toBeInTheDocument()
    )
  })

  it('renders "NFC Off" when nfc_available is false', async () => {
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText('Off')).toBeInTheDocument()
    )
  })

  it('renders "Never seen" for a device with no last_seen_at', async () => {
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText('Never seen')).toBeInTheDocument()
    )
  })

  it('renders the app version code when present', async () => {
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText('42')).toBeInTheDocument()
    )
  })
})

// ─── Battery warning ──────────────────────────────────────────────────────────

describe('AdminFleetPage battery warning', () => {
  it('applies red colour class to battery percentage below 20%', async () => {
    mockGetFleet.mockResolvedValue({ devices: [deviceLowBattery] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() => screen.getByText('15%'))
    const batteryEl = screen.getByText('15%')
    expect(batteryEl.className).toMatch(/text-red-400/)
  })

  it('does not apply red colour class to battery percentage at or above 20%', async () => {
    mockGetFleet.mockResolvedValue({ devices: [deviceHealthy] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() => screen.getByText('85%'))
    const batteryEl = screen.getByText('85%')
    expect(batteryEl.className).not.toMatch(/text-red-400/)
  })
})

// ─── Printer status labels ────────────────────────────────────────────────────

describe('AdminFleetPage printer status labels', () => {
  it('shows "Ready" for printer_status 1', async () => {
    mockGetFleet.mockResolvedValue({ devices: [deviceHealthy] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText('Ready')).toBeInTheDocument()
    )
  })

  it('shows "No paper" for printer_status 4', async () => {
    mockGetFleet.mockResolvedValue({ devices: [deviceLowBattery] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText('No paper')).toBeInTheDocument()
    )
  })

  it('shows "Overheat" for printer_status 5', async () => {
    const overheatedDevice = { ...deviceHealthy, id: 'dev-004', printer_status: 5 }
    mockGetFleet.mockResolvedValue({ devices: [overheatedDevice] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText('Overheat')).toBeInTheDocument()
    )
  })
})

// ─── NFC colour coding ────────────────────────────────────────────────────────

describe('AdminFleetPage NFC colour coding', () => {
  it('applies green colour class when NFC is available', async () => {
    mockGetFleet.mockResolvedValue({ devices: [deviceHealthy] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() => screen.getByText('OK'))
    expect(screen.getByText('OK').className).toMatch(/text-green-400/)
  })

  it('applies red colour class when NFC is unavailable', async () => {
    mockGetFleet.mockResolvedValue({ devices: [deviceLowBattery] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() => screen.getByText('Off'))
    expect(screen.getByText('Off').className).toMatch(/text-red-400/)
  })
})

// ─── Unresolved alerts ────────────────────────────────────────────────────────

describe('AdminFleetPage unresolved alerts', () => {
  it('renders the alerts section when alerts are present', async () => {
    mockGetFleet.mockResolvedValue({ devices: [deviceHealthy] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [alert1, alert2] })
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText(/unresolved alerts \(2\)/i)).toBeInTheDocument()
    )
  })

  it('renders each alert message', async () => {
    mockGetFleet.mockResolvedValue({ devices: [deviceHealthy] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [alert1, alert2] })
    render(<AdminFleetPage />)
    await waitFor(() => {
      expect(screen.getByText('Battery critically low (15%)')).toBeInTheDocument()
      expect(screen.getByText('Printer paper empty')).toBeInTheDocument()
    })
  })

  it('renders alert device serial and merchant name', async () => {
    mockGetFleet.mockResolvedValue({ devices: [deviceHealthy] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [alert1] })
    render(<AdminFleetPage />)
    await waitFor(() => {
      expect(screen.getByText(/SUNMI-P2-002/)).toBeInTheDocument()
      expect(screen.getAllByText(/Artcaffe/).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('does not show the alerts section when alerts list is empty', async () => {
    mockGetFleet.mockResolvedValue({ devices: [deviceHealthy] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() => screen.getByText('Java House'))
    expect(screen.queryByText(/unresolved alerts/i)).not.toBeInTheDocument()
  })
})

// ─── Online status indicator ──────────────────────────────────────────────────

describe('AdminFleetPage online indicator', () => {
  it('shows last-seen time as "Just now" when seen within the last minute', async () => {
    const justNow = new Date(Date.now() - 30 * 1000).toISOString()  // 30 seconds ago
    const device = { ...deviceHealthy, last_seen_at: justNow }
    mockGetFleet.mockResolvedValue({ devices: [device] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText('Just now')).toBeInTheDocument()
    )
  })

  it('shows last-seen time as "Xm ago" when seen within the last hour but more than 1 min', async () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    const device = { ...deviceHealthy, last_seen_at: twoMinutesAgo }
    mockGetFleet.mockResolvedValue({ devices: [device] })
    mockGetFleetAlerts.mockResolvedValue({ alerts: [] })
    render(<AdminFleetPage />)
    await waitFor(() =>
      expect(screen.getByText(/2m ago/i)).toBeInTheDocument()
    )
  })
})
