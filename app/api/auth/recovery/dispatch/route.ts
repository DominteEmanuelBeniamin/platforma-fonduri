import { dispatchRecovery } from '@/app/api/_utils/recovery'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: Request) {
  return dispatchRecovery(request)
}

export async function POST(request: Request) {
  return dispatchRecovery(request)
}
