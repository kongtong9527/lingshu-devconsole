/**
 * 灵枢 DevConsole 图标集
 * Lucide 风格内联 SVG（stroke-based，currentColor 继承）
 * 替换原有 emoji（▶ ← → ✓），满足 no-emoji-icons 规则
 */

interface IconProps {
  size?: number
  className?: string
  'aria-hidden'?: boolean
}

function svgProps(size: number, className?: string, ariaHidden?: boolean) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': ariaHidden ?? true,
    focusable: false as const,
  }
}

export function PlayIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function ArrowLeftIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

export function ArrowRightIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

export function CheckIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export function ChevronRightIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

export function CopyIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

export function InboxIcon({ size = 32, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  )
}

export function AlertIcon({ size = 16, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

export function TerminalIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

export function PlugIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  )
}

export function TrashIcon({ size = 12, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

export function NetworkIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <path d="M12 8v4" />
      <path d="M5 16v-2a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

export function BracesIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1" />
      <path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1" />
    </svg>
  )
}

export function EyeIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function SunIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

export function MoonIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

export function SettingsIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

export function UserIcon({ size = 14, className, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, className, rest['aria-hidden'])}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}
