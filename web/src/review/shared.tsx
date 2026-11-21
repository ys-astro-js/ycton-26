import { Circle, CircleAlert, CircleCheck, CircleDot, CirclePause, CircleSlash, NotebookText, Terminal, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

import type { LedgerStatus, LogLine } from './model.ts'

/** 할 일 상태는 화면 어디서나 이 이름과 아이콘 하나로만 부릅니다 */
export const STATUS: Record<LedgerStatus, { label: string; icon: LucideIcon }> = {
  done: { label: '완료', icon: CircleCheck },
  running: { label: '진행 중', icon: CircleDot },
  waiting: { label: '대기', icon: Circle },
  failed: { label: '실패', icon: CircleAlert },
  held: { label: '중단됨', icon: CirclePause },
  dropped: { label: '제외', icon: CircleSlash },
}

export const countFormat = new Intl.NumberFormat('ko-KR')

/** 장식용 아이콘. 뜻은 옆의 글자나 sr-only 글자가 전합니다. */
export function Glyph({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return <Icon aria-hidden="true" strokeWidth={1.75} className={cn('size-4 shrink-0', className)} />
}

/** 측정 높이로 펼치고 접는 패널. 트리거는 호출한 쪽의 IconButton이 aria-controls로 가리킵니다. */
export function DisclosurePanel({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  return (
    <Collapsible open={open}>
      <CollapsibleContent
        id={id}
        className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-250 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none"
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function Handoff({ lines }: { lines: string[] }) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-label font-semibold text-muted-foreground">
        <Glyph icon={NotebookText} className="size-3.5" />
        인계 노트
      </h3>
      <ul className="grid max-w-[60ch] gap-1 text-body text-pretty">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  )
}

export function SessionLog({ lines }: { lines: LogLine[] }) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-label font-semibold text-muted-foreground">
        <Glyph icon={Terminal} className="size-3.5" />
        작업 변경 이력
      </h3>
      <ol className="grid gap-1 font-mono text-label tabular-nums">
        {lines.map((line) => {
          const alarming = line.alarming ?? (line.kind === 'timeout' || line.kind === 'error')
          return (
            <li
              key={`${line.at}-${line.kind}`}
              className="grid grid-cols-[auto_4.5rem_minmax(0,1fr)] gap-x-3"
            >
              <time className="text-muted-foreground">{line.at}</time>
              <span className={alarming ? 'text-attention-foreground' : 'text-muted-foreground'}>
                {line.kind}
              </span>
              <span className={cn('break-all', alarming && 'text-attention-foreground')}>{line.text}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
