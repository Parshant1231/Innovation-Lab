'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser, fetchMe, logout, type User } from '@/lib/auth'

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')

  useEffect(() => {
    async function init() {
      // Check in-memory user first
      let u = getCurrentUser()
      if (!u) {
        // Try to fetch from server (token might still be valid from this session)
        u = await fetchMe()
      }
      if (!u) {
        router.replace('/login')
        return
      }
      setUser(u)
      setLoading(false)
    }
    init()
  }, [router])

  async function handleLogout() {
    await logout()
    router.push('/')
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center z-10 relative">
        <div className="font-mono text-sm text-slate-500 tracking-widest animate-pulse">
          INITIALIZING...
        </div>
      </main>
    )
  }

  return (
    <main className="relative min-h-screen z-10">

      {/* Top bar */}
      <nav className="border-b border-[#1a2744] bg-[rgba(5,8,16,0.9)] backdrop-blur sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="font-mono text-sm font-bold text-[#22d3ee] tracking-widest">
            ⚛ QSM
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'connected' ? 'bg-green-400' : wsStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="font-mono text-[10px] text-slate-500 tracking-widest uppercase">{wsStatus}</span>
            </div>
            <span className="font-mono text-xs text-slate-400">{user?.username}</span>
            <button onClick={handleLogout} className="font-mono text-[10px] text-slate-600 hover:text-[#22d3ee] tracking-widest uppercase transition-colors">
              Logout
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-10">

        {/* Welcome */}
        <div className="mb-10">
          <div className="font-mono text-[10px] text-[#22d3ee] tracking-[4px] uppercase mb-2">Dashboard</div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100">
            Welcome, <span className="text-[#22d3ee]">{user?.username}</span>
          </h1>
          <p className="font-mono text-xs text-slate-500 mt-1">Phase 1 complete — Auth layer active</p>
        </div>

        {/* Status cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          {[
            { label: 'Auth Layer', value: 'ACTIVE', color: 'text-green-400' },
            { label: 'Crypto Layer', value: 'PHASE 2', color: 'text-yellow-400' },
            { label: 'Messaging', value: 'PHASE 3', color: 'text-slate-600' },
            { label: 'Blockchain', value: 'PHASE 4', color: 'text-slate-600' },
          ].map(s => (
            <div key={s.label} className="qsm-card p-4">
              <div className="font-mono text-[9px] text-slate-600 tracking-widest uppercase mb-1">{s.label}</div>
              <div className={`font-mono text-sm font-bold tracking-widest ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Account info */}
        <div className="qsm-card p-6 mb-6">
          <div className="font-mono text-[10px] text-[#22d3ee] tracking-[3px] uppercase mb-4 pb-3 border-b border-[#1a2744]">
            Account Details
          </div>
          <div className="space-y-3">
            {[
              { label: 'User ID', value: user?.id },
              { label: 'Username', value: user?.username },
              { label: 'Email', value: user?.email },
              { label: 'Status', value: user?.status || 'offline' },
            ].map(row => (
              <div key={row.label} className="flex items-center gap-4">
                <span className="font-mono text-[10px] text-slate-600 uppercase tracking-widest w-24 flex-shrink-0">{row.label}</span>
                <span className="font-mono text-xs text-slate-300 break-all">{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Phase 2 callout */}
        <div className="border border-[#22d3ee]/20 border-l-2 border-l-[#22d3ee] bg-[rgba(34,211,238,0.04)] p-4">
          <div className="font-mono text-[10px] text-[#22d3ee] tracking-widest uppercase mb-1">Next: Phase 2</div>
          <p className="font-mono text-xs text-slate-500 leading-relaxed">
            Kyber-1024 + Dilithium3 key generation happens during registration. Private keys stay on your device.
            After Phase 2, all messages are encrypted before they leave this browser.
          </p>
        </div>

        {/* Chat link — disabled in Phase 1 */}
        <div className="mt-6 flex gap-3">
          <Link href="/chat" className="qsm-btn">
            Open Chat (Phase 3)
          </Link>
        </div>
      </div>
    </main>
  )
}
