// După un POST /read reușit, contoarele din navigație se reîmprospătează imediat,
// fără să aștepte evenimentul realtime (care poate lipsi) sau ticul de 30 s.
export const PRIVATE_CHAT_READ_EVENT = 'bonie:private-chat-read'
export const PROJECT_CHAT_READ_EVENT = 'bonie:project-chat-read'

export function announceChatRead(event: typeof PRIVATE_CHAT_READ_EVENT | typeof PROJECT_CHAT_READ_EVENT) {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(event))
}
