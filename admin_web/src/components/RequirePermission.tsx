import type { ReactNode } from 'react'
import { hasPermission } from '../lib/permissions'
import { useMeStore } from '../store/me'
import type { AdminPermissionKey } from '../types/api'

// 권한 없는 관리자가 주소를 직접 열었을 때 — 화면 대신 안내(서버 API 도 403 으로 막는다)
export default function RequirePermission({ perms, children }: { perms: AdminPermissionKey[]; children: ReactNode }) {
  const user = useMeStore((s) => s.user)
  if (perms.length === 0 || hasPermission(user, ...perms)) return <>{children}</>
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <p className="text-3xl">🔒</p>
      <p className="mt-2 font-bold text-slate-800">이 메뉴를 쓸 권한이 없어요</p>
      <p className="mt-1 text-sm text-slate-500">필요하면 슈퍼 관리자에게 권한을 요청하세요.</p>
    </div>
  )
}
