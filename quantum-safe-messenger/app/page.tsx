'use client'
import Link from 'next/link'

export default function LandingPage() {
  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center px-6 z-10">

      {/* Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px]
                      bg-[radial-gradient(ellipse,rgba(34,211,238,0.07)_0%,transparent_70%)] pointer-events-none" />

      {/* Badge */}
      <div className="flex items-center gap-3 mb-8">
        <div className="h-px w-12 bg-gradient-to-r from-transparent to-[#22d3ee]" />
        <span className="font-mono text-[10px] text-[#22d3ee] tracking-[4px] uppercase">
          Post-Quantum Encrypted
        </span>
        <div className="h-px w-12 bg-gradient-to-l from-transparent to-[#22d3ee]" />
      </div>

      {/* Title */}
      <h1 className="text-6xl md:text-8xl font-extrabold text-center tracking-[-3px] leading-[1.02] mb-6"
          style={{ background: 'linear-gradient(135deg,#fff 0%,#22d3ee 45%,#3b82f6 100%)',
                   WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
        QuantumSafe<br />Messenger
      </h1>

      {/* Sub */}
      <p className="font-mono text-slate-500 text-sm text-center max-w-xl mb-10 leading-relaxed">
        Military-grade messaging for the quantum era.<br />
        Kyber-1024 · AES-256-GCM · Double Ratchet · Dilithium3 · Polygon Blockchain
      </p>

      {/* Crypto badges */}
      <div className="flex flex-wrap gap-2 justify-center mb-10">
        {['Kyber-1024', 'AES-256-GCM', 'Double Ratchet', 'Dilithium3', 'Zero-Knowledge Server', 'Blockchain Audit'].map(tag => (
          <span key={tag}
                className="font-mono text-[10px] border border-[#1a2744] text-slate-500 px-3 py-1">
            {tag}
          </span>
        ))}
      </div>

      {/* CTAs */}
      <div className="flex gap-4">
        <Link href="/register" className="qsm-btn">
          Get Started
        </Link>
        <Link href="/login" className="qsm-btn-ghost">
          Sign In
        </Link>
      </div>

      {/* Phase indicator */}
      <div className="absolute bottom-8 font-mono text-[10px] text-slate-700 tracking-widest">
        PHASE 1 — FOUNDATION · v0.1.0
      </div>
    </main>
  )
}
