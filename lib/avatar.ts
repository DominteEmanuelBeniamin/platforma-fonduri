export const avatarColors = [
    { from: '#2456a7', to: '#2563eb' },
    { from: '#a855f7', to: '#9333ea' },
    { from: '#ec4899', to: '#db2777' },
    { from: '#6366f1', to: '#4f46e5' },
    { from: '#06b6d4', to: '#0891b2' },
    { from: '#14b8a6', to: '#0d9488' },
    { from: '#10b981', to: '#059669' },
    { from: '#f59e0b', to: '#d97706' },
    { from: '#f97316', to: '#ea580c' },
    { from: '#ef4444', to: '#dc2626' },
  ]
  
  export const getInitials = (name?: string | null, email?: string | null): string => {
    if (name && name.trim()) {
      const words = name.trim().split(/\s+/)
      if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
      return words[0].slice(0, 2).toUpperCase()
    }
    if (email) return email.charAt(0).toUpperCase()
    return '?'
  }
  
  export const getAvatarColor = (identifier: string) => {
    const hash = identifier.split('').reduce((acc, char) => {
      return char.charCodeAt(0) + ((acc << 5) - acc)
    }, 0)
    return avatarColors[Math.abs(hash) % avatarColors.length]
  }
  