import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// shadcn/ui 표준 클래스 병합 — 조건부 결합(clsx) 후 충돌하는 Tailwind 클래스를 정리(tailwind-merge)
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
