import { lazy, Suspense, useEffect, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { listScreenerFeatures } from '../api/screenerFeatures'

// echarts 번들이 무거우므로 차트 모달은 필요할 때만 지연 로딩
const ChartSnapshotModal = lazy(() => import('./ChartSnapshotModal'))

// 툴바 버튼 공통 스타일
const btn = (active: boolean) =>
  `rounded px-2 py-1 text-sm font-medium transition ${
    active ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`

// A안(설계 3-6): 사용자 시세 노출(MARKET_DATA 전역 스위치)이 꺼져 있으면 새 차트 삽입을 막는다.
// 요청자 기준 값(GraphQL screenerFeatures.marketData)은 관리자에게 항상 true 라 쓰지 않고, 관리자 REST 의 전역 값을 본다.
// 조회 실패 = 꺼짐(닫힘). 기존 글에 이미 들어간 차트 이미지는 여기서 다루지 않는다(별도 점검).
const CHART_DISABLED_HINT = '사용자 시세 노출이 꺼져 있어 새 차트를 넣을 수 없어요(켜려면 KRX/코스콤 라이선스 필요)'

function useChartInsertAllowed(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    listScreenerFeatures()
      .then((rows) => alive && setAllowed(rows.some((f) => f.key === 'MARKET_DATA' && f.enabled)))
      .catch(() => alive && setAllowed(false))
    return () => {
      alive = false
    }
  }, [])
  return allowed
}

function Toolbar({
  editor,
  onChartClick,
  chartAllowed,
}: {
  editor: Editor | null
  onChartClick: () => void
  chartAllowed: boolean | null
}) {
  if (!editor) return null

  const addLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('링크 URL', prev || 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
      <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive('bold'))}>
        <b>B</b>
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive('italic'))}>
        <i>I</i>
      </button>
      <span className="mx-1 h-4 w-px bg-slate-300" />
      <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btn(editor.isActive('heading', { level: 2 }))}>
        H2
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={btn(editor.isActive('heading', { level: 3 }))}>
        H3
      </button>
      <span className="mx-1 h-4 w-px bg-slate-300" />
      <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive('bulletList'))}>
        • 목록
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive('orderedList'))}>
        1. 목록
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={btn(editor.isActive('blockquote'))}>
        인용
      </button>
      <button type="button" onClick={addLink} className={btn(editor.isActive('link'))}>
        링크
      </button>
      <button
        type="button"
        onClick={onChartClick}
        disabled={chartAllowed !== true}
        title={chartAllowed === false ? CHART_DISABLED_HINT : undefined}
        className={`${btn(false)} disabled:cursor-not-allowed disabled:opacity-40`}
      >
        📈 차트 삽입
      </button>
      {chartAllowed === false && <span className="text-xs text-amber-700">시세 노출 꺼짐 — 차트 삽입 불가</span>}
      <span className="mx-1 h-4 w-px bg-slate-300" />
      <button type="button" onClick={() => editor.chain().focus().undo().run()} className={btn(false)}>
        ↶
      </button>
      <button type="button" onClick={() => editor.chain().focus().redo().run()} className={btn(false)}>
        ↷
      </button>
    </div>
  )
}

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
}

export default function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const [chartOpen, setChartOpen] = useState(false)
  const chartAllowed = useChartInsertAllowed()
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ inline: false, HTMLAttributes: { class: 'rounded-lg' } }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class:
          'prose max-w-none min-h-[280px] px-3 py-2 focus:outline-hidden text-sm',
      },
    },
  })

  // 외부에서 content 가 비동기로 주입될 때(수정 화면 로딩) 에디터에 반영
  useEffect(() => {
    if (editor && value !== undefined && value !== editor.getHTML()) {
      editor.commands.setContent(value || '', false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor])

  const insertChart = (dataURL: string) => {
    editor?.chain().focus().setImage({ src: dataURL, alt: '차트 스냅샷' }).run()
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 focus-within:border-indigo-500">
      <Toolbar editor={editor} onChartClick={() => setChartOpen(true)} chartAllowed={chartAllowed} />
      <EditorContent editor={editor} />
      {chartOpen && chartAllowed && (
        <Suspense fallback={null}>
          <ChartSnapshotModal
            open={chartOpen}
            onClose={() => setChartOpen(false)}
            onInsert={insertChart}
          />
        </Suspense>
      )}
    </div>
  )
}
