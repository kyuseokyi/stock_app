import { useEffect } from 'react'
import { withBrand } from '../lib/pageTitle'

/** 데이터가 온 뒤 탭 제목을 구체적으로(글 제목·종목명). 비어 있으면 Layout 이 넣은 경로 제목을 그대로 둔다. */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title) document.title = withBrand(title)
  }, [title])
}
