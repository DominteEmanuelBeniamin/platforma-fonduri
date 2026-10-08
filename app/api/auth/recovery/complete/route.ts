import { after } from 'next/server'
import { drainRecoveryDeliveries, completeRecovery } from '@/app/api/_utils/recovery'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const response = await completeRecovery(request)
  if (response.status === 200) {
    const body: unknown = await response.clone().json().catch(() => null)
    if (typeof body === 'object' && body !== null && 'status' in body && body.status === 'completed') {
      after(() => drainRecoveryDeliveries())
    }
  }
  return response
}