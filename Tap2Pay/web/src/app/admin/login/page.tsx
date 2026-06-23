'use client'
import { useState }            from 'react'
import { useRouter }           from 'next/navigation'
import { saveAdminSecret, verifyAdminSecret } from '@/lib/api'

export default function AdminLoginPage() {
  const router = useRouter()
  const [secret, setSecret]       = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await verifyAdminSecret(secret)
      saveAdminSecret(secret)
      router.push('/admin')
    } catch {
      setError('Invalid admin secret — check your .env ADMIN_SECRET value.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gray-900 p-4">
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "url('/pattern.svg')", backgroundRepeat: 'repeat', backgroundSize: '320px 320px', opacity: 0.07 }} />
      <div className="w-full max-w-sm bg-gray-800 rounded-2xl border border-gray-700 p-8">

        {/* Back button */}
        <button
          onClick={() => router.push('/auth/login')}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors mb-6"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          Back to login
        </button>

        <div className="text-center mb-8">
          <div className="text-3xl font-bold text-blue-400 mb-1">OrchestratePay</div>
          <div className="text-sm text-gray-400">Admin Portal</div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Admin secret</label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'} required
                value={secret} onChange={e => setSecret(e.target.value)}
                placeholder="Enter ADMIN_SECRET from .env"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 pr-10 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowSecret(v => !v)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-200"
                aria-label={showSecret ? 'Hide secret' : 'Show secret'}
              >
                {showSecret ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" />
                    <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                    <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-400 bg-red-900/30 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-50 transition-colors"
          >
            {loading ? 'Verifying…' : 'Sign in to admin'}
          </button>
        </form>
      </div>
    </div>
  )
}
