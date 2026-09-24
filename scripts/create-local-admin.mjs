// Creează un cont admin în stack-ul Supabase LOCAL (Docker), pentru bootstrap
// pe o mașină nouă — nu funcționează și nu are voie să funcționeze împotriva
// producției (cere explicit URL-ul local implicit al `supabase start`).
import { createClient } from '@supabase/supabase-js'

const LOCAL_URL = 'http://127.0.0.1:54321'
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const email = process.argv[2]
const password = process.argv[3]
const fullName = process.argv[4] || email

if (!email || !password) {
  console.error('Utilizare: node scripts/create-local-admin.mjs <email> <parola> ["Nume complet"]')
  process.exit(1)
}

const admin = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
})

if (error) {
  console.error('Eroare la creare user:', error.message)
  process.exit(1)
}

const { error: profileError } = await admin
  .from('profiles')
  .update({ role: 'admin', full_name: fullName })
  .eq('id', data.user.id)

if (profileError) {
  console.error('Eroare la setarea rolului:', profileError.message)
  process.exit(1)
}

console.log(`Cont admin local creat: ${email} (id ${data.user.id})`)
