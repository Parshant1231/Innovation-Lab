'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { login } from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [form, setForm] = useState({ usernameOrEmail: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
    setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const result = await login(form.usernameOrEmail, form.password)
    setLoading(false)
    if (result.success) {
      router.push('/dashboard')
    } else {
      setError(result.error || 'Login failed')
    }
  }

  return (
    <main className="relative min-h-screen flex items-center justify-center px-6 z-10">
      <div className="w-full max-w-md">

        {/* Header */}
        <div className="mb-8">
          <div className="font-mono text-[10px] text-[#22d3ee] tracking-[4px] uppercase mb-3">
            Sign In
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100">
            Welcome back
          </h1>
          <p className="font-mono text-xs text-slate-500 mt-2">
            Your session is stored in memory — never on disk.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="qsm-label">Username or Email</label>
            <input
              name="usernameOrEmail" type="text"
              value={form.usernameOrEmail} onChange={handleChange}
              placeholder="satoshi or you@domain.com" required
              autoComplete="username"
              className="qsm-input"
            />
          </div>
          <div>
            <label className="qsm-label">Password</label>
            <input
              name="password" type="password"
              value={form.password} onChange={handleChange}
              placeholder="your password" required
              autoComplete="current-password"
              className="qsm-input"
            />
          </div>

          {error && <p className="qsm-error">{error}</p>}

          <button type="submit" disabled={loading} className="qsm-btn w-full mt-2">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-center font-mono text-xs text-slate-600">
          New here?{' '}
          <Link href="/register" className="text-[#22d3ee] hover:underline">Create account</Link>
        </p>
      </div>
    </main>
  )
}
