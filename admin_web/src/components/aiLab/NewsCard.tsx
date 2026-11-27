import NaverNewsList from '../dailySurge/NaverNewsList'

// 네이버 뉴스 — AI 리포트와 완전히 분리된 칸. 급등락 화면의 뉴스 바로 보기 API 를 그대로 쓴다(서버 5분 캐시, 저장 안 함).
// 받은 그대로 원문 링크만 보여 주고, 요약하거나 AI 에 보내지 않는다(docs/naver-search-api-terms-issue.md).
export default function NewsCard({ ticker, date }: { ticker: string; date: string }) {
  return (
    <section className="flex flex-col gap-2 rounded-card bg-surface p-4" aria-label="네이버 뉴스 (AI 분석에 쓰지 않음)">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-bold text-ink">네이버 뉴스</h2>
        <span className="rounded-full bg-fill px-2 py-0.5 text-xs font-medium text-ink">AI 분석에 쓰지 않음</span>
      </div>
      <p className="text-xs text-ink-muted">AI 리포트와 별개입니다. 검색 결과를 받은 그대로 원문 링크만 보여 주며 저장·요약하지 않습니다.</p>
      <NaverNewsList kind="stock" date={date} target={ticker} />
    </section>
  )
}
