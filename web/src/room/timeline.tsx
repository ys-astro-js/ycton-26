import { Bot, GitCommitHorizontal } from 'lucide-react'
import { useId, useState } from 'react'

import type { Agent, RoomState, Task } from '@/api/client'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent, MessageFooter, MessageHeader } from '@/components/ui/message'
import { cn } from '@/lib/utils'

import { StatusNode } from '../review/ledger.tsx'
import { DisclosurePanel, Glyph, Handoff } from '../review/shared.tsx'
import { clock, toTimeline, type TimelineEntry } from './data.ts'
import { MessageBody } from './message-body.tsx'
import { ROW_HEAD, RowChevron, RowToggle } from './row.tsx'

/*
 * 대화 타임라인
 * 사람과 에이전트의 말은 shadcn Message·Bubble 말풍선입니다. 사람은 오른쪽, 에이전트는 왼쪽에 섭니다.
 * 사람의 말풍선은 테두리만 두어, 처리할 일(빨강)보다 무겁게 보이지 않게 합니다.
 * 같은 작성자가 이어 말하면 이름은 첫 말풍선에만, 시각은 마지막 말풍선 아래에만 씁니다.
 * 실행 실패 같은 시스템 알림은 말풍선이 아니라 [시각] [내용] 행으로 둡니다.
 * 작업 결과("할 일 #n <status>: …" system 메시지)는 접힌 결과 행으로 두고, 펼치면 요약 전문과 검증 출력이 열립니다.
 */

const ROW = 'grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 px-4 transition-colors duration-700 ease-out motion-reduce:transition-none'
const TIME = 'font-mono text-label text-muted-foreground tabular-nums'

function authorKey(entry: TimelineEntry) {
  if (entry.type === 'human') return 'human'
  if (entry.type === 'agent') return `agent:${entry.agentId}`
  return null
}

export function Timeline({ state, focus }: { state: RoomState; focus?: number }) {
  const agents = new Map(state.agents.map((agent) => [agent.id, agent]))
  const tasks = new Map(state.tasks.map((task) => [task.id, task]))
  const entries = toTimeline(state)
  // 에이전트가 다른 에이전트를 부른 것(@Claude)은 사람이 처리할 일이 아니라 attention 색을 쓰지 않습니다
  const agentNames = new Set(state.agents.map((agent) => agent.name))
  const callsPerson = (name: string) => !agentNames.has(name)

  return (
    <ol aria-label="대화" className="grid pb-2">
      {entries.map((entry, index) => {
        const previous = entries[index - 1]
        const key = authorKey(entry)
        const continued = previous !== undefined && key !== null && authorKey(previous) === key
        const taskId = entry.type === 'system' || entry.type === 'result' ? entry.taskId : undefined
        const focusProps = {
          'data-focus-key': taskId,
          'data-focused': (focus !== undefined && taskId === focus) || undefined,
        }
        const at = clock(entry.message.created_at)

        if (entry.type === 'system') {
          return (
            <li key={entry.message.id} {...focusProps} className={cn(ROW, 'py-1.5 data-focused:bg-muted/50')}>
              <time className={TIME}>{at}</time>
              <p className="text-label text-pretty break-words text-muted-foreground">{entry.message.content}</p>
            </li>
          )
        }

        if (entry.type === 'result') {
          return (
            <ResultRow
              key={entry.message.id}
              entry={entry}
              at={at}
              task={tasks.get(entry.taskId)}
              agent={entry.session ? agents.get(entry.session.agent_id) : undefined}
              focusProps={focusProps}
            />
          )
        }

        const agent = entry.type === 'agent' ? agents.get(entry.agentId) : undefined
        const human = entry.type === 'human'
        const next = entries[index + 1]
        const last = next === undefined || authorKey(next) !== key
        const named = !human && !continued
        return (
          <li key={entry.message.id} className={cn('px-4', continued ? 'pt-1' : 'pt-4')}>
            <Message align={human ? 'end' : 'start'}>
              <MessageContent className="gap-1">
                {named ? (
                  <MessageHeader className="text-label">
                    <span className="font-semibold text-foreground">{agent?.name ?? '에이전트'}</span>
                  </MessageHeader>
                ) : null}
                <Bubble variant={human ? 'outline' : 'muted'}>
                  <BubbleContent className="text-body">
                    {/* 이어 보낸 말풍선에도 화면 읽기 프로그램이 누가 말했는지 알 수 있게 작성자를 붙입니다 */}
                    {human ? (
                      <span className="sr-only">나: </span>
                    ) : !named ? (
                      <span className="sr-only">{agent?.name ?? '에이전트'}: </span>
                    ) : null}
                    <MessageBody text={entry.message.content} attention={human ? never : callsPerson} />
                  </BubbleContent>
                </Bubble>
                <MessageFooter className={cn(!last && 'sr-only')}>
                  <time className={TIME}>{at}</time>
                </MessageFooter>
              </MessageContent>
            </Message>
          </li>
        )
      })}
    </ol>
  )
}

const never = () => false

const OUTCOME = {
  succeeded: { label: '성공', alarming: false },
  failed: { label: '실패', alarming: true },
  cancelled: { label: '취소됨', alarming: true },
} as const

function ResultRow({
  entry,
  at,
  task,
  agent,
  focusProps,
}: {
  entry: Extract<TimelineEntry, { type: 'result' }>
  at: string
  task?: Task
  agent?: Agent
  focusProps: Record<string, unknown>
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const outcome = OUTCOME[entry.outcome]
  const session = entry.session
  const [headline, ...rest] = entry.summary
  const hasMore = rest.length > 0 || Boolean(session?.verification_output)

  return (
    <li
      {...focusProps}
      className={cn('my-2 border-y bg-card transition-colors duration-700 ease-out motion-reduce:transition-none data-focused:bg-muted/50', open && 'bg-muted/50')}
    >
      <div className={cn(ROW, 'items-start py-2.5 pe-1', hasMore && ROW_HEAD)}>
        <time className={cn(TIME, 'leading-9')}>{at}</time>
        <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-2.5">
          <span className="flex h-9 items-center">
            <StatusNode status={outcome.alarming ? 'failed' : 'done'} />
            <span className="sr-only">작업 {outcome.label}</span>
          </span>
          <div className="min-w-0 py-1.5">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-label text-muted-foreground tabular-nums">#{entry.taskId}</span>
              <span className="text-body font-semibold text-pretty">
                {hasMore ? (
                  <RowToggle open={open} panelId={panelId} onToggle={() => setOpen((current) => !current)}>
                    {task?.title ?? '작업 결과'}
                  </RowToggle>
                ) : (
                  (task?.title ?? '작업 결과')
                )}
              </span>
            </p>
            {headline ? <p className="mt-0.5 max-w-[65ch] text-body text-muted-foreground text-pretty">{headline}</p> : null}
            {agent || session?.commit_hash ? (
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-muted-foreground">
                {agent ? (
                  <span className="flex items-center gap-1.5">
                    <Glyph icon={Bot} className="size-3.5" />
                    <span className="sr-only">담당 에이전트</span>
                    {agent.name}
                  </span>
                ) : null}
                {session?.commit_hash ? (
                  <span className="flex items-center gap-1.5 font-mono tabular-nums">
                    <Glyph icon={GitCommitHorizontal} className="size-3.5" />
                    <span className="sr-only">커밋</span>
                    {session.commit_hash.slice(0, 7)}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
          {hasMore ? <RowChevron open={open} /> : null}
        </div>
      </div>
      {hasMore ? (
        <DisclosurePanel open={open} id={panelId}>
          <div className="grid gap-6 ps-4 @min-[28rem]:ps-[4.75rem] pe-4 pt-1 pb-4 @min-[44rem]:grid-cols-2">
            {rest.length > 0 ? <Handoff lines={rest} /> : null}
            {session?.verification_output ? (
              <div className="min-w-0">
                <h3 className="mb-2 text-label font-semibold text-muted-foreground">검증 출력</h3>
                <pre
                  className={cn(
                    'max-h-64 overflow-auto font-mono text-label whitespace-pre-wrap break-all',
                    outcome.alarming && 'text-attention-foreground',
                  )}
                >
                  {session.verification_output}
                </pre>
              </div>
            ) : null}
          </div>
        </DisclosurePanel>
      ) : null}
    </li>
  )
}
