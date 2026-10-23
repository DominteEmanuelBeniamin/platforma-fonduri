// Formate UE: https://vero.fi/en/businesses-and-corporations/taxes-and-charges/vat/international-commerce/vat-number/vat-numbers-issued-by-different-eu-countries/
// Cheia FR exclude literele I și O: https://www.gov.uk/guidance/vat-eu-country-codes-vat-numbers-and-vat-in-other-languages
export const CIF_COUNTRIES = [
  {
    code: 'RO', prefix: 'RO', label: 'România', pattern: /^[0-9]{2,10}$/,
    format: '2–10 cifre și cifră de control validă', example: 'RO5258486',
  },
  {
    code: 'AT', prefix: 'AT', label: 'Austria', pattern: /^U[0-9]{8}$/,
    format: 'U urmat de 8 cifre', example: 'ATU12345678',
  },
  {
    code: 'BE', prefix: 'BE', label: 'Belgia', pattern: /^[0-9]{10}$/,
    format: '10 cifre', example: 'BE0123456789',
  },
  {
    code: 'BG', prefix: 'BG', label: 'Bulgaria', pattern: /^[0-9]{9,10}$/,
    format: '9 sau 10 cifre', example: 'BG123456789',
  },
  {
    code: 'CZ', prefix: 'CZ', label: 'Cehia', pattern: /^[0-9]{8,10}$/,
    format: '8, 9 sau 10 cifre', example: 'CZ12345678',
  },
  {
    code: 'CY', prefix: 'CY', label: 'Cipru', pattern: /^[0-9]{8}[A-Z]$/,
    format: '8 cifre urmate de o literă', example: 'CY12345678A',
  },
  {
    code: 'HR', prefix: 'HR', label: 'Croația', pattern: /^[0-9]{11}$/,
    format: '11 cifre', example: 'HR12345678901',
  },
  {
    code: 'DK', prefix: 'DK', label: 'Danemarca', pattern: /^[0-9]{8}$/,
    format: '8 cifre', example: 'DK12345678',
  },
  {
    code: 'EE', prefix: 'EE', label: 'Estonia', pattern: /^[0-9]{9}$/,
    format: '9 cifre', example: 'EE123456789',
  },
  {
    code: 'FI', prefix: 'FI', label: 'Finlanda', pattern: /^[0-9]{8}$/,
    format: '8 cifre', example: 'FI12345678',
  },
  {
    code: 'FR', prefix: 'FR', label: 'Franța', pattern: /^[0-9A-HJ-NP-Z]{2}[0-9]{9}$/,
    format: '2 cifre sau litere (fără I și O), apoi 9 cifre', example: 'FR12345678901',
  },
  {
    code: 'DE', prefix: 'DE', label: 'Germania', pattern: /^[0-9]{9}$/,
    format: '9 cifre', example: 'DE123456789',
  },
  {
    code: 'GR', prefix: 'EL', label: 'Grecia', pattern: /^[0-9]{9}$/,
    format: '9 cifre', example: 'EL123456789',
  },
  {
    code: 'IE', prefix: 'IE', label: 'Irlanda', pattern: /^(?:[0-9]{7}[A-Z]{1,2}|[0-9][A-Z+*][0-9]{5}[A-Z])$/,
    format: '7 cifre și 1–2 litere; varianta veche: o cifră, o literă sau + ori *, 5 cifre și o literă', example: 'IE1234567A',
  },
  {
    code: 'IT', prefix: 'IT', label: 'Italia', pattern: /^[0-9]{11}$/,
    format: '11 cifre', example: 'IT12345678901',
  },
  {
    code: 'LV', prefix: 'LV', label: 'Letonia', pattern: /^[0-9]{11}$/,
    format: '11 cifre', example: 'LV12345678901',
  },
  {
    code: 'LT', prefix: 'LT', label: 'Lituania', pattern: /^(?:[0-9]{9}|[0-9]{12})$/,
    format: '9 sau 12 cifre', example: 'LT123456789',
  },
  {
    code: 'LU', prefix: 'LU', label: 'Luxemburg', pattern: /^[0-9]{8}$/,
    format: '8 cifre', example: 'LU12345678',
  },
  {
    code: 'MT', prefix: 'MT', label: 'Malta', pattern: /^[0-9]{8}$/,
    format: '8 cifre', example: 'MT12345678',
  },
  {
    code: 'PL', prefix: 'PL', label: 'Polonia', pattern: /^[0-9]{10}$/,
    format: '10 cifre', example: 'PL1234567890',
  },
  {
    code: 'PT', prefix: 'PT', label: 'Portugalia', pattern: /^[0-9]{9}$/,
    format: '9 cifre', example: 'PT123456789',
  },
  {
    code: 'SK', prefix: 'SK', label: 'Slovacia', pattern: /^[0-9]{10}$/,
    format: '10 cifre', example: 'SK1234567890',
  },
  {
    code: 'SI', prefix: 'SI', label: 'Slovenia', pattern: /^[0-9]{8}$/,
    format: '8 cifre', example: 'SI12345678',
  },
  {
    code: 'ES', prefix: 'ES', label: 'Spania', pattern: /^(?:[A-Z][0-9]{7}[A-Z0-9]|[0-9]{8}[A-Z])$/,
    format: '9 caractere: 7 cifre între o literă și o literă/cifră sau 8 cifre și o literă', example: 'ESA12345678',
  },
  {
    code: 'SE', prefix: 'SE', label: 'Suedia', pattern: /^[0-9]{10}01$/,
    format: '10 cifre urmate de 01', example: 'SE123456789001',
  },
  {
    code: 'NL', prefix: 'NL', label: 'Țările de Jos', pattern: /^[0-9]{9}B[0-9]{2}$/,
    format: '9 cifre, B și încă 2 cifre', example: 'NL123456789B01',
  },
  {
    code: 'HU', prefix: 'HU', label: 'Ungaria', pattern: /^[0-9]{8}$/,
    format: '8 cifre', example: 'HU12345678',
  },
] as const

export type CifCountry = (typeof CIF_COUNTRIES)[number]
export type CifCountryCode = CifCountry['code']
export type CifErrorCode = 'CIF_REQUIRED' | 'CIF_INVALID' | 'CIF_COUNTRY_MISMATCH' | 'CIF_COUNTRY_UNSUPPORTED'
export type CifError = {
  ok: false
  code: CifErrorCode
  message: string
  field: 'cif' | 'cifCountry'
}
export type CifResult = {
  ok: true
  country: CifCountryCode
  number: string
  cif: string
} | CifError

const findCountry = (code: string) => CIF_COUNTRIES.find(country => country.code === code || country.prefix === code)
const compactCif = (value: string) => value.replace(/[\s.]/g, '').toUpperCase()
const error = (code: CifErrorCode, message: string, field: CifError['field'] = 'cif'): CifError => ({ ok: false, code, message, field })
const unsupportedCountry = () => error('CIF_COUNTRY_UNSUPPORTED', 'Alege o țară din Uniunea Europeană.', 'cifCountry')
const invalidCif = (country: CifCountry) => error('CIF_INVALID', country.code === 'RO'
  ? 'CUI-ul nu e valid. Verifică cifrele.'
  : `CIF-ul pentru ${country.label} trebuie să respecte formatul: ${country.format}. Exemplu: ${country.example}.`)

/** Normalizează și verifică forma; cifra de control RO se verifică prin validateCif. */
export function normalizeCif(value: unknown, country?: unknown): CifResult {
  let selected: CifCountry = CIF_COUNTRIES[0]
  if (country !== undefined) {
    if (typeof country !== 'string') return unsupportedCountry()
    const found = findCountry(country.trim().toUpperCase())
    if (!found) return unsupportedCountry()
    selected = found
  }

  if (value === null || value === undefined) return error('CIF_REQUIRED', 'Completează CIF-ul firmei.')
  if (typeof value !== 'string') return error('CIF_INVALID', 'CIF-ul trebuie să fie text.')
  let number = compactCif(value)
  if (!number) return error('CIF_REQUIRED', 'Completează CIF-ul firmei.')
  if (!/^[A-Za-z0-9\s.*+]+$/.test(value)) return invalidCif(selected)

  // Cheia franceză poate fi chiar DE sau FR; literele numărului au prioritate.
  if ((country === undefined || !selected.pattern.test(number)) && /^[A-Z]{2}/.test(number)) {
    const inferred = findCountry(number.slice(0, 2))
    if (!inferred) return unsupportedCountry()
    if (country !== undefined && inferred.code !== selected.code) {
      return error('CIF_COUNTRY_MISMATCH', 'Prefixul CIF-ului nu corespunde țării selectate.')
    }
    selected = inferred
    number = number.slice(2)
  }

  if (!number) return error('CIF_REQUIRED', 'Completează CIF-ul firmei.')
  if (selected.code === 'RO') number = number.replace(/^0+/, '')
  if (!selected.pattern.test(number)) return invalidCif(selected)
  return { ok: true, country: selected.code, number, cif: selected.prefix + number }
}

/** RO: format și checksum; celelalte țări: numai format, fără VIES sau I/O. */
export function validateCif(value: unknown, country?: unknown): CifResult {
  const result = normalizeCif(value, country)
  if (!result.ok || result.country !== 'RO') return result

  // FinTPc §3.6.13.4.1: https://fintp.org/wp-content/uploads/2020/03/FinTPc-SRS.pdf
  const body = result.number.slice(0, -1).padStart(9, '0')
  const weights = '753217532'
  let sum = 0
  for (let index = 0; index < weights.length; index++) sum += Number(body[index]) * Number(weights[index])
  const remainder = sum * 10 % 11
  const checkDigit = remainder === 10 ? 0 : remainder
  return Number(result.number.at(-1)) === checkDigit ? result : invalidCif(CIF_COUNTRIES[0])
}

/** Citește o valoare salvată cu prefix; nu ghicește țara pentru valori legacy. */
export function parseCif(value: unknown): CifResult {
  if (typeof value === 'string') {
    const compact = compactCif(value)
    if (compact && !/^[A-Z]{2}/.test(compact)) {
      return error('CIF_INVALID', 'CIF-ul salvat nu are un prefix fiscal recunoscut.')
    }
  }
  return validateCif(value)
}
