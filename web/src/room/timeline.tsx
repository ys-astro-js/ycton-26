import { ListTodo } from 'lucide-react'
import { useId, useState } from 'react'

import type { Agent, RoomState, Task } from '@/api/client'
import { cn } from '@/lib/utils'

import { StatusNode } from '../review/ledger.tsx'
import { DisclosurePanel, Glyph, Handoff } from '../review/shared.tsx'
import { clock, toTimeline, type TimelineEntry } from './data.ts'
import { ROW_HEAD, RowChevron, RowToggle } from './row.tsx'

/*
 * 대화 타임라인
 * 말풍선이 아니라 원장 행입니다: [시각] [작성자 / 본문]
 * 같은 작성자가 이어 말하면 작성자 줄을 생략합니다.
 * 작업 결과("할 일 #n <status>: …" system 메시지)는 접힌 결과 행으로 두고, 펼치면 요약 전문과 검증 출력이 열립니다.
 */

const ROW = 'grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 px-4 transition-colors duration-700 ease-out motion-reduce:transition-none'
const TIME = 'font-mono text-[0.8125rem] text-muted-foreground tabular-nums'

function authorKey(entry: TimelineEntry) {
  if (entry.type === 'human') return 'human'
  if (entry.type === 'agent') return `agent:${entry.agentId}`
  return null
}

export function Timeline({ state, focus }: { state: RoomState; focus?: number }) {
  const agents = new Map(state.agents.map((agent) => [agent.id, agent]))
  const tasks = new Map(state.tasks.map((task) => [task.id, task]))
  const entries = toTimeline(state)

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
            <li key={entry.message.id} {...focusProps} className={cn(ROW, 'py-1.5 data-focused:bg-muted')}>
              <time className={TIME}>{at}</time>
              <p className="flex items-start gap-1.5 text-[0.8125rem] text-muted-foreground">
                <Glyph icon={ListTodo} className="mt-0.5 size-3.5" />
                <span className="text-pretty break-words">{entry.message.content}</span>
              </p>
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
        return (
          <li key={entry.message.id} className={cn(ROW, continued ? 'pt-0.5 pb-1.5' : 'pt-3 pb-1.5')}>
            <time className={cn(TIME, 'leading-6', continued && 'sr-only')}>{at}</time>
            <div className="min-w-0">
              {continued ? null : (
                <p className="flex flex-wrap items-baseline gap-x-2 leading-6">
                  <span className="text-[0.9375rem] font-semibold">{entry.type === 'human' ? '나' : (agent?.name ?? '에이전트')}</span>
                  {agent ? <span className="text-xs text-muted-foreground">{agent.kind}</span> : null}
                </p>
              )}
              <p className="max-w-[65ch] text-[0.9375rem] whitespace-pre-line text-pretty break-words">
                <MessageText text={entry.message.content} />
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** @멘션을 굵게 구분합니다. 에이전트가 사람을 부른 것은 사람이 답할 것이므로 attention 글자색입니다. */
function MessageText({ text }: { text: string }) {
  return text.split(/(@\S+)/).map((part, index) =>
    part.startsWith('@') ? (
      <span key={index} className="font-semibold text-attention-foreground">
        {part}
      </span>
    ) : (
      part
    ),
  )
}

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
      className={cn('my-2 border-y bg-card transition-colors duration-700 ease-out data-focused:bg-muted', open && 'bg-muted/50')}
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
              <span className="font-mono text-[0.8125rem] text-muted-foreground tabular-nums">#{entry.taskId}</span>
              <span className="text-[0.9375rem] font-semibold text-pretty">
                {hasMore ? (
                  <RowToggle open={open} panelId={panelId} onToggle={() => setOpen((current) => !current)}>
                    {task?.title ?? '작업 결과'}
                  </RowToggle>
                ) : (
                  (task?.title ?? '작업 결과')
                )}
              </span>
            </p>
            {headline ? <p className="mt-0.5 max-w-[65ch] text-[0.9375rem] text-muted-foreground text-pretty">{headline}</p> : null}
            <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[0.8125rem]">
              {task ? (
                <div className="flex gap-1.5">
                  <dt className="text-muted-foreground">검증</dt>
                  <dd className="font-mono">{task.verify}</dd>
                </div>
              ) : null}
              {agent ? (
                <div className="flex gap-1.5">
                  <dt className="text-muted-foreground">맡긴 에이전트</dt>
                  <dd>{agent.name}</dd>
                </div>
              ) : null}
              {session?.commit_hash ? (
                <div className="flex gap-1.5">
                  <dt className="text-muted-foreground">커밋</dt>
                  <dd className="font-mono tabular-nums">{session.commit_hash.slice(0, 7)}</dd>
                </div>
              ) : null}
            </dl>
          </div>
          {hasMore ? <RowChevron open={open} /> : null}
        </div>
      </div>
      {hasMore ? (
        <DisclosurePanel open={open} id={panelId}>
          <div className="grid gap-6 ps-[4.75rem] pe-4 pt-1 pb-4 @min-[44rem]:grid-cols-2">
            {rest.length > 0 ? <Handoff lines={rest} /> : null}
            {session?.verification_output ? (
              <div className="min-w-0">
                <h3 className="mb-2 text-[0.8125rem] font-semibold text-muted-foreground">검증 출력</h3>
                <pre
                  className={cn(
                    'max-h-64 overflow-auto font-mono text-[0.8125rem] whitespace-pre-wrap break-all',
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
