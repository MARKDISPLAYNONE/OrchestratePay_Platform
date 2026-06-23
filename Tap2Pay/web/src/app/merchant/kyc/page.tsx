'use client'
import { useCallback, useEffect, useState } from 'react'
import { kyc as api } from '@/lib/api'

const DOC_TYPES = [
  { value: 'NATIONAL_ID',  label: 'National ID',           required: true  },
  { value: 'PASSPORT',     label: 'Passport',              required: false },
  { value: 'BUSINESS_REG', label: 'Business Registration', required: true  },
  { value: 'KRA_CERT',     label: 'KRA Tax Certificate',   required: true  },
  { value: 'SELFIE',       label: 'Selfie with ID',        required: false },
  { value: 'OTHER',        label: 'Other Document',        required: false },
]

const BUSINESS_TYPES = [
  { value: 'SOLE_TRADER',     label: 'Sole Trader' },
  { value: 'PARTNERSHIP',     label: 'Partnership' },
  { value: 'LIMITED_COMPANY', label: 'Limited Company' },
  { value: 'NGO',             label: 'NGO / Non-Profit' },
  { value: 'COOPERATIVE',     label: 'Cooperative Society' },
  { value: 'OTHER',           label: 'Other' },
]

const STATUS_BADGE: Record<string, string> = {
  NOT_SUBMITTED: 'bg-gray-100 text-gray-600',
  SUBMITTED:     'bg-yellow-100 text-yellow-800',
  UNDER_REVIEW:  'bg-blue-100  text-blue-800',
  APPROVED:      'bg-green-100 text-green-800',
  REJECTED:      'bg-red-100   text-red-800',
}

type Tab = 'documents' | 'business' | 'ownership'

interface KycDoc { id: string; doc_type: string; file_name?: string; verified: boolean; uploaded_at: string }
interface KycStatus {
  kycStatus: string; kycNotes?: string; kycSubmittedAt?: string;
  approvalStatus: string; documents: KycDoc[]; requiredMissing: string[]
}
interface BusinessDetails {
  business_type?: string; business_address_line1?: string; business_address_city?: string;
  nature_of_business?: string; expected_monthly_volume_cents?: number;
  beneficial_owner_name?: string; beneficial_owner_id_number?: string;
  beneficial_owner_ownership_pct?: number; kra_pin?: string;
  sanctions_status?: string; aml_risk_level?: string;
}

export default function KycPage() {
  const [tab,      setTab]      = useState<Tab>('documents')
  const [status,   setStatus]   = useState<KycStatus | null>(null)
  const [biz,      setBiz]      = useState<BusinessDetails | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState('')

  // Document upload state
  const [docType,  setDocType]  = useState('NATIONAL_ID')
  const [fileUrl,  setFileUrl]  = useState('')
  const [fileName, setFileName] = useState('')

  // Business details edit state
  const [businessType,  setBusinessType]  = useState('')
  const [addressLine1,  setAddressLine1]  = useState('')
  const [addressCity,   setAddressCity]   = useState('')
  const [natureOfBiz,   setNatureOfBiz]   = useState('')
  const [monthlyVolKes, setMonthlyVolKes] = useState('')
  const [kraPin,        setKraPin]        = useState('')

  // Ownership edit state
  const [ownerName,  setOwnerName]  = useState('')
  const [ownerIdNo,  setOwnerIdNo]  = useState('')
  const [ownerPct,   setOwnerPct]   = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, b] = await Promise.all([api.status(), api.businessDetails()])
      setStatus(s)
      setBiz(b)
      // Pre-fill edit fields
      setBusinessType(b.business_type ?? '')
      setAddressLine1(b.business_address_line1 ?? '')
      setAddressCity(b.business_address_city ?? '')
      setNatureOfBiz(b.nature_of_business ?? '')
      setMonthlyVolKes(b.expected_monthly_volume_cents ? String(Math.round(b.expected_monthly_volume_cents / 100)) : '')
      setKraPin(b.kra_pin ?? '')
      setOwnerName(b.beneficial_owner_name ?? '')
      setOwnerIdNo(b.beneficial_owner_id_number ?? '')
      setOwnerPct(b.beneficial_owner_ownership_pct ? String(b.beneficial_owner_ownership_pct) : '')
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Failed to load KYC data')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleDocSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!fileUrl.startsWith('http')) { setError('Please enter a valid URL'); return }
    setSaving(true); setError(''); setSuccess('')
    try {
      const res = await api.uploadDocument({ docType, fileUrl, fileName: fileName || undefined })
      setSuccess(res.allRequiredSubmitted ? 'All required documents submitted! Queued for review.' : 'Document saved.')
      setFileUrl(''); setFileName('')
      await load()
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Failed to save document')
    }
    setSaving(false)
  }

  async function handleBizSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(''); setSuccess('')
    const vol = parseInt(monthlyVolKes)
    try {
      await api.updateBusinessDetails({
        businessType:               businessType || undefined,
        businessAddressLine1:       addressLine1.trim() || undefined,
        businessAddressCity:        addressCity.trim()  || undefined,
        natureOfBusiness:           natureOfBiz.trim()  || undefined,
        expectedMonthlyVolumeCents: !isNaN(vol) && vol > 0 ? vol * 100 : undefined,
        kraPin:                     kraPin.trim()       || undefined,
      })
      setSuccess('Business details saved.')
      await load()
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Failed to save business details')
    }
    setSaving(false)
  }

  async function handleOwnerSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(''); setSuccess('')
    const pct = parseInt(ownerPct)
    try {
      await api.updateBusinessDetails({
        beneficialOwnerName:         ownerName.trim() || undefined,
        beneficialOwnerIdNumber:     ownerIdNo.trim() || undefined,
        beneficialOwnerOwnershipPct: !isNaN(pct) ? pct : undefined,
      })
      setSuccess('Beneficial ownership saved.')
      await load()
    } catch (err: unknown) {
      setError((err as Error).message ?? 'Failed to save ownership details')
    }
    setSaving(false)
  }

  const submittedTypes = status?.documents.map(d => d.doc_type) ?? []
  const kycDone = status?.kycStatus === 'APPROVED'
  const flagged = biz?.sanctions_status === 'FLAGGED'

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">KYC Verification</h1>

      {/* Status banner */}
      {status && (
        <div className={`rounded-xl p-4 border flex flex-wrap items-center gap-3 ${
          kycDone ? 'border-green-200 bg-green-50' :
          status.kycStatus === 'REJECTED' ? 'border-red-200 bg-red-50' :
          'border-blue-200 bg-blue-50'}`}>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${STATUS_BADGE[status.kycStatus] ?? 'bg-gray-100'}`}>
            {status.kycStatus.replace(/_/g, ' ')}
          </span>
          <span className="text-sm text-gray-700">
            {kycDone && 'Your account is fully verified.'}
            {status.kycStatus === 'UNDER_REVIEW' && 'Documents under review — 1–2 business days.'}
            {status.kycStatus === 'REJECTED' && `Not approved: ${status.kycNotes ?? 'See notes above'}`}
            {status.kycStatus === 'NOT_SUBMITTED' && 'Upload all 3 required documents to start the review process.'}
            {status.kycStatus === 'SUBMITTED' && 'All documents submitted. Awaiting admin review.'}
          </span>
          {flagged && (
            <span className="text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
              AML: Under compliance review
            </span>
          )}
        </div>
      )}

      {/* Required docs progress */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm font-semibold text-gray-700 mb-3">Required documents</p>
        <div className="flex flex-wrap gap-3">
          {DOC_TYPES.filter(d => d.required).map(doc => {
            const done = submittedTypes.includes(doc.value)
            return (
              <div key={doc.value} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border
                ${done ? 'border-green-300 bg-green-50 text-green-700' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                <span>{done ? '✓' : '○'}</span> {doc.label}
              </div>
            )
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-6">
          {(['documents', 'business', 'ownership'] as Tab[]).map(t => (
            <button key={t} onClick={() => { setError(''); setSuccess(''); setTab(t) }}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors capitalize
                ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t === 'documents' ? 'Documents' : t === 'business' ? 'Business Details' : 'Beneficial Ownership'}
            </button>
          ))}
        </div>
      </div>

      {error   && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {success && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{success}</p>}

      {/* ── DOCUMENTS TAB ── */}
      {tab === 'documents' && (
        <div className="space-y-6">
          {loading ? (
            <p className="text-gray-400 text-sm">Loading…</p>
          ) : (
            <>
              {/* Upload form — hide if APPROVED or UNDER_REVIEW */}
              {!['APPROVED', 'UNDER_REVIEW'].includes(status?.kycStatus ?? '') && (
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <h2 className="text-sm font-semibold text-gray-800 mb-1">Upload document</h2>
                  <p className="text-xs text-gray-500 mb-4">
                    Upload your documents to Google Drive / Dropbox (set to &quot;Anyone with link can view&quot;) and paste the URL below.
                  </p>
                  <form onSubmit={handleDocSubmit} className="space-y-4 max-w-md">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Document type</label>
                      <select value={docType} onChange={e => setDocType(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                        {DOC_TYPES.map(d => (
                          <option key={d.value} value={d.value}>{d.label}{d.required ? ' *' : ''}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Document URL *</label>
                      <input type="url" placeholder="https://drive.google.com/file/…" value={fileUrl}
                        onChange={e => setFileUrl(e.target.value)} required
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">File name (optional)</label>
                      <input type="text" placeholder="national_id.pdf" value={fileName}
                        onChange={e => setFileName(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <button type="submit" disabled={saving}
                      className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                      {saving ? 'Saving…' : 'Submit document'}
                    </button>
                  </form>
                </div>
              )}

              {/* Submitted documents */}
              {status && status.documents.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <h2 className="text-sm font-semibold text-gray-800 mb-3">Submitted documents</h2>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 text-xs border-b">
                        <th className="pb-2 pr-4">Type</th><th className="pb-2 pr-4">File</th>
                        <th className="pb-2 pr-4">Date</th><th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {status.documents.map(doc => (
                        <tr key={doc.id}>
                          <td className="py-2 pr-4">{DOC_TYPES.find(d => d.value === doc.doc_type)?.label ?? doc.doc_type}</td>
                          <td className="py-2 pr-4 text-gray-500">{doc.file_name ?? '—'}</td>
                          <td className="py-2 pr-4 text-gray-500">{new Date(doc.uploaded_at).toLocaleDateString()}</td>
                          <td className="py-2">
                            {doc.verified
                              ? <span className="text-green-600 font-medium text-xs">Verified</span>
                              : <span className="text-gray-400 text-xs">Pending review</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── BUSINESS TAB ── */}
      {tab === 'business' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <form onSubmit={handleBizSave} className="space-y-4 max-w-md">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Business type</label>
              <select value={businessType} onChange={e => setBusinessType(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="">Select…</option>
                {BUSINESS_TYPES.map(bt => <option key={bt.value} value={bt.value}>{bt.label}</option>)}
              </select>
            </div>
            <BizField label="Business address" value={addressLine1} onChange={setAddressLine1} placeholder="Shop 4, Kimathi St" />
            <BizField label="City" value={addressCity} onChange={setAddressCity} placeholder="Nairobi" />
            <BizField label="Nature of business" value={natureOfBiz} onChange={setNatureOfBiz} placeholder="Retail grocery store" />
            <BizField label="Expected monthly revenue (KES)" type="number" value={monthlyVolKes} onChange={setMonthlyVolKes} placeholder="200000" />
            <BizField label="KRA PIN" value={kraPin} onChange={setKraPin} placeholder="P051234567X" />
            {biz?.aml_risk_level && (
              <div className="text-xs text-gray-500">
                AML risk:{' '}
                <span className={`font-semibold ${biz.aml_risk_level === 'HIGH' ? 'text-red-600' : biz.aml_risk_level === 'MEDIUM' ? 'text-yellow-600' : 'text-green-600'}`}>
                  {biz.aml_risk_level}
                </span>
              </div>
            )}
            <button type="submit" disabled={saving}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save business details'}
            </button>
          </form>
        </div>
      )}

      {/* ── OWNERSHIP TAB ── */}
      {tab === 'ownership' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
            CBK AML regulations require disclosure of all individuals who own 10% or more of this business.
            Leave blank if you are a sole trader and the sole owner.
          </div>
          <form onSubmit={handleOwnerSave} className="space-y-4 max-w-md">
            <BizField label="Beneficial owner full name" value={ownerName} onChange={setOwnerName} placeholder="John Kamau Mwangi" />
            <BizField label="National ID / Passport number" value={ownerIdNo} onChange={setOwnerIdNo} placeholder="12345678" />
            <BizField label="Ownership %" type="number" value={ownerPct} onChange={setOwnerPct} placeholder="100" />
            <button type="submit" disabled={saving}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save ownership details'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

function BizField({ label, value, onChange, placeholder, type = 'text' }:
  { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }
) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  )
}
