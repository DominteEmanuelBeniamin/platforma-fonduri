/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/users/route.ts
import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { requireAdmin, requireProfile, guardToResponse } from '../_utils/auth'
import { createSupabaseServiceClient } from '../_utils/supabase'
import { logUserAction, getClientIP, getUserAgent } from '../_utils/audit'
import { escapeHtml, isValidReminderEmail, resendFromAddress, resolveReminderDelivery, sanitizeHeaderText } from '../_utils/email'
import { generateTemporaryPassword } from '@/lib/temporary-password'
import { validateCif } from '@/lib/cif'
import { cifForbidden, cifValidationFailure, checkCifAvailable, creationUnconfirmed, finalizeCreatedAccount, persistedAuthTimestamp } from '../_utils/user-creation'

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

/**
 * Ce trebuie completat la un cont nou, pe rol (#111). CIF-ul clientului are
 * validarea lui, mai jos; telefonul și departamentul rămân opționale.
 * `persoana_contact` nu se mai cere: persoana de contact e chiar titularul.
 */
const REQUIRED_BY_ROLE: Record<'client' | 'consultant' | 'admin', { key: string; label: string }[]> = {
  client: [{ key: 'numeFirma', label: 'numele firmei' }, { key: 'adresaFirma', label: 'adresa firmei' }],
  consultant: [{ key: 'specializare', label: 'specializarea' }],
  admin: [],
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
    if (role !== 'client' && role !== 'consultant' && role !== 'admin') {
      return NextResponse.json({ error: 'Emailul, numele și rolul trebuie completate corect.' }, { status: 400 })
    }
    if (!fullName) {
      return NextResponse.json({ code: 'FIELD_REQUIRED', field: 'fullName', message: 'Completează numele complet.' }, { status: 400 })
    }
    if (!isValidReminderEmail(email)) {
      return NextResponse.json({ code: 'FIELD_REQUIRED', field: 'email', message: 'Completează un email valid.' }, { status: 400 })
    }
    for (const key of ['telefon', 'numeFirma', 'adresaFirma', 'departament', 'specializare']) {
      if (input[key] !== undefined && input[key] !== null && typeof input[key] !== 'string') {
        return NextResponse.json({ code: 'INVALID_PROFILE_PATCH', message: 'Datele profilului nu sunt valide.' }, { status: 400 })
      }
    }
    // Câmpurile obligatorii pe rol (#111); emailul și numele sunt verificate mai sus.
    const missing = REQUIRED_BY_ROLE[role].find(field => !optionalText(input[field.key]))
    if (missing) {
      return NextResponse.json({ code: 'FIELD_REQUIRED', field: missing.key, message: 'Completează ' + missing.label + '.' }, { status: 400 })
    }
    if (input.consultantLevel !== undefined && (role !== 'consultant' || (input.consultantLevel !== 'junior' && input.consultantLevel !== 'senior'))) {
      return NextResponse.json({ code: 'INVALID_PROFILE_PATCH', field: 'consultantLevel', message: 'Nivelul poate fi junior sau senior, doar pentru consultanți.' }, { status: 400 })
    }
    let canonicalCif: string | null = null
    if (role === 'client') {
      const result = validateCif(input.cif, input.cifCountry)
      if (!result.ok) {
        const failure = cifValidationFailure(result)
        return NextResponse.json(failure.body, { status: failure.status })
      }
      canonicalCif = result.cif
    } else if (Object.hasOwn(input, 'cif') || Object.hasOwn(input, 'cifCountry')) {
      return NextResponse.json(cifForbidden.body, { status: cifForbidden.status })
    }
    const profileUpdate: Record<string, string | null> = {
      full_name: fullName,
      telefon: optionalText(input.telefon),
    }
    if (role === 'client') {
      profileUpdate.nume_firma = optionalText(input.numeFirma)
      profileUpdate.adresa_firma = optionalText(input.adresaFirma)
    } else if (role === 'consultant') {
      profileUpdate.consultant_level = input.consultantLevel === 'senior' ? 'senior' : 'junior'
      profileUpdate.specializare = optionalText(input.specializare)
      profileUpdate.departament = optionalText(input.departament)
    } else if (role === 'admin') {
      profileUpdate.departament = optionalText(input.departament)
    }

    const admin = createSupabaseServiceClient()
    const unavailable = await checkCifAvailable(admin, canonicalCif)
    if (unavailable) return NextResponse.json(unavailable.body, { status: unavailable.status })
    const generatedPassword = generateTemporaryPassword()
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email, password: generatedPassword, email_confirm: true, ban_duration: '87600h',
    })
    if (authError || !authData.user) {
      if (!authError?.status || authError.status >= 500) return NextResponse.json(creationUnconfirmed.body, { status: creationUnconfirmed.status })
      return NextResponse.json({ code: 'AUTH_CREATE_FAILED', message: 'Nu s-a putut crea contul. Verifică datele și dacă emailul există deja.' }, { status: 400 })
    }
    const userId = authData.user.id
    const finalization = await finalizeCreatedAccount(admin, {
      userId, actorId: ctx.user.id, ban: persistedAuthTimestamp(authData.user.banned_until),
      role, cif: canonicalCif, profile: profileUpdate,
    })
    if (!finalization.ok) return NextResponse.json(finalization.body, { status: finalization.status, headers: { 'Cache-Control': 'no-store' } })

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
      auditData.cif = canonicalCif
      auditData.nume_firma = profileUpdate.nume_firma
      auditData.adresa_firma = profileUpdate.adresa_firma
    } else if (role === 'consultant') {
      auditData.consultant_level = profileUpdate.consultant_level
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
    return NextResponse.json({ code: 'ACCOUNT_CREATION_UNCONFIRMED', message: 'Nu am putut confirma crearea utilizatorului. Verifică lista de utilizatori înainte de a reîncerca.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
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
