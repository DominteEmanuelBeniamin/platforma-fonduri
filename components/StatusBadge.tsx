'use client'

import { CheckCircle, Clock, Eye, XCircle } from 'lucide-react'

type StatusType = 'pending' | 'review' | 'approved' | 'rejected'

interface StatusBadgeProps {
  status: StatusType | string
  size?: 'sm' | 'md' | 'lg'
  showIcon?: boolean
}

const statusConfig: Record<StatusType, {
  bg: string
  text: string
  border: string
  label: string
  icon: React.ReactNode
}> = {
  pending: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    label: 'Așteaptă răspuns',
    icon: <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
  },
  review: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    label: 'În verificare',
    icon: <Eye className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
  },
  approved: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    label: 'Aprobat',
    icon: <CheckCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
  },
  rejected: {
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
    label: 'Respins',
    icon: <XCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
  }
}

const sizeClasses = {
  sm: 'px-2 py-0.5 text-[10px] sm:text-xs',
  md: 'px-2.5 py-1 text-xs sm:text-sm',
  lg: 'px-3 py-1.5 text-sm'
}

export default function StatusBadge({ 
  status, 
  size = 'md', 
  showIcon = true 
}: StatusBadgeProps) {
  const config = statusConfig[status as StatusType] || statusConfig.pending
  
  return (
    <span 
      className={`
        inline-flex items-center gap-1.5 
        rounded-full border font-medium
        whitespace-nowrap w-fit
        ${config.bg} ${config.text} ${config.border}
        ${sizeClasses[size]}
      `}
    >
      {showIcon && config.icon}
      {config.label}
    </span>
  )
}

// Export pentru utilizare în alte componente
export { statusConfig }
export type { StatusType }