/**
 * Tests for the merchant settings page.
 *
 * Covers: loading state, profile fields pre-filled with merchant data,
 * all field labels present, save triggers updateProfile API, success
 * feedback ("Saved ✓"), error feedback, and account info section.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MerchantSettingsPage from '../page'

jest.mock('@/lib/api', () => ({
  merchants: {
    getProfile:    jest.fn(),
    updateProfile: jest.fn(),
  },
}))

const mockGetProfile    = jest.requireMock('@/lib/api').merchants.getProfile    as jest.Mock
const mockUpdateProfile = jest.requireMock('@/lib/api').merchants.updateProfile as jest.Mock

const sampleProfile = {
  name:              'Baridi Café',
  phone:             '254712345678',
  mpesa_shortcode:   '174379',
  mpesa_account_ref: 'BaridiCafe',
  kra_pin:           'P051234567X',
}

beforeEach(() => jest.clearAllMocks())

// ─── Loading state ────────────────────────────────────────────────────────────

describe('SettingsPage loading', () => {
  it('shows a loading message while fetching the profile', () => {
    mockGetProfile.mockReturnValue(new Promise(() => {}))
    render(<MerchantSettingsPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })
})

// ─── Form structure ───────────────────────────────────────────────────────────

describe('SettingsPage form labels', () => {
  beforeEach(() => {
    mockGetProfile.mockResolvedValue(sampleProfile)
  })

  it('renders the page heading', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() =>
      expect(screen.getByText('Settings')).toBeInTheDocument()
    )
  })

  it('renders the Business name label', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() =>
      expect(screen.getByText('Business name')).toBeInTheDocument()
    )
  })

  it('renders the Contact phone label', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() =>
      expect(screen.getByText('Contact phone')).toBeInTheDocument()
    )
  })

  it('renders the M-Pesa Till / Paybill label', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() =>
      expect(screen.getByText(/m-pesa till/i)).toBeInTheDocument()
    )
  })

  it('renders the M-Pesa account ref label', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() =>
      expect(screen.getByText(/m-pesa account ref/i)).toBeInTheDocument()
    )
  })

  it('renders the KRA PIN label', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() =>
      expect(screen.getByText('KRA PIN')).toBeInTheDocument()
    )
  })

  it('renders the Save changes button', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
    )
  })
})

// ─── Pre-filled fields ────────────────────────────────────────────────────────

describe('SettingsPage pre-filled fields', () => {
  beforeEach(() => {
    mockGetProfile.mockResolvedValue(sampleProfile)
  })

  it('pre-fills the Business name field', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() =>
      expect(screen.getByDisplayValue('Baridi Café')).toBeInTheDocument()
    )
  })

  it('pre-fills the Contact phone field', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() =>
      expect(screen.getByDisplayValue('254712345678')).toBeInTheDocument()
    )
  })

  it('pre-fills the M-Pesa shortcode field', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() =>
      expect(screen.getByDisplayValue('174379')).toBeInTheDocument()
    )
  })

  it('pre-fills the M-Pesa account ref field', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() =>
      expect(screen.getByDisplayValue('BaridiCafe')).toBeInTheDocument()
    )
  })

  it('pre-fills the KRA PIN field', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() =>
      expect(screen.getByDisplayValue('P051234567X')).toBeInTheDocument()
    )
  })
})

// ─── Save success ─────────────────────────────────────────────────────────────

describe('SettingsPage save success', () => {
  beforeEach(() => {
    mockGetProfile.mockResolvedValue(sampleProfile)
    mockUpdateProfile.mockResolvedValue({ name: 'Baridi Café' })
  })

  it('calls updateProfile when the form is submitted', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() => screen.getByRole('button', { name: /save changes/i }))
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1)
  })

  it('passes the current field values to updateProfile', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() => screen.getByDisplayValue('Baridi Café'))
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith(expect.objectContaining({
        name:           'Baridi Café',
        phone:          '254712345678',
        mpesaShortcode: '174379',
        kraPin:         'P051234567X',
      }))
    )
  })

  it('shows "Saved ✓" after a successful save', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() => screen.getByRole('button', { name: /save changes/i }))
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /saved/i })).toBeInTheDocument()
    )
  })

  it('shows "Saving…" while the request is in-flight', async () => {
    mockUpdateProfile.mockReturnValue(new Promise(() => {}))
    render(<MerchantSettingsPage />)
    await waitFor(() => screen.getByRole('button', { name: /save changes/i }))
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
  })
})

// ─── Save error ───────────────────────────────────────────────────────────────

describe('SettingsPage save error', () => {
  beforeEach(() => {
    mockGetProfile.mockResolvedValue(sampleProfile)
    mockUpdateProfile.mockRejectedValue(new Error('Update failed — try again'))
  })

  it('shows an error message when updateProfile rejects', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() => screen.getByRole('button', { name: /save changes/i }))
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(screen.getByText(/update failed/i)).toBeInTheDocument()
    )
  })

  it('still renders the form after an error', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() => screen.getByRole('button', { name: /save changes/i }))
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => screen.getByText(/update failed/i))
    expect(screen.getByDisplayValue('Baridi Café')).toBeInTheDocument()
  })
})

// ─── Account info section ─────────────────────────────────────────────────────

describe('SettingsPage account info section', () => {
  beforeEach(() => {
    mockGetProfile.mockResolvedValue(sampleProfile)
  })

  it('renders the Account info heading', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() =>
      expect(screen.getByText(/account info/i)).toBeInTheDocument()
    )
  })

  it('shows the support email link', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() =>
      expect(screen.getByText(/support@orchestratepay\.co\.ke/i)).toBeInTheDocument()
    )
  })

  it('mentions password / email change process', async () => {
    render(<MerchantSettingsPage />)
    await waitFor(() =>
      expect(screen.getByText(/change your email or password/i)).toBeInTheDocument()
    )
  })
})
