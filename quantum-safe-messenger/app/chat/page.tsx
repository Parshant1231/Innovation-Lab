'use client'
import Link from 'next/link'

export default function ChatPage() {
  return (
    <main className="relative min-h-screen flex items-center justify-center z-10">
      <div className="text-center">
        <div className="font-mono text-[10px] text-slate-600 tracking-[4px] uppercase mb-4">
          Phase 3 — Not Yet Built
        </div>
        <h1 className="text-2xl font-bold text-slate-300 mb-3">Chat Coming in Phase 3</h1>
        <p className="font-mono text-xs text-slate-600 max-w-sm mx-auto mb-6 leading-relaxed">
          WebSocket real-time messaging with hybrid queue routing is implemented in Phase 3 (Weeks 5–6).
        </p>
        <Link href="/dashboard" className="qsm-btn-ghost">← Back to Dashboard</Link>
      </div>
    </main>
  )
}
