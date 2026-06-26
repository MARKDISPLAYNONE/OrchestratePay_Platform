import { useCallback, useEffect, useState } from 'react'
import { kyc as api } from '@/lib/api'
import Badge from '@/components/ui/Badge'
import PageHeader from '@/components/ui/PageHeader'
import GlassCard from '@/components/ui/GlassCard'

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

const kycBadge = (s: string) => ({ APPROVED: 'confirmed', REJECTED: 'failed', UNDER_REVIEW: 'blue', SUBMITTED: 'pending', NOT_SUBMITTED: 'default' } as Record<string, string>)[s] ?? 'default'
type Tab = 'documents' | 'business' | 'ownership'

export default function KycPage() {
  const [tab, setTab]       = useState<Tab>('documents')
  const [status, setStatus] = useState<any>(null)
  const [biz, setBiz]       = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')
  const [docType, setDocType] = useState('NATIONAL_ID')
  const [fileUrl, setFileUrl] = useState('')
  const [fileName, setFileName] = useState('')
  const [bizType, setBizType]   = useState('')
  const [addr1, setAddr1]       = useState('')
  const [city, setCity]         = useState('')
  const [nature, setNature]     = useState('')
  const [vol, setVol]           = useState('')
  const [kra, setKra]           = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerIdNo, setOwnerIdNo] = useState('')
  const [ownerPct, setOwnerPct]   = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, b] = await Promise.all([api.status(), api.businessDetails()])
      setStatus(s); setBiz(b)
      setBizType(b.business_type ?? ''); setAddr1(b.business_address_line1 ?? ''); setCity(b.business_address_city ?? '')
      setNature(b.nature_of_business ?? ''); setVol(b.expected_monthly_volume_cents ? String(Math.round(b.expected_monthly_volume_cents / 100)) : '')
      setKra(b.kra_pin ?? ''); setOwnerName(b.beneficial_owner_name ?? ''); setOwnerIdNo(b.beneficial_owner_id_number ?? '')
      setOwnerPct(b.beneficial_owner_ownership_pct ? String(b.beneficial_owner_ownership_pct) : '')
    } catch (e: any) { setError(e.message) }
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
      setFileUrl(''); setFileName(''); await load()
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }

  async function handleBizSave(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError(''); setSuccess('')
    const v = parseInt(vol)
    try {
      await api.updateBusinessDetails({ businessType: bizType || undefined, businessAddressLine1: addr1.trim() || undefined, businessAddressCity: city.trim() || undefined, natureOfBusiness: nature.trim() || undefined, expectedMonthlyVolumeCents: !isNaN(v) && v > 0 ? v * 100 : undefined, kraPin: kra.trim() || undefined })
      setSuccess('Business details saved.'); await load()
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }

  async function handleOwnerSave(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError(''); setSuccess('')
    const p = parseInt(ownerPct)
    try {
      await api.updateBusinessDetails({ beneficialOwnerName: ownerName.trim() || undefined, beneficialOwnerIdNumber: ownerIdNo.trim() || undefined, beneficialOwnerOwnershipPct: !isNaN(p) ? p : undefined })
      setSuccess('Beneficial ownership saved.'); await load()
    } catch (e: any) { setError(e.message) }
    setSaving(false)
  }

  const submitted = status?.documents.map((d: any) => d.doc_type) ?? []
  const kycDone   = status?.kycStatus === 'APPROVED'
  const locked    = ['APPROVED', 'UNDER_REVIEW'].includes(status?.kycStatus ?? '')

  return (
    <div className="space-y-6">
      <PageHeader title="KYC Verification" subtitle="Complete identity verification to accept payments." />

      {/* Status banner */}
      {status && (
        <div className={`rounded-xl px-5 py-4 border flex flex-wrap items-center gap-3 ${kycDone ? 'border-emerald-500/20 bg-emerald-500/5' : status.kycStatus === 'REJECTED' ? 'border-red-500/20 bg-red-500/5' : 'border-electric/20 bg-electric/5'}`}>
          <Badge label={status.kycStatus.replace(/_/g, ' ')} variant={kycBadge(status.kycStatus) as any} />
          <span className="text-sm text-slate-400">
            {kycDone && 'Your account is fully verified.'}
            {status.kycStatus === 'UNDER_REVIEW' && 'Documents under review — 1–2 business days.'}
            {status.kycStatus === 'REJECTED' && `Not approved: ${status.kycNotes ?? 'Please re-upload required documents'}`}
            {status.kycStatus === 'NOT_SUBMITTED' && 'Upload all 3 required documents to begin the review.'}
            {status.kycStatus === 'SUBMITTED' && 'All documents submitted — awaiting admin review.'}
          </span>
          {biz?.sanctions_status === 'FLAGGED' && <Badge label="AML: Under compliance review" variant="failed" />}
        </div>
      )}

      {/* Required docs checklist */}
      <GlassCard className="p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Required documents</p>
        <div className="flex flex-wrap gap-2">
          {DOC_TYPES.filter(d => d.required).map(doc => {
            const done = submitted.includes(doc.value)
            return (
              <div key={doc.value} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${done ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-white/8 text-slate-500'}`}>
                <span>{done ? '✓' : '○'}</span> {doc.label}
              </div>
            )
          })}
        </div>
      </GlassCard>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-white/4 w-fit">
        {(['documents', 'business', 'ownership'] as Tab[]).map(t => (
          <button key={t} onClick={() => { setError(''); setSuccess(''); setTab(t) }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${tab === t ? 'bg-electric/15 text-electric' : 'text-slate-500 hover:text-slate-300'}`}>
            {t === 'documents' ? 'Documents' : t === 'business' ? 'Business' : 'Ownership'}
          </button>
        ))}
      </div>

      {error   && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-emerald-400">{success}</p>}

      {/* Documents tab */}
      {tab === 'documents' && (
        <div className="space-y-5">
          {!locked && (
            <GlassCard className="p-6">
              <h2 className="text-sm font-semibold text-slate-300 mb-1">Upload document</h2>
              <p className="text-xs text-slate-600 mb-4">Upload to Google Drive / Dropbox (set link to &quot;Anyone can view&quot;) and paste URL below.</p>
              <form onSubmit={handleDocSubmit} className="space-y-3 max-w-md">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Document type</label>
                  <select value={docType} onChange={e => setDocType(e.target.value)} className="input-dark">
                    {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}{d.required ? ' *' : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Document URL *</label>
                  <input type="url" placeholder="https://drive.google.com/file/…" value={fileUrl} onChange={e => setFileUrl(e.target.value)} required className="input-dark" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">File name <span className="text-slate-700">(optional)</span></label>
                  <input type="text" placeholder="national_id.pdf" value={fileName} onChange={e => setFileName(e.target.value)} className="input-dark" />
                </div>
                <button type="submit" disabled={saving} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Submit document'}</button>
              </form>
            </GlassCard>
          )}
          {status?.documents.length > 0 && (
            <GlassCard className="overflow-hidden">
              <div className="px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-widest" style={{ borderBottom: '1px solid rgba(0,175,255,0.08)' }}>Submitted</div>
              <table className="w-full text-sm">
                <thead><tr style={{ borderBottom: '1px solid rgba(0,175,255,0.06)' }}>{['Type', 'File', 'Date', 'Status'].map(h => <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-widest">{h}</th>)}</tr></thead>
                <tbody>{status.documents.map((d: any) => (
                  <tr key={d.id} className="table-row-dark">
                    <td className="px-5 py-2.5 text-slate-300">{DOC_TYPES.find(dt => dt.value === d.doc_type)?.label ?? d.doc_type}</td>
                    <td className="px-5 py-2.5 text-slate-500 text-xs">{d.file_name ?? '—'}</td>
                    <td className="px-5 py-2.5 text-slate-500 text-xs">{new Date(d.uploaded_at).toLocaleDateString()}</td>
                    <td className="px-5 py-2.5">{d.verified ? <Badge label="Verified" variant="confirmed" /> : <Badge label="Pending" variant="pending" />}</td>
                  </tr>
                ))}</tbody>
              </table>
            </GlassCard>
          )}
        </div>
      )}

      {/* Business tab */}
      {tab === 'business' && (
        <GlassCard className="p-6">
          <form onSubmit={handleBizSave} className="space-y-4 max-w-md">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Business type</label>
              <select value={bizType} onChange={e => setBizType(e.target.value)} className="input-dark">
                <option value="">Select…</option>
                {BUSINESS_TYPES.map(bt => <option key={bt.value} value={bt.value}>{bt.label}</option>)}
              </select>
            </div>
            {[['Business address', addr1, setAddr1, 'Shop 4, Kimathi St'], ['City', city, setCity, 'Nairobi'], ['Nature of business', nature, setNature, 'Retail grocery store'], ['Expected monthly revenue (KES)', vol, setVol, '200000'], ['KRA PIN', kra, setKra, 'P051234567X']].map(([label, val, setter, ph]) => (
              <div key={label as string}>
                <label className="block text-xs font-medium text-slate-400 mb-1">{label as string}</label>
                <input type="text" placeholder={ph as string} value={val as string} onChange={e => (setter as any)(e.target.value)} className="input-dark" />
              </div>
            ))}
            {biz?.aml_risk_level && <p className="text-xs text-slate-600">AML risk: <span className={biz.aml_risk_level === 'HIGH' ? 'text-red-400' : biz.aml_risk_level === 'MEDIUM' ? 'text-amber-400' : 'text-emerald-400'}>{biz.aml_risk_level}</span></p>}
            <button type="submit" disabled={saving} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save business details'}</button>
          </form>
        </GlassCard>
      )}

      {/* Ownership tab */}
      {tab === 'ownership' && (
        <GlassCard className="p-6 space-y-4">
          <div className="px-4 py-3 rounded-xl text-xs text-amber-400 border border-amber-500/20 bg-amber-500/5">
            CBK AML regulations require disclosure of all individuals who own 10% or more of this business.
          </div>
          <form onSubmit={handleOwnerSave} className="space-y-4 max-w-md">
            {[['Full name', ownerName, setOwnerName, 'John Kamau Mwangi'], ['National ID / Passport no.', ownerIdNo, setOwnerIdNo, '12345678'], ['Ownership %', ownerPct, setOwnerPct, '100']].map(([label, val, setter, ph]) => (
              <div key={label as string}>
                <label className="block text-xs font-medium text-slate-400 mb-1">{label as string}</label>
                <input type="text" placeholder={ph as string} value={val as string} onChange={e => (setter as any)(e.target.value)} className="input-dark" />
              </div>
            ))}
            <p className="text-xs text-slate-600">Leave blank if you are a sole trader and the sole owner.</p>
            <button type="submit" disabled={saving} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save ownership details'}</button>
          </form>
        </GlassCard>
      )}
    </div>
  )
}
