import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { listBlocks, unblockUser } from '../api/blog'
import { useAuthStore } from '../store/auth'
import { showToast } from '../store/toast'
import { blockedName, commentErrorMessage, errorParts, TOAST_UNBLOCKED } from '../lib/commentActions'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import type { BlockOut } from '../types/api'

// 내정보 › 차단한 사용자(/me/blocks) — 목록 + [해제](확인 없이 바로 해제 후 토스트). 비로그인은 내정보(로그인 안내)로.
export default function BlockedUsersPage() {
  const uid = useAuthStore((s) => s.user?.id ?? null)
  if (uid === null) return <Navigate to="/me" replace />
  return <BlockedUsersBody key={uid} />
}

function BlockedUsersBody() {
  const [items, setItems] = useState<BlockOut[] | null>(null) // null = 불러오는 중
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState<number | null>(null) // 해제 중인 user_id
  const [attempt, setAttempt] = useState(0) // 다시 시도

  useEffect(() => {
    let alive = true
    listBlocks()
      .then((data) => {
        if (alive) setItems(data)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [attempt])

  const retry = () => {
    setFailed(false)
    setItems(null)
    setAttempt((n) => n + 1)
  }

  const handleUnblock = async (userId: number) => {
    setPending(userId)
    try {
      await unblockUser(userId)
      setItems((prev) => (prev ?? []).filter((b) => b.user_id !== userId))
      showToast(TOAST_UNBLOCKED)
    } catch (e) {
      const { status, body } = errorParts(e)
      showToast(commentErrorMessage('unblock', status, body))
    } finally {
      setPending(null)
    }
  }

  return (
    <div>
      <PageHeader title="차단한 사용자" back={{ to: '/me', label: '내정보' }} className="mb-5" />
      {failed ? (
        <div className="py-10 text-center">
          <p className="text-sm text-ink-muted">차단 목록을 불러오지 못했어요.</p>
          <Button variant="secondary" className="mt-3" onClick={retry}>
            다시 시도
          </Button>
        </div>
      ) : items === null ? (
        <p className="py-10 text-center text-ink-muted">불러오는 중…</p>
      ) : items.length === 0 ? (
        <EmptyState emoji="🙂" title="차단한 사용자가 없어요" description="댓글 ⋯ 메뉴에서 사용자를 차단할 수 있어요." />
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-muted">차단한 사용자의 댓글은 보이지 않아요.</p>
          <Card padding="none" className="overflow-hidden">
            <ul>
              {items.map((b, i) => (
                <li
                  key={b.user_id}
                  className={`flex items-center gap-3 px-5 py-3 ${i > 0 ? 'border-t border-line' : ''}`}
                >
                  <span className="min-w-0 flex-1 truncate text-ink">{blockedName(b.nickname)}</span>
                  <Button
                    variant="tertiary"
                    onClick={() => handleUnblock(b.user_id)}
                    disabled={pending !== null}
                    loading={pending === b.user_id}
                    loadingText="해제 중…"
                    aria-label={`${blockedName(b.nickname)} 차단 해제`}
                  >
                    해제
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}
