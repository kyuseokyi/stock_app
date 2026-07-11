import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'

// 툴바 버튼 공통 스타일
const btn = (active) =>
  `rounded px-2 py-1 text-sm font-medium transition ${
    active ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`

function Toolbar({ editor }) {
  if (!editor) return null

  const addLink = () => {
    const prev = editor.getAttributes('link').href
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

export default function RichTextEditor({ value, onChange }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class:
          'prose max-w-none min-h-[280px] px-3 py-2 focus:outline-none text-sm',
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

  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 focus-within:border-indigo-500">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}
