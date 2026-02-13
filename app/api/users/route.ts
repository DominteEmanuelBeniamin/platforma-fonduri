/* eslint-disable @typescript-eslint/no-explicit-any */
// app/api/users/route.ts
import { NextResponse } from 'next/server'
import { requireAdmin, guardToResponse } from '../_utils/auth'
import { createSupabaseServiceClient } from '../_utils/supabase'
import { logUserAction, getClientIP, getUserAgent } from '../_utils/audit'

export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const body = await request.json()
    const { 
      email, 
      password, 
      role, 
      fullName, 
      telefon, 
      cif, 
      numeFirma, 
      adresaFirma, 
      persoanaContact, 
      specializare, 
      departament 
    } = body

    const admin = createSupabaseServiceClient()
    
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true
    })

    if (authError) throw authError

    if (authData.user) {
      const profileUpdate: any = {
        role: role,
        full_name: fullName,
        telefon: telefon || null
      }

      if (role === 'client') {
        profileUpdate.cif = cif || null
        profileUpdate.nume_firma = numeFirma || null
        profileUpdate.adresa_firma = adresaFirma || null
        profileUpdate.persoana_contact = persoanaContact || null
      } else if (role === 'consultant') {
        profileUpdate.specializare = specializare || null
        profileUpdate.departament = departament || null
      } else if (role === 'admin') {
        profileUpdate.departament = departament || null
      }

      const { error: profileError } = await admin
        .from('profiles')
        .update(profileUpdate)
        .eq('id', authData.user.id)

      if (profileError) throw profileError

      // ✅ AUDIT LOG - Creare utilizator
      const auditData: Record<string, any> = {
        email,
        role,
        full_name: fullName,
        telefon: telefon || null
      }

      if (role === 'client') {
        auditData.cif = cif || null
        auditData.nume_firma = numeFirma || null
        auditData.adresa_firma = adresaFirma || null
        auditData.persoana_contact = persoanaContact || null
      } else if (role === 'consultant') {
        auditData.specializare = specializare || null
        auditData.departament = departament || null
      } else if (role === 'admin') {
        auditData.departament = departament || null
      }

      await logUserAction({
        adminId: ctx.user.id,
        actionType: 'create',
        userId: authData.user.id,
        userEmail: email,
        oldValues: null,
        newValues: auditData,
        description: `${ctx.profile.email || 'Admin'} a creat utilizatorul ${email} cu rolul ${role}`,
        ipAddress: getClientIP(request),
        userAgent: getUserAgent(request)
      })
    }

    return NextResponse.json({ message: 'User creat cu succes!' })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}

export async function GET(request: Request){
  try {
    const ctx = await requireAdmin(request)
    if (!ctx.ok) return guardToResponse(ctx)

    const admin = createSupabaseServiceClient()
    const { data, error } = await admin
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ users: data })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}