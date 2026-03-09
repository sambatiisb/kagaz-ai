import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 30

// Escape special XML characters so the text is safe inside SSML
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function POST(request: NextRequest) {
  const key    = process.env.AZURE_SPEECH_KEY
  const region = process.env.AZURE_SPEECH_REGION

  if (!key || !region) {
    return NextResponse.json(
      { error: 'Azure Speech not configured. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.' },
      { status: 503 }
    )
  }

  let text: string
  let voice: string

  try {
    const body = await request.json()
    text  = (body.text  as string)?.trim()
    voice = (body.voice as string) || 'hi-IN-SwaraNeural'
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!text) {
    return NextResponse.json({ error: 'text is required.' }, { status: 400 })
  }

  // Derive xml:lang from the voice name (e.g. "hi-IN-SwaraNeural" → "hi-IN")
  const lang = voice.split('-').slice(0, 2).join('-')

  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">
  <voice name="${voice}">
    <prosody rate="0.9" pitch="0%">${escapeXml(text)}</prosody>
  </voice>
</speak>`

  const ttsRes = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        'User-Agent': 'KagazAI/1.0',
      },
      body: ssml,
    }
  )

  if (!ttsRes.ok) {
    const msg = await ttsRes.text()
    console.error('[kagaz-ai] Azure Speech error:', ttsRes.status, msg)
    return NextResponse.json(
      { error: `Azure Speech API error: ${ttsRes.status}` },
      { status: 502 }
    )
  }

  const audioBuffer = await ttsRes.arrayBuffer()

  return new NextResponse(audioBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  })
}
