import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * DESIGN.md의 Disclosure Row: 별도 펼침 버튼 없이 행 머리 전체가 클릭 영역입니다.
 * 실체는 제목 글자만 담은 native button이고, ::after로 클릭 영역을 행 전체로 넓힙니다.
 */

export const ROW_HEAD =
  'relative cursor-pointer transition-colors hover:bg-muted/40 motion-reduce:transition-none ' +
  'has-[[data-row-toggle]:focus-visible]:outline-2 has-[[data-row-toggle]:focus-visible]:-outline-offset-2 has-[[data-row-toggle]:focus-visible]:outline-foreground'

export function RowToggle({
  open,
  panelId,
  onToggle,
  className,
  children,
}: {
  open: boolean
  panelId: string
  onToggle: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      data-row-toggle=""
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
      className={cn('cursor-pointer text-start outline-none after:absolute after:inset-0', className)}
    >
      {children}
    </button>
  )
}

/** 펼침 단서. 버튼이 아니며, 눌러도 행의 펼침 버튼으로 전달됩니다. */
export function RowChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('pointer-events-none flex size-9 items-center justify-center', className)}>
      <ChevronDown
        strokeWidth={1.75}
        className={cn(
          'size-4 text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none',
          open && 'rotate-180',
        )}
      />
    </span>
  )
}
