export async function apiFetch(
    supabase: any,
    url: string,
    options: RequestInit = {}
  ) {
    const {
      data: { session }
    } = await supabase.auth.getSession()
  
    if (!session) throw new Error('Not authenticated')
  
    const res = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${session.access_token}`
      }
    })
  
    const json = await res.json().catch(() => ({}))
  
    if (!res.ok) {
      throw new Error(json?.error || 'Request failed')
    }
  
    return json
  }