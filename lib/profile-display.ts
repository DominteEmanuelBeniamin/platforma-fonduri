export type ProfileDisplay = {
  full_name?: string | null
  email?: string | null
  is_active?: boolean | null
}

export function profileDisplayName(
  profile: ProfileDisplay | null | undefined,
  preferredName?: string | null,
  fallback = 'Cont necunoscut',
): string {
  const name = preferredName?.trim() || profile?.full_name?.trim() || profile?.email?.trim() || fallback
  return profile?.is_active === false ? name + ' (cont dezactivat)' : name
}
