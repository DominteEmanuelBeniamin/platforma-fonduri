import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { runSensitivePurge, sensitivePurgeEnabled } from '@/app/api/_utils/sensitive-purge'

export const maxDuration = 300

/**
 * Zilnic: șterge fișierele documentelor sensibile ajunse la termen (vezi
 * `lib/sensitive-documents.ts`). Fără `SENSITIVE_PURGE_ENABLED=true` doar
 * raportează ce ar șterge. Răspunsul nu conține nume, doar identificatori.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== 'Bearer ' + secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const report = await runSensitivePurge(createSupabaseServiceClient(), {
      now: new Date(),
      enabled: sensitivePurgeEnabled(),
    })
    console.info('[date-sensibile]', {
      mode: report.mode,
      checked: report.checked,
      due: report.due,
      purged: report.purged,
      failed: report.failed,
    })
    return NextResponse.json({ ok: report.failed === 0, ...report }, { status: report.failed === 0 ? 200 : 500 })
  } catch (error) {
    console.error('[date-sensibile] run failed', error)
    return NextResponse.json({ ok: false, error: 'Jobul de ștergere a documentelor sensibile a eșuat' }, { status: 500 })
  }
}
