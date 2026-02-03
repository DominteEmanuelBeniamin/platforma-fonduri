import { NextResponse } from 'next/server'
import {requireAdmin, guardToResponse} from '../_utils/auth';
import {createSupabaseServiceClient} from '../_utils/supabase';

export async function GET(request: Request) {
    try{
        const ctx = await requireAdmin(request)
        if (!ctx.ok) return guardToResponse(ctx)
        const admin = createSupabaseServiceClient()
        const {data, error} = await admin
            .from('profiles')
            .select('id, email, full_name, cif')
            .eq('role', 'client')
            .order('full_name')
        if (error) throw error

        return NextResponse.json({clients: data})
    }
    catch (error: any) {
        return NextResponse.json({error: error.message}, {status: 400})
    }
}