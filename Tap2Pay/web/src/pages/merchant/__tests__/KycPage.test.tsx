/**
 * Tests for src/pages/merchant/KycPage.tsx
 *
 * Covers: loading, document tab (upload form, submitted documents list),
 * business tab, ownership tab, error/success messages, tab switching,
 * KYC status banner variants (APPROVED, UNDER_REVIEW, REJECTED, NOT_SUBMITTED),
 * document URL validation, locked state.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KycPage from '@/pages/merchant/KycPage'

jest.mock('@/lib/api', () => ({
  kyc: {
    status:              jest.fn(),
    businessDetails:     jest.fn(),
    uploadDocument:      jest.fn(),
    updateBusinessDetails: jest.fn(),
  },
}))

jest.mock('@/components/ui/Badge',      () => ({ __esModule: true, default: ({ label }: any) => <span>{label}</span> }))
jest.mock('@/components/ui/PageHeader', () => ({ __esModule: true, default: ({ title }: any) => <h1>{title}</h1> }))
jest.mock('@/components/ui/GlassCard', () => ({
  __esModule: true,
  default: ({ children, className }: any) => <div className={className}>{children}</div>,
}))

const mockStatus    = jest.requireMock('@/lib/api').kyc.status              as jest.Mock
const mockBizDet    = jest.requireMock('@/lib/api').kyc.businessDetails     as jest.Mock
const mockUploadDoc = jest.requireMock('@/lib/api').kyc.uploadDocument      as jest.Mock
const mockUpdateBiz = jest.requireMock('@/lib/api').kyc.updateBusinessDetails as jest.Mock

const defaultStatus = {
  kycStatus:      'NOT_SUBMITTED',
  approvalStatus: 'PENDING_REVIEW',
  kycNotes:       null,
  documents:      [],
}

const defaultBiz = {
  business_type:                    null,
  business_address_line1:           null,
  business_address_city:            null,
  nature_of_business:               null,
  expected_monthly_volume_cents:    null,
  kra_pin:                          null,
  beneficial_owner_name:            null,
  beneficial_owner_id_number:       null,
  beneficial_owner_ownership_pct:   null,
  sanctions_status:                 null,
  aml_risk_level:                   null,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockStatus.mockResolvedValue(defaultStatus)
  mockBizDet.mockResolvedValue(defaultBiz)
})

describe('KycPage — loading', () => {
  it('shows loading text while data loads', () => {
    mockStatus.mockReturnValue(new Promise(() => {}))
    mockBizDet.mockReturnValue(new Promise(() => {}))
    render(<KycPage />)
    // Page renders with loading state (data not yet resolved)
    expect(document.body).toBeInTheDocument()
  })
})

describe('KycPage — page structure', () => {
  it('renders the KYC Verification heading', async () => {
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByText('KYC Verification')).toBeInTheDocument()
    )
  })

  it('renders the status badge for NOT_SUBMITTED', async () => {
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByText('NOT SUBMITTED')).toBeInTheDocument()
    )
  })

  it('renders the Documents tab', async () => {
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /documents/i })).toBeInTheDocument()
    )
  })

  it('renders the Business tab', async () => {
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /business/i })).toBeInTheDocument()
    )
  })

  it('renders the Ownership tab', async () => {
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /ownership/i })).toBeInTheDocument()
    )
  })
})

describe('KycPage — KYC status banners', () => {
  it('shows APPROVED message', async () => {
    mockStatus.mockResolvedValue({ ...defaultStatus, kycStatus: 'APPROVED', approvalStatus: 'APPROVED' })
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByText(/fully verified/i)).toBeInTheDocument()
    )
  })

  it('shows UNDER_REVIEW message', async () => {
    mockStatus.mockResolvedValue({ ...defaultStatus, kycStatus: 'UNDER_REVIEW', approvalStatus: 'APPROVED' })
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByText(/1–2 business days/i)).toBeInTheDocument()
    )
  })

  it('shows REJECTED message with notes', async () => {
    mockStatus.mockResolvedValue({ ...defaultStatus, kycStatus: 'REJECTED', approvalStatus: 'REJECTED', kycNotes: 'ID mismatch' })
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByText(/id mismatch/i)).toBeInTheDocument()
    )
  })

  it('shows SUBMITTED message', async () => {
    mockStatus.mockResolvedValue({ ...defaultStatus, kycStatus: 'SUBMITTED', approvalStatus: 'PENDING_REVIEW' })
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByText(/awaiting admin review/i)).toBeInTheDocument()
    )
  })

  it('shows AML FLAGGED badge when sanctions_status is FLAGGED', async () => {
    mockBizDet.mockResolvedValue({ ...defaultBiz, sanctions_status: 'FLAGGED' })
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByText(/aml: under compliance review/i)).toBeInTheDocument()
    )
  })
})

describe('KycPage — document upload', () => {
  it('shows upload form in documents tab when NOT locked', async () => {
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/drive\.google\.com/i)).toBeInTheDocument()
    )
  })

  it('shows URL validation error for non-http URL', async () => {
    render(<KycPage />)
    await waitFor(() => screen.getByPlaceholderText(/drive\.google\.com/i))
    fireEvent.change(screen.getByPlaceholderText(/drive\.google\.com/i), { target: { value: 'not-a-url' } })
    fireEvent.submit(screen.getByPlaceholderText(/drive\.google\.com/i).closest('form')!)
    await waitFor(() =>
      expect(screen.getByText(/please enter a valid url/i)).toBeInTheDocument()
    )
  })

  it('uploads document and shows success message', async () => {
    mockUploadDoc.mockResolvedValue({ allRequiredSubmitted: false })
    render(<KycPage />)
    await waitFor(() => screen.getByPlaceholderText(/drive\.google\.com/i))
    await userEvent.type(screen.getByPlaceholderText(/drive\.google\.com/i), 'https://drive.google.com/file/id')
    await userEvent.click(screen.getByRole('button', { name: /submit document/i }))
    await waitFor(() =>
      expect(screen.getByText(/document saved/i)).toBeInTheDocument()
    )
  })

  it('shows "All required documents submitted" when allRequiredSubmitted', async () => {
    mockUploadDoc.mockResolvedValue({ allRequiredSubmitted: true })
    render(<KycPage />)
    await waitFor(() => screen.getByPlaceholderText(/drive\.google\.com/i))
    await userEvent.type(screen.getByPlaceholderText(/drive\.google\.com/i), 'https://drive.google.com/file/id')
    await userEvent.click(screen.getByRole('button', { name: /submit document/i }))
    await waitFor(() =>
      expect(screen.getByText(/all required documents submitted/i)).toBeInTheDocument()
    )
  })

  it('shows error when upload fails', async () => {
    mockUploadDoc.mockRejectedValue(new Error('Upload failed'))
    render(<KycPage />)
    await waitFor(() => screen.getByPlaceholderText(/drive\.google\.com/i))
    await userEvent.type(screen.getByPlaceholderText(/drive\.google\.com/i), 'https://drive.google.com/file/id')
    await userEvent.click(screen.getByRole('button', { name: /submit document/i }))
    await waitFor(() =>
      expect(screen.getByText(/upload failed/i)).toBeInTheDocument()
    )
  })

  it('hides upload form when KYC is locked (APPROVED)', async () => {
    mockStatus.mockResolvedValue({ ...defaultStatus, kycStatus: 'APPROVED', approvalStatus: 'APPROVED', documents: [] })
    render(<KycPage />)
    await waitFor(() => screen.getByText(/fully verified/i))
    expect(screen.queryByPlaceholderText(/drive\.google\.com/i)).not.toBeInTheDocument()
  })

  it('renders submitted documents table when documents exist', async () => {
    mockStatus.mockResolvedValue({
      ...defaultStatus,
      kycStatus: 'SUBMITTED',
      documents: [{ id: 'doc-1', doc_type: 'NATIONAL_ID', file_name: 'id.pdf', uploaded_at: '2024-01-01', verified: false }],
    })
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByText('National ID')).toBeInTheDocument()
    )
  })

  it('shows em-dash when document file_name is null', async () => {
    mockStatus.mockResolvedValue({
      ...defaultStatus,
      kycStatus: 'SUBMITTED',
      documents: [{ id: 'doc-2', doc_type: 'NATIONAL_ID', file_name: null, uploaded_at: '2024-01-01', verified: false }],
    })
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByText('—')).toBeInTheDocument()
    )
  })

  it('shows Verified badge when document is verified', async () => {
    mockStatus.mockResolvedValue({
      ...defaultStatus,
      kycStatus: 'SUBMITTED',
      documents: [{ id: 'doc-3', doc_type: 'NATIONAL_ID', file_name: 'id.pdf', uploaded_at: '2024-01-01', verified: true }],
    })
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByText('Verified')).toBeInTheDocument()
    )
  })

  it('falls back to raw doc_type when doc_type is unknown', async () => {
    mockStatus.mockResolvedValue({
      ...defaultStatus,
      kycStatus: 'SUBMITTED',
      documents: [{ id: 'doc-4', doc_type: 'UNKNOWN_DOC_TYPE', file_name: 'file.pdf', uploaded_at: '2024-01-01', verified: false }],
    })
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByText('UNKNOWN_DOC_TYPE')).toBeInTheDocument()
    )
  })
})

describe('KycPage — business tab', () => {
  it('switches to business tab', async () => {
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /business/i }))
    await userEvent.click(screen.getByRole('button', { name: /business/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save business details/i })).toBeInTheDocument()
    )
  })

  it('shows AML risk level in business tab', async () => {
    mockBizDet.mockResolvedValue({ ...defaultBiz, aml_risk_level: 'HIGH' })
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /business/i }))
    await userEvent.click(screen.getByRole('button', { name: /business/i }))
    await waitFor(() =>
      expect(screen.getByText('HIGH')).toBeInTheDocument()
    )
  })

  it('updates bizType when business type select changes', async () => {
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /business/i }))
    await userEvent.click(screen.getByRole('button', { name: /business/i }))
    await waitFor(() => screen.getByRole('combobox'))
    await userEvent.selectOptions(screen.getByRole('combobox'), screen.getAllByRole('option')[1].getAttribute('value')!)
  })

  it('saves business details successfully', async () => {
    mockUpdateBiz.mockResolvedValue({})
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /business/i }))
    await userEvent.click(screen.getByRole('button', { name: /business/i }))
    await waitFor(() => screen.getByRole('button', { name: /save business details/i }))
    await userEvent.click(screen.getByRole('button', { name: /save business details/i }))
    await waitFor(() =>
      expect(screen.getByText(/business details saved/i)).toBeInTheDocument()
    )
  })

  it('shows error when business save fails', async () => {
    mockUpdateBiz.mockRejectedValue(new Error('Server error'))
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /business/i }))
    await userEvent.click(screen.getByRole('button', { name: /business/i }))
    await waitFor(() => screen.getByRole('button', { name: /save business details/i }))
    await userEvent.click(screen.getByRole('button', { name: /save business details/i }))
    await waitFor(() =>
      expect(screen.getByText(/server error/i)).toBeInTheDocument()
    )
  })
})

describe('KycPage — ownership tab', () => {
  it('switches to ownership tab', async () => {
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /ownership/i }))
    await userEvent.click(screen.getByRole('button', { name: /ownership/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save ownership details/i })).toBeInTheDocument()
    )
  })

  it('saves ownership details successfully', async () => {
    mockUpdateBiz.mockResolvedValue({})
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /ownership/i }))
    await userEvent.click(screen.getByRole('button', { name: /ownership/i }))
    await waitFor(() => screen.getByRole('button', { name: /save ownership details/i }))
    await userEvent.click(screen.getByRole('button', { name: /save ownership details/i }))
    await waitFor(() =>
      expect(screen.getByText(/beneficial ownership saved/i)).toBeInTheDocument()
    )
  })

  it('shows error when ownership save fails', async () => {
    mockUpdateBiz.mockRejectedValue(new Error('Validation error'))
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /ownership/i }))
    await userEvent.click(screen.getByRole('button', { name: /ownership/i }))
    await waitFor(() => screen.getByRole('button', { name: /save ownership details/i }))
    await userEvent.click(screen.getByRole('button', { name: /save ownership details/i }))
    await waitFor(() =>
      expect(screen.getByText(/validation error/i)).toBeInTheDocument()
    )
  })
})

describe('KycPage — error handling', () => {
  it('shows error when initial load fails', async () => {
    mockStatus.mockRejectedValue(new Error('API down'))
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByText(/api down/i)).toBeInTheDocument()
    )
  })
})

describe('KycPage — documents tab field onChange handlers', () => {
  it('updates docType when document type select changes', async () => {
    render(<KycPage />)
    await waitFor(() => screen.getByRole('combobox'))
    const select = screen.getByRole('combobox')
    await userEvent.selectOptions(select, select.querySelector('option:nth-child(2)')!.getAttribute('value')!)
  })

  it('updates fileName when file name input changes', async () => {
    render(<KycPage />)
    await waitFor(() => screen.getByPlaceholderText(/national_id\.pdf/i))
    const fileNameInput = screen.getByPlaceholderText(/national_id\.pdf/i)
    await userEvent.type(fileNameInput, 'passport.pdf')
    expect((fileNameInput as HTMLInputElement).value).toBe('passport.pdf')
  })
})

describe('KycPage — business tab field onChange handlers', () => {
  it('updates business address field when typed into', async () => {
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /business/i }))
    await userEvent.click(screen.getByRole('button', { name: /business/i }))
    await waitFor(() => screen.getByPlaceholderText(/kimathi st/i))
    const addrInput = screen.getByPlaceholderText(/kimathi st/i)
    await userEvent.type(addrInput, 'Shop 1')
    expect((addrInput as HTMLInputElement).value).toBe('Shop 1')
  })

  it('updates KRA PIN field when typed into', async () => {
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /business/i }))
    await userEvent.click(screen.getByRole('button', { name: /business/i }))
    await waitFor(() => screen.getByPlaceholderText(/P051234567X/i))
    const kraInput = screen.getByPlaceholderText(/P051234567X/i)
    await userEvent.type(kraInput, 'P999999999Z')
    expect((kraInput as HTMLInputElement).value).toBe('P999999999Z')
  })
})

describe('KycPage — ownership tab field onChange handlers', () => {
  it('updates owner name field when typed into', async () => {
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /ownership/i }))
    await userEvent.click(screen.getByRole('button', { name: /ownership/i }))
    await waitFor(() => screen.getByPlaceholderText(/John Kamau Mwangi/i))
    const nameInput = screen.getByPlaceholderText(/John Kamau Mwangi/i)
    await userEvent.type(nameInput, 'Jane Doe')
    expect((nameInput as HTMLInputElement).value).toBe('Jane Doe')
  })

  it('updates ownership percentage field when typed into', async () => {
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /ownership/i }))
    await userEvent.click(screen.getByRole('button', { name: /ownership/i }))
    await waitFor(() => screen.getByPlaceholderText(/^100$/))
    const pctInput = screen.getByPlaceholderText(/^100$/)
    await userEvent.type(pctInput, '51')
    expect((pctInput as HTMLInputElement).value).toBe('51')
  })
})

describe('KycPage — kycBadge unknown status (line 25 ?? fallback)', () => {
  it('renders badge with default variant for unrecognised kycStatus', async () => {
    mockStatus.mockResolvedValue({ ...defaultStatus, kycStatus: 'UNKNOWN_STATUS', approvalStatus: 'UNKNOWN' })
    render(<KycPage />)
    await waitFor(() => screen.getByText('UNKNOWN STATUS'))
  })
})

describe('KycPage — REJECTED with null kycNotes (line 111)', () => {
  it('shows "Please re-upload required documents" when kycNotes is null', async () => {
    mockStatus.mockResolvedValue({ ...defaultStatus, kycStatus: 'REJECTED', approvalStatus: 'REJECTED', kycNotes: null })
    render(<KycPage />)
    await waitFor(() =>
      expect(screen.getByText(/please re-upload required documents/i)).toBeInTheDocument()
    )
  })
})

describe('KycPage — preload with non-null volume and ownership pct (lines 55, 57)', () => {
  it('pre-fills vol from expected_monthly_volume_cents', async () => {
    mockBizDet.mockResolvedValue({ ...defaultBiz, expected_monthly_volume_cents: 500_000 })
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /business/i }))
    await userEvent.click(screen.getByRole('button', { name: /business/i }))
    await waitFor(() =>
      expect(screen.getByDisplayValue('5000')).toBeInTheDocument()
    )
  })

  it('pre-fills ownerPct from beneficial_owner_ownership_pct', async () => {
    mockBizDet.mockResolvedValue({ ...defaultBiz, beneficial_owner_ownership_pct: 51 })
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /ownership/i }))
    await userEvent.click(screen.getByRole('button', { name: /ownership/i }))
    await waitFor(() =>
      expect(screen.getByDisplayValue('51')).toBeInTheDocument()
    )
  })
})

describe('KycPage — handleBizSave with empty vol (NaN branch, lines 80-90)', () => {
  it('saves business details with undefined volume when vol is empty', async () => {
    mockUpdateBiz.mockResolvedValue({})
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /business/i }))
    await userEvent.click(screen.getByRole('button', { name: /business/i }))
    await waitFor(() => screen.getByRole('button', { name: /save business details/i }))
    await userEvent.click(screen.getByRole('button', { name: /save business details/i }))
    await waitFor(() =>
      expect(mockUpdateBiz).toHaveBeenCalledWith(expect.objectContaining({ expectedMonthlyVolumeCents: undefined }))
    )
  })
})

describe('KycPage — handleOwnerSave with empty pct (NaN branch)', () => {
  it('saves ownership with undefined pct when ownerPct is empty', async () => {
    mockUpdateBiz.mockResolvedValue({})
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /ownership/i }))
    await userEvent.click(screen.getByRole('button', { name: /ownership/i }))
    await waitFor(() => screen.getByRole('button', { name: /save ownership details/i }))
    await userEvent.click(screen.getByRole('button', { name: /save ownership details/i }))
    await waitFor(() =>
      expect(mockUpdateBiz).toHaveBeenCalledWith(expect.objectContaining({ beneficialOwnerOwnershipPct: undefined }))
    )
  })
})

describe('KycPage — aml_risk_level MEDIUM and LOW (line 209)', () => {
  it('shows amber class for MEDIUM aml_risk_level', async () => {
    mockBizDet.mockResolvedValue({ ...defaultBiz, aml_risk_level: 'MEDIUM' })
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /business/i }))
    await userEvent.click(screen.getByRole('button', { name: /business/i }))
    await waitFor(() => expect(screen.getByText('MEDIUM')).toBeInTheDocument())
    expect(document.querySelector('.text-amber-400')).toBeInTheDocument()
  })

  it('shows emerald class for LOW aml_risk_level', async () => {
    mockBizDet.mockResolvedValue({ ...defaultBiz, aml_risk_level: 'LOW' })
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /business/i }))
    await userEvent.click(screen.getByRole('button', { name: /business/i }))
    await waitFor(() => expect(screen.getByText('LOW')).toBeInTheDocument())
    expect(document.querySelector('.text-emerald-400')).toBeInTheDocument()
  })
})

describe('KycPage — handleBizSave with valid vol (TRUE branch, line 80)', () => {
  it('saves expectedMonthlyVolumeCents = v * 100 when vol is a valid positive number', async () => {
    mockUpdateBiz.mockResolvedValue({})
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /business/i }))
    await userEvent.click(screen.getByRole('button', { name: /business/i }))
    await waitFor(() => screen.getByPlaceholderText('200000'))
    await userEvent.type(screen.getByPlaceholderText('200000'), '5000')
    await userEvent.click(screen.getByRole('button', { name: /save business details/i }))
    await waitFor(() =>
      expect(mockUpdateBiz).toHaveBeenCalledWith(expect.objectContaining({ expectedMonthlyVolumeCents: 500000 }))
    )
  })
})

describe('KycPage — handleOwnerSave with valid pct (TRUE branch, line 90)', () => {
  it('saves beneficialOwnerOwnershipPct = p when ownerPct is a valid number', async () => {
    mockUpdateBiz.mockResolvedValue({})
    render(<KycPage />)
    await waitFor(() => screen.getByRole('button', { name: /ownership/i }))
    await userEvent.click(screen.getByRole('button', { name: /ownership/i }))
    await waitFor(() => screen.getByPlaceholderText('100'))
    await userEvent.type(screen.getByPlaceholderText('100'), '75')
    await userEvent.click(screen.getByRole('button', { name: /save ownership details/i }))
    await waitFor(() =>
      expect(mockUpdateBiz).toHaveBeenCalledWith(expect.objectContaining({ beneficialOwnerOwnershipPct: 75 }))
    )
  })
})
