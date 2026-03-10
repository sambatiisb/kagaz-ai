'use client'

import { useState, useRef, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  getProfile,
  saveProfile,
  DOC_META,
  DocType,
  UserProfile,
} from '@/lib/profile'

// ── Doc order matching the screenshot ────────────────────────────────────────
const DOC_ORDER: DocType[] = ['aadhaar', 'pan', 'rationCard', 'bank', 'passport']

// ── Per-step upload state ─────────────────────────────────────────────────────
type DocUploadState = 'idle' | 'loading' | 'done' | 'error'

interface DocState {
  status: DocUploadState
  extractedName?: string   // name/key field from extracted data, for preview
  error?: string
}

// ── Voice helper ──────────────────────────────────────────────────────────────
async function speakHindi(text: string) {
  try {
    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang: 'hi-IN' }),
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.play()
    audio.onended = () => URL.revokeObjectURL(url)
  } catch { /* best-effort */ }
}

// ── Friendly extracted-data preview ──────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDocPreviewName(docType: DocType, data: any): string {
  switch (docType) {
    case 'aadhaar':    return data?.name ?? ''
    case 'pan':        return data?.name ?? ''
    case 'bank':       return data?.accountHolderName ?? ''
    case 'rationCard': return data?.headOfFamily ?? ''
    case 'passport':   return data?.name ?? ''
    default:           return ''
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
function OnboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const resetKey = searchParams.get('t')

  const [profile, setProfile] = useState<UserProfile>({})
  const [docStates, setDocStates] = useState<Record<DocType, DocState>>({
    aadhaar:    { status: 'idle' },
    pan:        { status: 'idle' },
    rationCard: { status: 'idle' },
    bank:       { status: 'idle' },
    passport:   { status: 'idle' },
  })
  const [voiceOn, setVoiceOn] = useState(false)

  // One file-input ref per doc
  const fileRefs = useRef<Record<DocType, HTMLInputElement | null>>({
    aadhaar: null, pan: null, rationCard: null, bank: null, passport: null,
  })

  // Always open the page with blank slots — never pre-mark any doc as done.
  // resetKey (from ?t=timestamp) changes on every navigation here, so this
  // effect reliably fires even when Next.js reuses the cached component.
  useEffect(() => {
    setDocStates({
      aadhaar:    { status: 'idle' },
      pan:        { status: 'idle' },
      rationCard: { status: 'idle' },
      bank:       { status: 'idle' },
      passport:   { status: 'idle' },
    })
    const saved = getProfile()
    if (saved) setProfile(saved)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  const setDocState = useCallback((doc: DocType, patch: Partial<DocState>) => {
    setDocStates((prev) => ({ ...prev, [doc]: { ...prev[doc], ...patch } }))
  }, [])

  async function handleFile(doc: DocType, file: File) {
    setDocState(doc, { status: 'loading', error: undefined })

    if (voiceOn) speakHindi(doc === 'aadhaar' ? 'आधार कार्ड पढ़ा जा रहा है…' : 'दस्तावेज़ पढ़ा जा रहा है…')

    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('docType', doc)

      const res = await fetch('/api/extract-profile', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Extraction failed.')

      // Save into profile
      const updated: UserProfile = { ...profile }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(updated as any)[doc] = json.data
      setProfile(updated)
      saveProfile(updated)

      const previewName = getDocPreviewName(doc, json.data)
      setDocState(doc, { status: 'done', extractedName: previewName })

      if (voiceOn) speakHindi('सफलतापूर्वक सहेज लिया गया।')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not read document.'
      setDocState(doc, { status: 'error', error: msg })
      if (voiceOn) speakHindi('माफ करें, दस्तावेज़ पढ़ने में समस्या हुई।')
    }
  }

  function handleFileChange(doc: DocType, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input so same file can be re-selected
    e.target.value = ''
    handleFile(doc, file)
  }

  function triggerUpload(doc: DocType) {
    fileRefs.current[doc]?.click()
  }

  function triggerCamera(doc: DocType) {
    // Create a temporary camera-capture input
    const tmp = document.createElement('input')
    tmp.type = 'file'
    tmp.accept = 'image/jpeg,image/png,image/webp'
    tmp.capture = 'environment'
    tmp.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) handleFile(doc, file)
    }
    tmp.click()
  }

  const aadhaarDone = docStates.aadhaar.status === 'done'

  function handleContinue() {
    if (!aadhaarDone) return
    if (voiceOn) speakHindi('बहुत अच्छा! अब फॉर्म भरें।')
    router.push('/fill')
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#FAF7F2] flex flex-col">
      {/* Header */}
      <div className="px-5 pt-6 pb-2 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">Upload ID Proofs</h1>
          <p className="text-gray-400 text-sm mt-0.5">पहचान पत्र अपलोड करें</p>
        </div>
        {/* Voice toggle */}
        <button
          onClick={() => setVoiceOn((v) => !v)}
          className={`w-10 h-10 rounded-full flex items-center justify-center shadow transition-all ${
            voiceOn ? 'bg-orange-100 text-orange-500' : 'bg-white text-gray-400 border border-gray-200'
          }`}
          aria-label={voiceOn ? 'Turn off voice' : 'Turn on voice'}
        >
          {voiceOn ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          )}
        </button>
      </div>

      {/* Voice guide banner */}
      <div className="mx-5 mt-3 bg-orange-50 border border-orange-100 rounded-xl px-4 py-2.5 flex items-center gap-2.5">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2.5" className="flex-shrink-0">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          {voiceOn ? (
            <>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </>
          ) : (
            <>
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </>
          )}
        </svg>
        <span className="text-orange-700 text-sm font-medium">
          Voice Guide: {voiceOn ? 'Voice guide is on 🔊' : 'Voice guide is off'}
        </span>
        {!voiceOn && (
          <button
            onClick={() => setVoiceOn(true)}
            className="ml-auto text-orange-500 text-xs underline font-medium"
          >
            Turn on
          </button>
        )}
      </div>

      {/* Doc cards */}
      <div className="flex-1 px-5 py-4 flex flex-col gap-3">
        {DOC_ORDER.map((doc) => {
          const meta = DOC_META[doc]
          const state = docStates[doc]
          const done = state.status === 'done'
          const loading = state.status === 'loading'
          const hasError = state.status === 'error'
          const isMandatory = meta.mandatory

          return (
            <div
              key={doc}
              className={`bg-white rounded-2xl border-2 transition-all ${
                isMandatory && !done
                  ? 'border-orange-300'
                  : done
                  ? 'border-green-200'
                  : 'border-gray-100'
              }`}
            >
              {/* Hidden file input */}
              <input
                ref={(el) => { fileRefs.current[doc] = el }}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                className="hidden"
                onChange={(e) => handleFileChange(doc, e)}
              />

              <div className="px-4 py-3.5 flex items-center gap-3.5">
                {/* Shield icon */}
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                    done
                      ? 'bg-green-100'
                      : isMandatory
                      ? 'bg-orange-50'
                      : 'bg-gray-100'
                  }`}
                >
                  {loading ? (
                    <svg className="animate-spin h-5 w-5 text-orange-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : (
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={done ? '#16a34a' : isMandatory ? '#F97316' : '#9ca3af'}
                      strokeWidth="2"
                    >
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      {done && (
                        <polyline points="9 12 11 14 15 10" strokeWidth="2.5" />
                      )}
                    </svg>
                  )}
                </div>

                {/* Label */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className={`font-semibold text-base leading-tight ${done ? 'text-gray-700' : 'text-gray-900'}`}>
                      {meta.label}
                      {isMandatory && <span className="text-red-500 ml-1">*</span>}
                    </p>
                  </div>
                  <p className="text-gray-400 text-sm">{meta.labelHi}</p>
                  {done && state.extractedName && (
                    <p className="text-green-600 text-xs mt-0.5 font-medium">✓ {state.extractedName}</p>
                  )}
                  {hasError && (
                    <p className="text-red-500 text-xs mt-0.5">{state.error}</p>
                  )}
                </div>

                {/* Upload + Camera buttons */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Upload file */}
                  <button
                    onClick={() => triggerUpload(doc)}
                    disabled={loading}
                    className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all disabled:opacity-50 ${
                      isMandatory
                        ? 'border-orange-200 bg-orange-50 text-orange-500 hover:bg-orange-100'
                        : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100'
                    }`}
                    aria-label={`Upload ${meta.label}`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  </button>

                  {/* Camera */}
                  <button
                    onClick={() => triggerCamera(doc)}
                    disabled={loading}
                    className="w-10 h-10 rounded-full border border-green-200 bg-green-50 text-primary flex items-center justify-center hover:bg-green-100 transition-all disabled:opacity-50"
                    aria-label={`Take photo of ${meta.label}`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )
        })}

        {/* Aadhaar required notice */}
        {!aadhaarDone && (
          <p className="text-center text-gray-400 text-xs mt-1">
            * Aadhaar Card is required to fill forms · आधार कार्ड जरूरी है
          </p>
        )}
      </div>

      {/* Bottom actions */}
      <div className="px-5 pb-8 pt-2 flex flex-col items-center gap-3">
        <button
          onClick={handleContinue}
          disabled={!aadhaarDone}
          className={`w-full py-4 rounded-2xl font-bold text-base transition-all ${
            aadhaarDone
              ? 'bg-gray-900 text-white shadow-lg active:scale-98'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          Continue / आगे बढ़ें →
        </button>

        <button
          onClick={() => router.push('/')}
          className="text-orange-500 text-sm font-medium"
        >
          ← Back to Home
        </button>
      </div>
    </div>
  )
}

// useSearchParams() requires a Suspense boundary in Next.js 15
export default function OnboardPage() {
  return (
    <Suspense>
      <OnboardContent />
    </Suspense>
  )
}
