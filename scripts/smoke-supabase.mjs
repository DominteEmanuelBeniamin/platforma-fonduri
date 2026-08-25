import nextEnv from '@next/env'
import { createClient } from '@supabase/supabase-js'

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const newColumns = 'id,user_id,project_id,type,entity_type,entity_id,title,item_count,event_key,created_at,read_at'
const legacyColumns = 'id,user_id,type,title,message,priority,entity_type,entity_id,is_read,read_at,created_at'

const [newSchema, legacySchema, rowCount] = await Promise.all([
  admin.from('notifications').select(newColumns).limit(1),
  admin.from('notifications').select(legacyColumns).limit(1),
  admin.from('notifications').select('id', { count: 'exact', head: true }),
])

const result = {
  projectHost: new URL(url).host,
  table: {
    newSchema: !newSchema.error,
    legacySchema: !legacySchema.error,
    legacyContractRejected: Boolean(legacySchema.error),
    empty: rowCount.error ? null : rowCount.count === 0,
  },
  errors: {
    newSchema: newSchema.error?.code ?? null,
    legacySchema: legacySchema.error?.code ?? null,
    rowCount: rowCount.error?.code ?? null,
  },
}

console.log(JSON.stringify(result, null, 2))

if (newSchema.error || rowCount.error || !legacySchema.error) {
  process.exitCode = 1
}
