import type { AppRole } from './auth'

export function canUsePrivateChat(role: AppRole) {
  return role === 'admin' || role === 'consultant'
}

export function canChatWithUser(
  current: { id: string; role: AppRole },
  target: { id: string; role: AppRole }
) {
  if (current.id === target.id) return false

  if (!canUsePrivateChat(current.role)) return false
  if (!canUsePrivateChat(target.role)) return false

  return true
}