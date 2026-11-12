import type { ReactNode } from 'react'
import Card from './ui/Card'
import PageHeader from './ui/PageHeader'

// 정책 문서(개인정보처리방침·계정 삭제 안내) 공통 틀 — 로그인 없이 읽는 공개 페이지라 스토어·소셜 검수에 이 주소를 낸다.
export const SUPPORT_EMAIL = 'support@funnotedaily.com'

interface PolicyArticleProps {
  title: string
  effectiveDate: string
  intro: ReactNode
  children: ReactNode
}

export default function PolicyArticle({ title, effectiveDate, intro, children }: PolicyArticleProps) {
  return (
    <article className="mx-auto max-w-2xl">
      <PageHeader title={title} description={`시행일 ${effectiveDate}`} className="mb-5" />
      <Card className="text-pretty text-sm leading-relaxed text-ink">{intro}</Card>
      <div className="mt-3 space-y-3">{children}</div>
    </article>
  )
}

export function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card as="section" className="text-pretty text-sm leading-relaxed text-ink">
      <h2 className="mb-2 text-base font-bold">{title}</h2>
      <div className="space-y-2 text-ink-muted [&_li]:ml-4 [&_li]:list-disc [&_strong]:text-ink">{children}</div>
    </Card>
  )
}

export function SupportMail() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-ink underline underline-offset-2">
      {SUPPORT_EMAIL}
    </a>
  )
}
