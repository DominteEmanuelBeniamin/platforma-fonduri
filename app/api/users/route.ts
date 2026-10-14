/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/users/route.ts
import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { requireAdmin, requireProfile, guardToResponse } from '../_utils/auth'
import { createSupabaseServiceClient } from '../_utils/supabase'
import { logUserAction, getClientIP, getUserAgent } from '../_utils/audit'
import { escapeHtml, isValidReminderEmail, resendFromAddress, resolveReminderDelivery, sanitizeHeaderText } from '../_utils/email'
import { generateTemporaryPassword } from '@/lib/temporary-password'

function optionalText(value: unknown) {
  return typeof value === 'string' ? value.trim() || null : null
}

function appLoginUrl() {
  try {
    const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
    if (!configured) return null
    const base = new URL(configured)
    if (!['http:', 'https:'].includes(base.protocol) || !base.hostname || base.username || base.password) return null
    return new URL('/login', base.origin).toString()
  } catch {
    return null
  }
}

function partialProfileFailure(userId: string) {
  return NextResponse.json({
    code: 'profile_update_failed',
    error: 'Contul de autentificare a fost creat, dar profilul nu a putut fi actualizat. Este necesară remedierea manuală.',
    userId,
  }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Datele trimise nu sunt valide.' }, { status: 400 })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Datele trimise nu sunt valide.' }, { status: 400 })
    }

    const input = body as Record<string, unknown>
    const email = typeof input.email === 'string' ? input.email.trim() : ''
    const role = input.role
    const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : ''
    if (!isValidReminderEmail(email) || !fullName || (role !== 'client' && role !== 'consultant' && role !== 'admin')) {
      return NextResponse.json({ error: 'Emailul, numele și rolul trebuie completate corect.' }, { status: 400 })
    }

    const generatedPassword = generateTemporaryPassword()
    const admin = createSupabaseServiceClient()
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password: generatedPassword,
      email_confirm: true,
    })
    if (authError || !authData.user) {
      return NextResponse.json({ error: 'Nu s-a putut crea contul. Verifică datele și dacă emailul există deja.' }, { status: 400 })
    }

    const userId = authData.user.id
    const profileUpdate: any = {
      role,
      full_name: fullName,
      telefon: optionalText(input.telefon),
      must_change_password: true,
    }
    if (role === 'client') {
      profileUpdate.cif = optionalText(input.cif)
      profileUpdate.nume_firma = optionalText(input.numeFirma)
      profileUpdate.adresa_firma = optionalText(input.adresaFirma)
      profileUpdate.persoana_contact = optionalText(input.persoanaContact)
    } else if (role === 'consultant') {
      profileUpdate.specializare = optionalText(input.specializare)
      profileUpdate.departament = optionalText(input.departament)
    } else if (role === 'admin') {
      profileUpdate.departament = optionalText(input.departament)
    }

    try {
      const { data: updatedProfiles, error: profileError } = await admin
        .from('profiles')
        .update(profileUpdate)
        .eq('id', userId)
        .select('id')
      if (profileError || updatedProfiles?.[0]?.id !== userId) return partialProfileFailure(userId)
    } catch {
      return partialProfileFailure(userId)
    }

    let emailSent = false
    const delivery = resolveReminderDelivery(email)
    const appUrl = appLoginUrl()
    const resendApiKey = process.env.RESEND_API_KEY?.trim()
    if (delivery.ok && appUrl && resendApiKey) {
      const safeEmail = escapeHtml(email)
      const safePassword = escapeHtml(generatedPassword)
      const safeLoginUrl = escapeHtml(appUrl)
      const companyName = role === 'client' ? optionalText(input.numeFirma) : null
      const introduction = 'Ai acum acces la Bonie' + (companyName ? ' pentru ' + companyName : '') +
        '. Folosește datele de mai jos pentru a te autentifica:'
      try {
        const result = await new Resend(resendApiKey).emails.send({
          from: resendFromAddress(role === 'client' ? 'client' : 'internal'),
          to: delivery.data.deliveryEmail,
          subject: sanitizeHeaderText('Bun venit în Bonie'),
          html: '<p>Bună, ' + escapeHtml(fullName) + ',</p>' +
            '<p>' + escapeHtml(introduction) + '</p>' +
            '<p>Adresa de email: <strong>' + safeEmail + '</strong></p>' +
            '<p>Parola temporară: <code>' + safePassword + '</code></p>' +
            '<p>Intră în cont: <a href="' + safeLoginUrl + '">' + safeLoginUrl + '</a></p>' +
            '<p>După autentificare, te rugăm să schimbi parola temporară.</p>',
          text: 'Bună, ' + fullName + ',\n\n' + introduction + '\n\n' +
            'Adresa de email: ' + email + '\n' +
            'Parola temporară: ' + generatedPassword + '\n' +
            'Intră în cont: ' + appUrl + '\n\n' +
            'După autentificare, te rugăm să schimbi parola temporară.',
        }, { idempotencyKey: 'welcome-user/' + userId })
        emailSent = !result.error && Boolean(result.data?.id)
      } catch {
        emailSent = false
      }
    }

    const auditData: Record<string, any> = {
      email,
      role,
      full_name: fullName,
      telefon: profileUpdate.telefon,
      welcome_email_sent: emailSent,
    }
    if (role === 'client') {
      auditData.cif = profileUpdate.cif
      auditData.nume_firma = profileUpdate.nume_firma
      auditData.adresa_firma = profileUpdate.adresa_firma
      auditData.persoana_contact = profileUpdate.persoana_contact
    } else if (role === 'consultant') {
      auditData.specializare = profileUpdate.specializare
      auditData.departament = profileUpdate.departament
    } else if (role === 'admin') {
      auditData.departament = profileUpdate.departament
    }

    try {
      await logUserAction({
        adminId: ctx.user.id,
        actionType: 'create',
        userId,
        userEmail: email,
        oldValues: null,
        newValues: auditData,
        description: (ctx.profile.email || 'Admin') + ' a creat utilizatorul ' + email + ' cu rolul ' + role,
        ipAddress: getClientIP(request),
        userAgent: getUserAgent(request),
      })
    } catch {
      // Auditul nu blochează crearea contului.
    }

    return NextResponse.json({
      userId,
      emailSent,
      ...(emailSent ? {} : { temporaryPassword: generatedPassword }),
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Nu s-a putut crea utilizatorul.' }, { status: 500 })
  }
}

export async function GET(request: Request){
  try {
    const ctx = await requireProfile(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const state = new URL(request.url).searchParams.get('state') ??
      (ctx.profile.role === 'admin' ? 'all' : 'active')
    if (!['active', 'inactive', 'all'].includes(state)) {
      return NextResponse.json({ error: 'state trebuie să fie active, inactive sau all' }, { status: 400 })
    }

    const admin = createSupabaseServiceClient()
    if (ctx.profile.role === 'consultant') {
      let query = admin
        .from('profiles')
        .select('id, email, full_name, role, consultant_level, is_active')
        .eq('role', 'consultant')
      if (state === 'active') query = query.or('is_active.is.null,is_active.eq.true')
      if (state === 'inactive') query = query.eq('is_active', false)
      const { data, error } = await query.order('full_name')

      if (error) throw error

      return NextResponse.json({ users: data })
    }

    if (ctx.profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let query = admin
      .from('profiles')
      .select('*')
    if (state === 'active') query = query.or('is_active.is.null,is_active.eq.true')
    if (state === 'inactive') query = query.eq('is_active', false)

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ users: data })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}
