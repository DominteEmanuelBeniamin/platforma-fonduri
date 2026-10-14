import { recoveryAvailability } from '@/app/api/_utils/recovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return recoveryAvailability()
}
