'use client'

import { usePathname } from 'next/navigation'

export default function AppContent({ children }: { children: React.ReactNode }) {
  const isPrivateChat = usePathname() === '/chat'

  return (
    <main
      id="continut"
      className={isPrivateChat
        ? 'relative h-[calc(100dvh-4rem)] min-h-0 overflow-hidden'
        : 'relative flex-1 pt-16 pb-16 min-h-screen'}
    >
      <div className={isPrivateChat
        ? 'h-full w-full'
        : 'mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-10'}
      >
        {children}
      </div>
    </main>
  )
}
