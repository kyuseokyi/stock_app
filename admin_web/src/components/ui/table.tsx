import * as React from 'react'
import { cn } from '@/lib/utils'

// 표 — 좁은 화면은 가로 스크롤. 숫자 칸은 numeric(오른쪽 정렬·tabular-nums)
export const Table = ({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) => (
  <div className="w-full overflow-x-auto"><table className={cn('w-full caption-bottom text-sm', className)} {...p} /></div>
)
export const TableHeader = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className={cn('[&_tr]:border-b [&_tr]:border-line', className)} {...p} />
export const TableBody = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody className={cn('[&_tr:last-child]:border-0', className)} {...p} />
export const TableRow = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={cn('border-b border-line transition-colors hover:bg-fill/50 data-[state=selected]:bg-brand-soft', className)} {...p} />
export const TableHead = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className={cn('h-10 px-3 text-left align-middle text-xs font-semibold text-ink-muted', className)} {...p} />
export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> { numeric?: boolean }
export const TableCell = ({ className, numeric = false, ...p }: TableCellProps) => (
  <td className={cn('px-3 py-2 align-middle text-ink', numeric && 'text-right tabular-nums', className)} {...p} />
)
export const TableCaption = ({ className, ...p }: React.HTMLAttributes<HTMLTableCaptionElement>) => <caption className={cn('mt-3 text-xs text-ink-muted', className)} {...p} />
