// ── Profile data types ────────────────────────────────────────────────────────

export interface AadhaarData {
  name: string
  dob: string
  gender: string
  aadhaarNumber: string
  address: string
  pincode?: string
  state?: string
  fatherName?: string
  motherName?: string
}

export interface PanData {
  name: string
  panNumber: string
  dob: string
  fatherName?: string
}

export interface BankData {
  accountHolderName: string
  accountNumber: string
  ifsc: string
  bankName: string
  branchName?: string
  accountType?: string
}

export interface RationCardData {
  cardNumber: string
  headOfFamily: string
  address?: string
  category?: string // APL / BPL / AAY
}

export interface PassportData {
  name: string
  passportNumber: string
  dob: string
  gender: string
  expiryDate?: string
  placeOfBirth?: string
  nationality?: string
}

export interface UserProfile {
  aadhaar?: AadhaarData
  pan?: PanData
  bank?: BankData
  rationCard?: RationCardData
  passport?: PassportData
  updatedAt?: string
}

export type DocType = 'aadhaar' | 'pan' | 'bank' | 'rationCard' | 'passport'

// ── localStorage helpers ──────────────────────────────────────────────────────

const KEY = 'kagaz_profile'

export function getProfile(): UserProfile | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as UserProfile) : null
  } catch {
    return null
  }
}

export function saveProfile(profile: UserProfile): void {
  if (typeof window === 'undefined') return
  profile.updatedAt = new Date().toISOString()
  localStorage.setItem(KEY, JSON.stringify(profile))
}

export function clearProfile(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(KEY)
}

export function hasRequiredDocs(profile: UserProfile | null): boolean {
  return !!profile?.aadhaar?.aadhaarNumber
}

// ── Doc metadata used by onboarding UI ───────────────────────────────────────

export const DOC_META: Record<DocType, { label: string; labelHi: string; mandatory: boolean; icon: string }> = {
  aadhaar:    { label: 'Aadhaar Card',   labelHi: 'आधार कार्ड',    mandatory: true,  icon: '🪪' },
  pan:        { label: 'PAN Card',       labelHi: 'पैन कार्ड',     mandatory: false, icon: '💳' },
  bank:       { label: 'Bank Passbook',  labelHi: 'बैंक पासबुक',   mandatory: false, icon: '🏦' },
  rationCard: { label: 'Ration Card',    labelHi: 'राशन कार्ड',    mandatory: false, icon: '🧾' },
  passport:   { label: 'Passport',       labelHi: 'पासपोर्ट',      mandatory: false, icon: '📕' },
}
