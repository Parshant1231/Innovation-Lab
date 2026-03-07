'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { register } from '@/lib/auth'

export default function RegisterPage() {
  const router = useRouter()
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
    setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.password !== form.confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    const result = await register(form.username, form.email, form.password)
    setLoading(false)
    if (result.success) {
      router.push('/dashboard')
    } else {
      setError(result.error || 'Registration failed')
    }
  }

  return (
    <main className="relative min-h-screen flex items-center justify-center px-6 z-10">
      <div className="w-full max-w-md">

        {/* Header */}
        <div className="mb-8">
          <div className="font-mono text-[10px] text-[#22d3ee] tracking-[4px] uppercase mb-3">
            Create Account
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100">
            Join QuantumSafe
          </h1>
          <p className="font-mono text-xs text-slate-500 mt-2">
            Your keys are generated on this device — never sent to the server.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="qsm-label">Username</label>
            <input
              name="username" type="text"
              value={form.username} onChange={handleChange}
              placeholder="satoshi" required minLength={3} maxLength={32}
              autoComplete="username"
              className="qsm-input"
            />
          </div>
          <div>
            <label className="qsm-label">Email</label>
            <input
              name="email" type="email"
              value={form.email} onChange={handleChange}
              placeholder="you@domain.com" required
              autoComplete="email"
              className="qsm-input"
            />
          </div>
          <div>
            <label className="qsm-label">Password</label>
            <input
              name="password" type="password"
              value={form.password} onChange={handleChange}
              placeholder="min 8 characters" required minLength={8}
              autoComplete="new-password"
              className="qsm-input"
            />
          </div>
          <div>
            <label className="qsm-label">Confirm Password</label>
            <input
              name="confirm" type="password"
              value={form.confirm} onChange={handleChange}
              placeholder="repeat password" required
              autoComplete="new-password"
              className="qsm-input"
            />
          </div>

          {error && <p className="qsm-error">{error}</p>}

          <button type="submit" disabled={loading} className="qsm-btn w-full mt-2">
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        {/* Footer note */}
        <div className="mt-6 p-4 border border-[#1a2744] bg-[#0b1120]">
          <p className="font-mono text-[10px] text-slate-600 leading-relaxed">
            ⚠ In Phase 2, Kyber + Dilithium key pairs will be generated here on your device
            during registration. Your private keys will never leave this browser.
          </p>
        </div>

        <p className="mt-6 text-center font-mono text-xs text-slate-600">
          Already have an account?{' '}
          <Link href="/login" className="text-[#22d3ee] hover:underline">Sign in</Link>
        </p>
      </div>
    </main>
  )
}
