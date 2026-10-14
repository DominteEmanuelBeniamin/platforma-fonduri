import { after } from 'next/server'
import { drainRecoveryDeliveries, enqueueRecoveryRequest } from '@/app/api/_utils/recovery'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const result = await enqueueRecoveryRequest(request)
  if (result.shouldDrain) {
    after(async () => {
      await drainRecoveryDeliveries()
    })
  }
  return result.response
}
