/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { guardToResponse, requireAdmin } from '@/app/api/_utils/auth'
import { logAction } from '@/app/api/_utils/audit'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'
import { MAX_HOLD_DAYS, SENSITIVE_LABELS, formatSensitiveDate, isSensitiveKind } from '@/lib/sensitive-documents'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_REASON_LENGTH = 500

/**
 * Amânarea ștergerii automate a unui document sensibil (copie de buletin,
 * cazier). Doar adminul, cu motiv scris, și intră în jurnal. Merge și pe un
 * proiect încheiat: tocmai atunci curge termenul copiilor de buletin, iar un
 * control poate cere documentele după încheiere.
 *
 * Corp: `{ until: 'YYYY-MM-DD', reason }` pune amânarea, `{ until: null }` o scoate.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params
    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || !('until' in body)) {
      return NextResponse.json({ error: 'Trimite data amânării sau null' }, { status: 400 })
    }

    const rawUntil = (body as any).until
    const reason = typeof (body as any).reason === 'string' ? (body as any).reason.trim() : ''
    let until: string | null = null
    if (rawUntil !== null) {
      if (typeof rawUntil !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rawUntil)) {
        return NextResponse.json({ error: 'Data amânării trebuie să fie o zi validă' }, { status: 400 })
      }
      // Ziua aleasă se păstrează întreagă: ștergerea vine abia după ea.
      const day = new Date(`${rawUntil}T23:59:59.000Z`)
      if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== rawUntil) {
        return NextResponse.json({ error: 'Data amânării trebuie să fie o zi validă' }, { status: 400 })
      }
      if (day.getTime() <= Date.now()) {
        return NextResponse.json({ error: 'Alege o zi din viitor' }, { status: 400 })
      }
      if (day.getTime() > Date.now() + MAX_HOLD_DAYS * DAY_MS) {
        return NextResponse.json({ error: `Amânarea poate fi de cel mult ${Math.round(MAX_HOLD_DAYS / 365)} ani` }, { status: 400 })
      }
      if (reason.length < 3) {
        return NextResponse.json({ error: 'Scrie motivul amânării' }, { status: 400 })
      }
      if (reason.length > MAX_REASON_LENGTH) {
        return NextResponse.json({ error: `Motivul poate avea cel mult ${MAX_REASON_LENGTH} de caractere` }, { status: 400 })
      }
      until = day.toISOString()
    }

    const admin = createSupabaseServiceClient()
    const { data: req, error: reqError } = await admin
      .from('document_requirements')
      .select('id, project_id, name, sensitive_kind, sensitive_hold_until, sensitive_hold_reason, sensitive_purged_at, project:project_id(title)')
      .eq('id', requestId)
      .maybeSingle()

    if (reqError) {
      console.error('sensitive-hold lookup error:', reqError)
      return NextResponse.json({ error: 'Eroare la încărcarea cererii' }, { status: 500 })
    }
    if (!req) {
      return NextResponse.json({ error: 'Cererea nu a fost găsită' }, { status: 404 })
    }
    if (!isSensitiveKind(req.sensitive_kind)) {
      return NextResponse.json({ error: 'Cererea nu e marcată ca date sensibile' }, { status: 400 })
    }
    if (req.sensitive_purged_at) {
      return NextResponse.json({ error: 'Fișierele cererii au fost deja șterse automat' }, { status: 409 })
    }

    const update = until
      ? { sensitive_hold_until: until, sensitive_hold_reason: reason, sensitive_hold_by: ctx.profile.id }
      : { sensitive_hold_until: null, sensitive_hold_reason: null, sensitive_hold_by: null }

    // `is(sensitive_purged_at, null)`: o ștergere apărută între citire și scriere câștigă.
    const { data: updated, error: updateError } = await admin
      .from('document_requirements')
      .update(update)
      .eq('id', requestId)
      .is('sensitive_purged_at', null)
      .select('id')

    if (updateError) {
      console.error('sensitive-hold update error:', updateError)
      return NextResponse.json({ error: 'Nu am putut salva amânarea' }, { status: 500 })
    }
    if (!updated?.length) {
      return NextResponse.json({ error: 'Fișierele cererii au fost deja șterse automat' }, { status: 409 })
    }

    const project = Array.isArray(req.project) ? req.project[0] : req.project
    const label = SENSITIVE_LABELS[req.sensitive_kind]
    const actor = ctx.profile.email || 'Admin'
    await logAction({
      actorId: ctx.user.id,
      actionType: 'hold',
      entityType: 'document_request',
      entityId: req.id,
      entityName: req.name,
      oldValues: {
        sensitive_hold_until: req.sensitive_hold_until,
        sensitive_hold_reason: req.sensitive_hold_reason,
      },
      newValues: {
        sensitive_kind: req.sensitive_kind,
        sensitive_hold_until: until,
        sensitive_hold_reason: until ? reason : null,
        project_id: req.project_id,
        project_title: project?.title ?? null,
      },
      description: until
        ? `${actor} a amânat ștergerea automată a documentului "${req.name}" (${label}) până pe ${formatSensitiveDate(until)}. Motiv: ${reason}`
        : `${actor} a scos amânarea ștergerii automate pentru documentul "${req.name}" (${label})`,
      request,
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('sensitive-hold exception:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
