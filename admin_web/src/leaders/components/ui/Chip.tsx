// web_client/src/components/ui/Chip.tsx 복사본 — 원본과 같이 고칠 것 (필터가 쓰는 chipClass 만)

// 버튼 등 다른 엘리먼트에도 칩 스타일을 입히기 위한 클래스 헬퍼
export function chipClass(active: boolean): string {
  return `inline-flex items-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${
    active ? 'bg-brand-soft text-brand-strong' : 'bg-fill text-ink-muted hover:brightness-95'
  }`
}
