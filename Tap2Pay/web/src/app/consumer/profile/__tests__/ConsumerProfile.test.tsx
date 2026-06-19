/**
 * Tests for the consumer profile page.
 *
 * Covers: loading state, profile data display (phone read-only, email),
 * display-name field is editable, save triggers consumers.updateProfile (PATCH),
 * success feedback ("Saved ✓"), error feedback on save failure,
 * SMS opt-in checkbox toggle.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProfilePage from '../page'

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('@/lib/api', () => ({
  consumers: {
    getProfile:    jest.fn(),
    updateProfile: jest.fn(),
  },
}))

const mockGetProfile    = jest.requireMock('@/lib/api').consumers.getProfile    as jest.Mock
const mockUpdateProfile = jest.requireMock('@/lib/api').consumers.updateProfile as jest.Mock

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const profileFull = {
  phone:        '0712***456',   // server-side masked value
  email:        'alice@example.com',
  display_name: 'Alice',
  sms_opt_in:   false,
}

const profileNoEmail = {
  phone:        '0700***789',
  email:        null,
  display_name: 'Bob',
  sms_opt_in:   true,
}

beforeEach(() => jest.clearAllMocks())

// ─── Loading state ─────────────────────────────────────────────────────────────

describe('ProfilePage loading', () => {
  it('shows loading indicator before profile resolves', () => {
    mockGetProfile.mockReturnValue(new Promise(() => {}))
    render(<ProfilePage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('removes loading indicator after profile resolves', async () => {
    mockGetProfile.mockResolvedValue(profileFull)
    render(<ProfilePage />)
    await waitFor(() =>
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
    )
  })
})

// ─── Profile data display ─────────────────────────────────────────────────────

describe('ProfilePage profile data display', () => {
  it('renders the Profile heading', async () => {
    mockGetProfile.mockResolvedValue(profileFull)
    render(<ProfilePage />)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /^profile$/i })).toBeInTheDocument()
    )
  })

  it('displays the phone number from the profile', async () => {
    mockGetProfile.mockResolvedValue(profileFull)
    render(<ProfilePage />)
    await waitFor(() =>
      expect(screen.getByText('0712***456')).toBeInTheDocument()
    )
  })

  it('displays the email when present', async () => {
    mockGetProfile.mockResolvedValue(profileFull)
    render(<ProfilePage />)
    await waitFor(() =>
      expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    )
  })

  it('does not render an email field when email is absent', async () => {
    mockGetProfile.mockResolvedValue(profileNoEmail)
    render(<ProfilePage />)
    await waitFor(() =>
      expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument()
    )
  })

  it('phone is rendered as plain text (not an input), making it read-only', async () => {
    mockGetProfile.mockResolvedValue(profileFull)
    render(<ProfilePage />)
    await waitFor(() => screen.getByText('0712***456'))
    // The phone number element must not be an editable input
    const phoneEl = screen.getByText('0712***456')
    expect(phoneEl.tagName).not.toBe('INPUT')
  })

  it('pre-fills the display name input with the profile value', async () => {
    mockGetProfile.mockResolvedValue(profileFull)
    render(<ProfilePage />)
    await waitFor(() => {
      const input = screen.getByLabelText(/display name/i) as HTMLInputElement
      expect(input.value).toBe('Alice')
    })
  })

  it('pre-fills the SMS opt-in checkbox from the profile', async () => {
    mockGetProfile.mockResolvedValue({ ...profileFull, sms_opt_in: true })
    render(<ProfilePage />)
    await waitFor(() => {
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement
      expect(checkbox.checked).toBe(true)
    })
  })
})

// ─── Display name editing ─────────────────────────────────────────────────────

describe('ProfilePage display name is editable', () => {
  it('allows typing in the display name input', async () => {
    mockGetProfile.mockResolvedValue(profileFull)
    render(<ProfilePage />)
    await waitFor(() => screen.getByLabelText(/display name/i))
    const input = screen.getByLabelText(/display name/i) as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, 'Alicia')
    expect(input.value).toBe('Alicia')
  })
})

// ─── Save — success ───────────────────────────────────────────────────────────

describe('ProfilePage save success', () => {
  async function setupAndSave(profileData = profileFull) {
    mockGetProfile.mockResolvedValue(profileData)
    mockUpdateProfile.mockResolvedValue({})
    render(<ProfilePage />)
    await waitFor(() => screen.getByLabelText(/display name/i))
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
  }

  it('calls updateProfile on form submit', async () => {
    await setupAndSave()
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledTimes(1)
    )
  })

  it('passes the current displayName and smsOptIn to updateProfile', async () => {
    await setupAndSave()
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        displayName: 'Alice',
        smsOptIn: false,
      })
    )
  })

  it('shows "Saved ✓" confirmation after a successful save', async () => {
    await setupAndSave()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /saved/i })).toBeInTheDocument()
    )
  })

  it('passes updated display name when user changes it before saving', async () => {
    mockGetProfile.mockResolvedValue(profileFull)
    mockUpdateProfile.mockResolvedValue({})
    render(<ProfilePage />)
    await waitFor(() => screen.getByLabelText(/display name/i))
    const input = screen.getByLabelText(/display name/i)
    await userEvent.clear(input)
    await userEvent.type(input, 'Alicia')
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith({
        displayName: 'Alicia',
        smsOptIn: false,
      })
    )
  })

  it('passes smsOptIn: true when checkbox is toggled on', async () => {
    mockGetProfile.mockResolvedValue({ ...profileFull, sms_opt_in: false })
    mockUpdateProfile.mockResolvedValue({})
    render(<ProfilePage />)
    await waitFor(() => screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ smsOptIn: true })
      )
    )
  })
})

// ─── Save — error ─────────────────────────────────────────────────────────────

describe('ProfilePage save error', () => {
  it('shows an error message when save fails', async () => {
    mockGetProfile.mockResolvedValue(profileFull)
    mockUpdateProfile.mockRejectedValue(new Error('Server error — please try again.'))
    render(<ProfilePage />)
    await waitFor(() => screen.getByRole('button', { name: /save changes/i }))
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(screen.getByText(/server error — please try again/i)).toBeInTheDocument()
    )
  })

  it('shows the generic fallback when the error has no message', async () => {
    mockGetProfile.mockResolvedValue(profileFull)
    mockUpdateProfile.mockRejectedValue({})
    render(<ProfilePage />)
    await waitFor(() => screen.getByRole('button', { name: /save changes/i }))
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(screen.getByText(/failed to save/i)).toBeInTheDocument()
    )
  })

  it('still shows the Save button (not "Saved ✓") after a failed save', async () => {
    mockGetProfile.mockResolvedValue(profileFull)
    mockUpdateProfile.mockRejectedValue(new Error('Oops'))
    render(<ProfilePage />)
    await waitFor(() => screen.getByRole('button', { name: /save changes/i }))
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => screen.getByText(/oops/i))
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /saved/i })).not.toBeInTheDocument()
  })
})
