// Datele operatorului din informarea de confidențialitate (`/confidentialitate`).
// Stau în variabile de mediu, nu în cod: aceeași aplicație poate rula pentru
// altă firmă, iar o valoare lipsă se vede pe pagină ca „de completat”, nu
// ca o firmă inventată.

export type PrivacyOperator = {
  name: string | null
  cui: string | null
  address: string | null
  email: string | null
  /** Responsabilul cu protecția datelor, dacă firma a numit unul. */
  dpo: string | null
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function privacyOperator(): PrivacyOperator {
  return {
    name: clean(process.env.NEXT_PUBLIC_PRIVACY_OPERATOR_NAME),
    cui: clean(process.env.NEXT_PUBLIC_PRIVACY_OPERATOR_CUI),
    address: clean(process.env.NEXT_PUBLIC_PRIVACY_OPERATOR_ADDRESS),
    email: clean(process.env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL),
    dpo: clean(process.env.NEXT_PUBLIC_PRIVACY_DPO_CONTACT),
  }
}
