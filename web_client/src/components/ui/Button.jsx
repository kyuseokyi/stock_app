// 토스 스타일 버튼. variant: primary(브랜드 채움) | secondary(surface)
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
}) {
  const base =
    'inline-flex h-11 items-center justify-center rounded-btn px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50'
  const variants = {
    primary: 'bg-brand text-white hover:brightness-95',
    secondary: 'bg-surface text-ink hover:bg-line',
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
