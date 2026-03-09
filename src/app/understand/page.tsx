'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { VoicePlayer } from '@/components/VoicePlayer'

interface AnalysisResult {
  document_type: string
  what_it_is: string
  what_it_means: string
  what_to_do: string
  what_it_is_hi: string
  what_it_means_hi: string
  what_to_do_hi: string
}

type AppState = 'idle' | 'selected' | 'loading' | 'result' | 'error'

const MAX_FILE_SIZE = 20 * 1024 * 1024

function DocIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="56" height="56" rx="14" fill="#D1FAE5" />
      <rect x="14" y="10" width="28" height="36" rx="3" fill="white" stroke="#1B6B3A" strokeWidth="1.5" />
      <rect x="19" y="19" width="18" height="2.5" rx="1.25" fill="#1B6B3A" />
      <rect x="19" y="24.5" width="18" height="2.5" rx="1.25" fill="#1B6B3A" />
      <rect x="19" y="30" width="12" height="2.5" rx="1.25" fill="#A7F3D0" />
      <circle cx="38" cy="40" r="7" stroke="#F97316" strokeWidth="2.5" fill="none" />
      <line x1="43.2" y1="45.2" x2="47" y2="49" stroke="#F97316" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="40" height="40" viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="20" r="16" stroke="#D1FAE5" strokeWidth="4" />
      <path d="M20 4 A16 16 0 0 1 36 20" stroke="#1B6B3A" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon({ className = '' }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="10" fill="currentColor" opacity="0.15" />
      <path d="M6 10l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function UnderstandPage() {
  const router = useRouter()
  const [appState, setAppState] = useState<AppState>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lang, setLang] = useState<'en' | 'hi'>('en')
  const [isDragging, setIsDragging] = useState(false)
  const [canShare, setCanShare] = useState(false)

  const fileInputRef   = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && !!navigator.share)
  }, [])

  const handleFile = useCallback((selectedFile: File) => {
    if (selectedFile.size > MAX_FILE_SIZE) {
      setError('File is too large. Please upload something smaller than 20MB.')
      setAppState('error')
      return
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
    if (!allowed.includes(selectedFile.type)) {
      setError('Please upload a photo (JPEG, PNG, WebP) or a PDF file.')
      setAppState('error')
      return
    }
    setFile(selectedFile)
    setResult(null)
    setError(null)
    setAppState('selected')
    if (selectedFile.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (e) => setPreview(e.target?.result as string)
      reader.readAsDataURL(selectedFile)
    } else {
      setPreview(null)
    }
  }, [])

  const handleAnalyze = async () => {
    if (!file) return
    setAppState('loading')
    const formData = new FormData()
    formData.append('file', file)
    try {
      const response = await fetch('/api/analyze', { method: 'POST', body: formData })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Analysis failed')
      setResult(data)
      setLang('en')
      setAppState('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setAppState('error')
    }
  }

  const handleReset = () => {
    setFile(null); setPreview(null); setResult(null); setError(null); setLang('en')
    setAppState('idle')
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (cameraInputRef.current) cameraInputRef.current.value = ''
  }

  const handleShare = async () => {
    if (!result || !navigator.share) return
    try {
      await navigator.share({
        title: `${result.document_type} — Kagaz AI`,
        text: `📋 ${result.document_type}\n\n1️⃣ ${result.what_it_is}\n\n2️⃣ ${result.what_it_means}\n\n3️⃣ ${result.what_to_do}\n\n— Explained by Kagaz AI`,
      })
    } catch { /* cancelled */ }
  }

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }
  const handleDragLeave = () => setIsDragging(false)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) handleFile(dropped)
  }

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      {/* Header */}
      <header className="bg-primary shadow-md sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="text-green-300 hover:text-white transition-colors mr-1 text-lg font-bold">←</Link>
          <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-base leading-none">K</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-white font-bold text-lg leading-tight">Kagaz AI</h1>
            <p className="text-green-200 text-xs leading-tight">आपके कागज़ का मतलब</p>
          </div>
          {appState === 'result' && (
            <div className="ml-auto">
              <span className="bg-green-600 text-white text-xs px-2 py-1 rounded-full font-medium">✓ Done</span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-6 space-y-5">

        {/* Hero text */}
        {appState === 'idle' && (
          <div className="text-center animate-fade-in">
            <div className="flex justify-center mb-4"><DocIcon /></div>
            <h2 className="text-xl font-bold text-primary leading-snug">Understand Any Government Document</h2>
            <p className="text-gray-500 mt-2 text-sm leading-relaxed">
              Upload a photo or PDF — get a simple explanation in seconds.
              <br /><span className="text-primary font-medium">Free for all Indian citizens.</span>
            </p>
          </div>
        )}

        {/* Upload Card */}
        {(appState === 'idle' || appState === 'selected') && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 animate-slide-up">
            {appState === 'idle' ? (
              <>
                <div
                  onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 mb-4 ${
                    isDragging ? 'border-primary bg-primary-light scale-[1.02]' : 'border-gray-300 bg-gray-50 hover:border-primary hover:bg-green-50'
                  }`}
                >
                  <div className="text-4xl mb-2">{isDragging ? '⬇️' : '📄'}</div>
                  <p className="font-semibold text-gray-700">{isDragging ? 'Drop it here!' : 'Drag & drop your document'}</p>
                  <p className="text-gray-400 text-sm mt-1">or use the buttons below</p>
                  <p className="text-gray-300 text-xs mt-2">Aadhaar • Land Record • Ration Card • Any govt form</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => cameraInputRef.current?.click()} className="flex items-center justify-center gap-2 bg-primary text-white rounded-xl py-3.5 px-4 font-semibold text-sm hover:bg-primary-dark transition-colors active:scale-95">
                    <span className="text-base">📷</span> Take Photo
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} className="flex items-center justify-center gap-2 bg-gray-100 text-gray-700 rounded-xl py-3.5 px-4 font-semibold text-sm hover:bg-gray-200 transition-colors active:scale-95">
                    <span className="text-base">📁</span> Upload File
                  </button>
                </div>
                <p className="text-center text-gray-400 text-xs mt-3">Supports JPEG · PNG · WebP · PDF (up to 20MB)</p>
              </>
            ) : (
              <>
                {preview ? (
                  <div className="mb-4 rounded-xl overflow-hidden border border-gray-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={preview} alt="Document preview" className="w-full max-h-52 object-cover" />
                  </div>
                ) : (
                  <div className="mb-4 bg-orange-50 rounded-xl p-4 flex items-center gap-3 border border-orange-100">
                    <span className="text-3xl">📄</span>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 truncate">{file?.name}</p>
                      <p className="text-gray-400 text-sm">{file ? (file.size / 1024 / 1024).toFixed(1) : 0} MB · PDF</p>
                    </div>
                  </div>
                )}
                <p className="text-center text-gray-500 text-sm mb-4">Ready to analyze. Tap the button below.</p>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={handleReset} className="py-3.5 px-4 rounded-xl border border-gray-300 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-colors">← Change</button>
                  <button onClick={handleAnalyze} className="py-3.5 px-4 rounded-xl bg-accent text-white font-semibold text-sm hover:bg-orange-600 transition-colors active:scale-95 shadow-sm">Analyze →</button>
                </div>
              </>
            )}
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </div>
        )}

        {/* Loading */}
        {appState === 'loading' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 text-center animate-fade-in">
            <div className="flex justify-center mb-4"><SpinnerIcon /></div>
            <p className="text-primary font-bold text-lg">पढ़ रहा है…</p>
            <p className="text-gray-400 text-sm mt-1">Reading your document, please wait</p>
            <div className="flex justify-center gap-1 mt-4">
              {[0,1,2].map((i) => <span key={i} className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
            </div>
          </div>
        )}

        {/* Error */}
        {appState === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5 animate-fade-in">
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0">⚠️</span>
              <div>
                <p className="text-red-800 font-semibold">Something went wrong</p>
                <p className="text-red-600 text-sm mt-1">{error}</p>
              </div>
            </div>
            <button onClick={handleReset} className="mt-4 w-full py-2.5 rounded-xl border border-red-300 text-red-700 font-medium text-sm hover:bg-red-100 transition-colors">Try Again</button>
          </div>
        )}

        {/* Result */}
        {appState === 'result' && result && (
          <div className="space-y-4 animate-slide-up">
            {/* Badge */}
            <div className="flex items-center justify-center gap-2">
              <span className="bg-primary-light text-primary font-bold px-4 py-2 rounded-full text-sm border border-green-200">
                📋 {result.document_type}
              </span>
            </div>

            {/* Voice Player */}
            {result.what_it_is_hi && result.what_it_means_hi && result.what_to_do_hi && (
              <VoicePlayer sections={[
                { label: 'यह कागज़ क्या है?',     text: result.what_it_is_hi },
                { label: 'आपके लिए क्या मतलब?', text: result.what_it_means_hi },
                { label: 'आगे क्या करना है?',    text: result.what_to_do_hi },
              ]} />
            )}

            {/* Language toggle */}
            <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-1">
              <button onClick={() => setLang('en')} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${lang === 'en' ? 'bg-white text-primary shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>English</button>
              <button onClick={() => setLang('hi')} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${lang === 'hi' ? 'bg-white text-primary shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>हिंदी</button>
            </div>

            {/* Card 1 */}
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="bg-blue-600 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">1</span>
                <div><p className="font-bold text-blue-900 text-sm leading-tight">यह कागज़ क्या है?</p><p className="text-blue-400 text-xs">What is this document?</p></div>
                <CheckIcon className="ml-auto text-blue-500" />
              </div>
              <p className="text-blue-800 leading-relaxed text-sm">{lang === 'hi' && result.what_it_is_hi ? result.what_it_is_hi : result.what_it_is}</p>
            </div>

            {/* Card 2 */}
            <div className="bg-green-50 border border-green-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="bg-primary text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">2</span>
                <div><p className="font-bold text-green-900 text-sm leading-tight">आपके लिए क्या मतलब?</p><p className="text-green-400 text-xs">What does it mean for you?</p></div>
                <CheckIcon className="ml-auto text-primary" />
              </div>
              <p className="text-green-800 leading-relaxed text-sm">{lang === 'hi' && result.what_it_means_hi ? result.what_it_means_hi : result.what_it_means}</p>
            </div>

            {/* Card 3 */}
            <div className="bg-accent-light border border-orange-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="bg-accent text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0">3</span>
                <div><p className="font-bold text-orange-900 text-sm leading-tight">आगे क्या करना है?</p><p className="text-orange-400 text-xs">What should you do next?</p></div>
                <span className="ml-auto text-accent text-lg">→</span>
              </div>
              <p className="text-orange-800 leading-relaxed text-sm font-medium">{lang === 'hi' && result.what_to_do_hi ? result.what_to_do_hi : result.what_to_do}</p>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              {canShare && (
                <button onClick={handleShare} className="flex items-center justify-center gap-2 py-3.5 rounded-xl border border-gray-300 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-colors">
                  <span>↗️</span> Share
                </button>
              )}
              <button
                onClick={() => router.push('/')}
                className={`flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary-dark transition-colors ${canShare ? '' : 'col-span-2'}`}
              >
                🏠 Return to Home
              </button>
            </div>

            <p className="text-center text-gray-400 text-xs pb-2">
              This is an AI explanation — not legal advice. For important decisions, consult a government official.
            </p>
          </div>
        )}
      </main>

      <footer className="text-center py-6 pb-safe border-t border-gray-100">
        <p className="text-gray-400 text-xs">Kagaz AI · Free for all Indian citizens · Powered by Azure AI</p>
      </footer>
    </div>
  )
}
