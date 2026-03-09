'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getProfile, hasRequiredDocs } from '@/lib/profile'

export default function HomePage() {
  const router = useRouter()
  const [onboarded, setOnboarded] = useState(false)

  useEffect(() => {
    setOnboarded(hasRequiredDocs(getProfile()))
  }, [])

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      {/* Header */}
      <header className="bg-primary shadow-md">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-lg leading-none">K</span>
          </div>
          <div>
            <h1 className="text-white font-bold text-xl leading-tight">Kagaz AI</h1>
            <p className="text-green-200 text-xs">आपका डिजिटल साथी</p>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-8 flex flex-col gap-6">
        {/* Hero */}
        <div className="text-center">
          <div className="text-5xl mb-3">📋</div>
          <h2 className="text-xl font-bold text-primary leading-snug">
            सरकारी काम आसान बनाएं
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            Understand any document or fill any form — powered by AI.
          </p>
        </div>

        {/* Card 1 — Understand */}
        <button
          onClick={() => router.push('/understand')}
          className="bg-white border-2 border-primary rounded-2xl p-6 text-left shadow-sm hover:shadow-md hover:bg-green-50 transition-all active:scale-98 w-full"
        >
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary-light flex items-center justify-center text-2xl flex-shrink-0">
              📖
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-primary text-lg leading-tight">समझना है</p>
              <p className="text-gray-500 text-sm font-medium">Understand Any Document</p>
              <p className="text-gray-400 text-xs mt-2 leading-relaxed">
                Upload a photo or PDF — get a plain-language explanation in Hindi &amp; English.
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end">
            <span className="bg-primary text-white text-xs font-bold px-3 py-1.5 rounded-full">
              शुरू करें →
            </span>
          </div>
        </button>

        {/* Card 2 — Fill */}
        <button
          onClick={() => router.push('/onboard?t=' + Date.now())}
          className="bg-white border-2 border-accent rounded-2xl p-6 text-left shadow-sm hover:shadow-md hover:bg-orange-50 transition-all active:scale-98 w-full"
        >
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-accent-light flex items-center justify-center text-2xl flex-shrink-0">
              ✍️
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-accent text-lg leading-tight">भरना है</p>
              <p className="text-gray-500 text-sm font-medium">Fill Any Form</p>
              <p className="text-gray-400 text-xs mt-2 leading-relaxed">
                Upload a blank form — auto-fill with your Aadhaar &amp; ID details instantly.
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            {onboarded ? (
              <span className="text-green-600 text-xs font-medium">✓ Documents ready</span>
            ) : (
              <span className="text-orange-400 text-xs">Setup required</span>
            )}
            <span className="bg-accent text-white text-xs font-bold px-3 py-1.5 rounded-full">
              शुरू करें →
            </span>
          </div>
        </button>

        {/* Info strip */}
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-3 text-xs text-gray-400">
          <span className="text-lg">🔒</span>
          <span>Your documents are stored only on your device. Nothing is uploaded to any server without your action.</span>
        </div>
      </main>

      <footer className="text-center py-4 pb-safe border-t border-gray-100">
        <p className="text-gray-400 text-xs">Kagaz AI · Free for all Indian citizens · Powered by Azure AI</p>
      </footer>
    </div>
  )
}
