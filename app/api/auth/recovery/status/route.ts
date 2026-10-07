import { recoveryStatus } from '@/app/api/_utils/recovery'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  return recoveryStatus(request)
}
