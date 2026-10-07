import { exchangeRecoveryToken } from '@/app/api/_utils/recovery'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return exchangeRecoveryToken(request)
}
