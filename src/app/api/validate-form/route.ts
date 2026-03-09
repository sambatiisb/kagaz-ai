import { NextRequest, NextResponse } from 'next/server'
import { AzureOpenAI } from 'openai'

export const runtime = 'nodejs'
export const maxDuration = 30

function getOpenAIClient() {
  const endpoint   = process.env.AZURE_OPENAI_ENDPOINT
  const apiKey     = process.env.AZURE_OPENAI_API_KEY
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2024-02-01'
  if (!endpoint || !apiKey || !deployment) throw new Error('Azure OpenAI not configured.')
  return { client: new AzureOpenAI({ endpoint, apiKey, deployment, apiVersion }), deployment }
}

interface FilledField {
  label: string
  value: string
  source: string
}

interface ValidationError {
  field: string
  message: string
  severity: 'error' | 'warning'
}

// ── Rule-based validation ─────────────────────────────────────────────────────

function runRules(fields: FilledField[], profile: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = []

  for (const f of fields) {
    const label = f.label.toLowerCase()
    const value = (f.value ?? '').trim()
    if (!value) continue

    // ── Aadhaar: exactly 12 digits ──
    if (label.includes('aadhaar') || label.includes('uid') || label.includes('आधार')) {
      const digits = value.replace(/\s/g, '')
      if (!/^\d+$/.test(digits)) {
        errors.push({ field: f.label, message: 'Aadhaar number must contain only digits.', severity: 'error' })
      } else if (digits.length !== 12) {
        errors.push({ field: f.label, message: `Aadhaar must be 12 digits. Found ${digits.length}.`, severity: 'error' })
      }
    }

    // ── PAN: ABCDE1234F ──
    if (label.includes('pan') && !label.includes('pancard')) {
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(value)) {
        errors.push({ field: f.label, message: 'PAN must be in format ABCDE1234F (5 letters, 4 digits, 1 letter).', severity: 'error' })
      }
    }

    // ── IFSC: 11 chars, 4 letters + 0 + 6 alphanumeric ──
    if (label.includes('ifsc')) {
      if (value.length !== 11) {
        errors.push({ field: f.label, message: `IFSC must be 11 characters. Found ${value.length}.`, severity: 'error' })
      } else if (!/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(value)) {
        errors.push({ field: f.label, message: 'IFSC format: 4 letters + 0 + 6 alphanumeric.', severity: 'warning' })
      }
    }

    // ── Pincode: 6 digits ──
    if (label.includes('pincode') || label.includes('pin code') || label.includes('postal code')) {
      if (!/^\d{6}$/.test(value)) {
        errors.push({ field: f.label, message: 'Pincode must be exactly 6 digits.', severity: 'error' })
      }
    }

    // ── Mobile: 10 digits ──
    if (label.includes('mobile') || label.includes('phone') || label.includes('contact')) {
      const digits = value.replace(/\D/g, '')
      if (digits.length > 0 && digits.length !== 10) {
        errors.push({ field: f.label, message: `Mobile number must be 10 digits. Found ${digits.length}.`, severity: 'error' })
      }
    }

    // ── Account number: at least 8 digits ──
    if ((label.includes('account') && label.includes('no')) || label.includes('account number')) {
      const digits = value.replace(/\D/g, '')
      if (digits.length < 8) {
        errors.push({ field: f.label, message: 'Bank account number seems too short.', severity: 'warning' })
      }
    }

    // ── Name cross-check vs Aadhaar ──
    if (
      label.includes('name') &&
      !label.includes('father') &&
      !label.includes('mother') &&
      !label.includes('spouse') &&
      !label.includes('nominee')
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const aadhaarName: string = (profile as any)?.aadhaar?.name ?? ''
      if (aadhaarName) {
        const formNameClean    = value.toLowerCase().replace(/\s+/g, ' ').trim()
        const aadhaarNameClean = aadhaarName.toLowerCase().replace(/\s+/g, ' ').trim()
        if (formNameClean && formNameClean !== aadhaarNameClean) {
          // Only warn if first words don't match at all
          const formFirst    = formNameClean.split(' ')[0]
          const aadhaarFirst = aadhaarNameClean.split(' ')[0]
          if (!formFirst.startsWith(aadhaarFirst.slice(0, 3)) && !aadhaarFirst.startsWith(formFirst.slice(0, 3))) {
            errors.push({
              field: f.label,
              message: `Name "${f.value}" may not match Aadhaar name "${aadhaarName}". Please verify.`,
              severity: 'warning',
            })
          }
        }
      }
    }
  }

  return errors
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { fields, profile } = await request.json()

    if (!Array.isArray(fields)) {
      return NextResponse.json({ error: 'fields array is required.' }, { status: 400 })
    }

    // Rule-based checks (fast, no LLM)
    const ruleErrors = runRules(fields, profile ?? {})

    // GPT semantic check for complex cases
    let gptErrors: ValidationError[] = []
    try {
      const { client, deployment } = getOpenAIClient()
      const completion = await client.chat.completions.create({
        model: deployment,
        max_tokens: 512,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You validate filled Indian government form fields for logical and formatting errors.',
          },
          {
            role: 'user',
            content: `Check these form fields for errors. Be concise. Only flag real issues.

Fields:
${fields.map((f: FilledField) => `• ${f.label}: "${f.value}" (from ${f.source})`).join('\n')}

User profile for reference:
${JSON.stringify(profile, null, 2)}

Return JSON: { "errors": [{ "field": "label", "message": "issue", "severity": "error or warning" }] }
Return empty errors array if everything looks correct.`,
          },
        ],
      })
      const gptResult = JSON.parse(completion.choices[0]?.message?.content ?? '{"errors":[]}')
      gptErrors = Array.isArray(gptResult.errors) ? gptResult.errors : []
    } catch {
      // GPT validation is best-effort; rule errors are still returned
    }

    // Merge, deduplicate by field+message
    const seen = new Set<string>()
    const allErrors: ValidationError[] = []
    for (const e of [...ruleErrors, ...gptErrors]) {
      const key = `${e.field}|${e.message}`
      if (!seen.has(key)) { seen.add(key); allErrors.push(e) }
    }

    return NextResponse.json({
      errors: allErrors,
      isValid: allErrors.filter((e) => e.severity === 'error').length === 0,
    })
  } catch (error) {
    console.error('[kagaz-ai] validate-form error:', error)
    return NextResponse.json({ error: 'Validation failed.' }, { status: 500 })
  }
}
