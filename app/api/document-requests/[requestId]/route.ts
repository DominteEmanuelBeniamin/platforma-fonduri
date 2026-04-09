/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { guardToResponse, requireAdmin } from '@/app/api/_utils/auth'
import { createSupabaseServiceClient } from '@/app/api/_utils/supabase'

// Inițializat în handler ca să preia env-ul la runtime, nu la cold-start

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { requestId } = await params

    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    // assigned_to trebuie să fie string (UUID) sau null
    const rawAssigned = (body as any).assigned_to
    if (rawAssigned !== null && typeof rawAssigned !== 'string') {
      return NextResponse.json({ error: 'assigned_to trebuie să fie un UUID sau null' }, { status: 400 })
    }
    const assigned_to: string | null = rawAssigned ?? null

    const admin = createSupabaseServiceClient()

    // Obține cererea pentru a afla project_id și detalii email
    const { data: req, error: reqError } = await admin
      .from('document_requirements')
      .select('id, project_id, name, description, deadline_at')
      .eq('id', requestId)
      .maybeSingle()

    if (reqError) {
      console.error('PATCH document-requests fetch error:', reqError)
      return NextResponse.json({ error: 'Eroare la încărcarea cererii' }, { status: 500 })
    }
    if (!req) {
      return NextResponse.json({ error: 'Cererea nu a fost găsită' }, { status: 404 })
    }

    // Dacă se atribuie cuiva, verifică că este consultant membru al proiectului
    if (assigned_to !== null) {
      const { data: membership, error: memberError } = await admin
        .from('project_members')
        .select('id')
        .eq('project_id', req.project_id)
        .eq('consultant_id', assigned_to)
        .maybeSingle()

      if (memberError) {
        console.error('PATCH document-requests membership error:', memberError)
        return NextResponse.json({ error: 'Eroare la verificarea membrului' }, { status: 500 })
      }
      if (!membership) {
        return NextResponse.json(
          { error: 'Consultantul nu este membru al acestui proiect' },
          { status: 400 }
        )
      }
    }

    // Actualizează câmpul assigned_to
    const { error: updateError } = await admin
      .from('document_requirements')
      .update({ assigned_to })
      .eq('id', requestId)

    if (updateError) {
      console.error('PATCH document-requests update error:', updateError)
      return NextResponse.json({ error: 'Eroare la actualizarea cererii' }, { status: 500 })
    }

    // Trimite email consultantului atribuit (erorile de email nu blochează răspunsul)
    if (assigned_to !== null) {
      try {
        const [{ data: consultant }, { data: project }] = await Promise.all([
          admin.from('profiles').select('full_name, email').eq('id', assigned_to).maybeSingle(),
          admin.from('projects').select('id, title').eq('id', req.project_id).maybeSingle(),
        ])

        if (consultant?.email && project) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
          const projectUrl = `${appUrl}/projects/${project.id}`
          const salut = consultant.full_name ? `Salut, ${consultant.full_name}!` : 'Salut!'
          const deadline = req.deadline_at
            ? new Date(req.deadline_at).toLocaleDateString('ro-RO', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })
            : null

          const html = `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">

    <div style="background:linear-gradient(135deg,#4f46e5,#6366f1);padding:32px 40px;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">Cerere nouă atribuită</h1>
      <p style="margin:8px 0 0;color:#c7d2fe;font-size:14px;">${project.title}</p>
    </div>

    <div style="padding:32px 40px;">
      <p style="margin:0 0 20px;color:#374151;font-size:15px;">${salut}</p>
      <p style="margin:0 0 24px;color:#374151;font-size:15px;">
        Ți-a fost atribuită o nouă cerere de document în proiectul <strong>${project.title}</strong>.
      </p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:0 0 28px;">
        <p style="margin:0 0 12px;color:#6b7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;">Detalii cerere</p>
        <p style="margin:0 0 8px;color:#111827;font-size:16px;font-weight:600;">${req.name}</p>
        ${req.description ? `<p style="margin:0 0 10px;color:#4b5563;font-size:14px;line-height:1.6;">${req.description}</p>` : ''}
        ${deadline ? `<p style="margin:0;color:#d97706;font-size:13px;font-weight:500;">⏱ Termen limită: ${deadline}</p>` : ''}
      </div>

      <a href="${projectUrl}"
         style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.01em;">
        Mergi la proiect →
      </a>
    </div>

    <div style="padding:20px 40px;border-top:1px solid #f1f5f9;">
      <p style="margin:0;color:#9ca3af;font-size:12px;">
        Acest email a fost generat automat de Platforma Fonduri EU. Nu răspunde la acest mesaj.
      </p>
    </div>
  </div>
</body>
</html>`

          const resend = new Resend(process.env.RESEND_API_KEY)
          const { error: emailError } = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
            to: consultant.email,
            subject: `Ți-a fost atribuită o cerere nouă — ${project.title}`,
            html,
          })
          if (emailError) {
            console.error('Resend error:', emailError)
          }
        }
      } catch (emailError) {
        console.error('Email send error (non-blocking):', emailError)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('PATCH document-requests exception:', e)
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: 500 })
  }
}
