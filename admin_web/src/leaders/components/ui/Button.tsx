// web_client/src/components/ui/Button.tsx 복사본 — 원본과 같이 고칠 것
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  full?: boolean
  loading?: boolean
  loadingText?: ReactNode
}

// 토스 스타일 버튼. variant: primary(브랜드 채움) | secondary(surface) | tertiary(라벤더 채움 — 더 보기 등 보조 행동) | danger(탈퇴 등 위험 행동)
// loadingText로 로딩 중 라벨을 커스텀(기존 화면 문구 보존용). 미지정 시 children 유지.
export default function Button({
  variant = 'primary',
  full = false,
  loading = false,
  loadingText,
  disabled = false,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex h-11 items-center justify-center rounded-btn px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50'
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-brand text-ink hover:brightness-95',
    secondary: 'bg-surface text-ink ring-1 ring-inset ring-line hover:bg-line',
    tertiary: 'bg-fill text-ink hover:brightness-95',
    danger: 'bg-danger-soft text-danger hover:brightness-95',
  }
  return (
    <button
      disabled={disabled || loading}
      className={`${base} ${variants[variant] ?? variants.primary} ${full ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {loading && loadingText ? loadingText : children}
    </button>
  )
}
