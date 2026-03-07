import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'QuantumSafe Messenger',
  description: 'Post-quantum encrypted messaging — Kyber-1024 · AES-256-GCM · Double Ratchet · Dilithium',
  icons: { icon: '/favicon.ico' },
  manifest: '/manifest.json',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  )
}
