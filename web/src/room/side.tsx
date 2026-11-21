import { Arc } from 'loading-dev'
import { Ban, Bot, GitCommitHorizontal, History, RotateCcw, Square } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { api, ApiError, type RoomState, type Task } from '@/api/client'
import { IconButton } from '@/components/icon-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { StatusNode } from '../review/ledger.tsx'
import { DisclosurePanel, Glyph, Handoff, STATUS, countFormat } from '../review/shared.tsx'
import { clock, lines, taskPhase, useRoomMutation, useTaskEvents, type TaskPhase } from './data.ts'
import { ROW_HEAD, RowChevron, RowToggle } from './row.tsx'

const PHASE_ORDER: Record<TaskPhase, number> = { running: 0, failed: 1, waiting: 2, done: 3, dropped: 4 }

function CountBadge({ count, unit }: { count: number; unit: string }) {
  return (
    <Badge className="min-w-6 bg-muted px-1.5 py-0.5 font-mono text-xs tracking-normal text-muted-foreground tabular-nums">
      {countFormat.format(count)}
      <span className="sr-only">{unit}</span>
    </Badge>
  )
}

export function TaskList({ state, focus }: { state: RoomState; focus?: number }) {
  const headingId = useId()
  const [openId, setOpenId] = useState<number | null>(focus ?? null)
  const tasks = [...state.tasks].sort(
    (a, b) => PHASE_ORDER[taskPhase(a, state)] - PHASE_ORDER[taskPhase(b, state)] || b.id - a.id,
  )

  // 리뷰나 할 일 추가에서 넘어온 할 일은 펼쳐서 보여 줍니다
  useEffect(() => {
    if (focus !== undefined) setOpenId(focus)
  }, [focus])

  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold">
        할 일
        <CountBadge count={state.tasks.length} unit="개" />
      </h2>
      {tasks.length === 0 ? (
        <p className="border bg-card px-4 py-4 text-[0.9375rem] text-muted-foreground">아직 할 일이 없습니다.</p>
      ) : (
        <ol className="border bg-card py-1.5">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              state={state}
              task={task}
              open={openId === task.id}
              focused={focus === task.id}
              onToggle={() => setOpenId((current) => (current === task.id ? null : task.id))}
            />
          ))}
        </ol>
      )}
    </section>
  )
}

function TaskRow({
  state,
  task,
  open,
  focused,
  onToggle,
}: {
  state: RoomState
  task: Task
  open: boolean
  focused: boolean
  onToggle: () => void
}) {
  const panelId = useId()
  const phase = taskPhase(task, state)
  const owner = state.agents.find((agent) => agent.id === task.owner_id)
  const dropped = phase === 'dropped'
  const finished = phase === 'done' || dropped
  const events = useTaskEvents(task.id, open)

  const roomId = state.room.id
  const retry = useRoomMutation(roomId, () => api.retry(task.id, '사람이 채팅방에서 다시 실행'))
  const drop = useRoomMutation(roomId, () => api.drop(task.id, '사람이 채팅방에서 제외함'))
  const cancel = useRoomMutation(roomId, () => api.cancel(task.active_session_id ?? ''))
  const error = [retry, drop, cancel].find((m) => m.error)?.error
  const busy = retry.isPending || drop.isPending || cancel.isPending

  return (
    <li
      data-focus-key={task.id}
      data-focused={focused || undefined}
      className={cn(
        'group/row relative transition-colors duration-700 ease-out motion-reduce:transition-none data-focused:bg-muted',
        open && 'bg-muted/50',
      )}
    >
      {/* 레인: 원장과 같은 방식으로 노드 사이를 잇습니다 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute start-[calc(1.625rem-1px)] top-0 h-[calc(1.625rem-0.5rem)] w-0.5 bg-border group-first/row:hidden"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute start-[calc(1.625rem-1px)] top-[calc(1.625rem+0.5rem)] bottom-0 w-0.5 bg-border group-last/row:hidden"
      />

      <div className={cn('grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-3 ps-4 pe-1 py-2', ROW_HEAD)}>
        <span className="flex h-9 items-center justify-center">
          <StatusNode status={phase} />
          <span className="sr-only">{STATUS[phase].label}</span>
        </span>
        <div className="min-w-0 py-1.5">
          <p className="flex items-baseline gap-2">
            <span className="font-mono text-[0.8125rem] whitespace-nowrap text-muted-foreground tabular-nums">#{task.id}</span>
            <span className={cn('min-w-0 text-[0.9375rem] text-pretty break-words', finished && 'text-muted-foreground')}>
              <RowToggle open={open} panelId={panelId} onToggle={onToggle} className={cn(dropped && 'line-through decoration-from-font')}>
                {task.title}
              </RowToggle>
            </span>
          </p>
          {owner ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
              <Glyph icon={Bot} className="size-3.5" />
              <span className="sr-only">담당 에이전트</span>
              {owner.name}
            </p>
          ) : null}
        </div>
        <RowChevron open={open} />
      </div>

      <DisclosurePanel open={open} id={panelId}>
        <div className="grid gap-5 ps-12 pe-4 pt-1 pb-4">
          {task.detail ? <p className="max-w-[60ch] text-[0.9375rem] whitespace-pre-line text-pretty">{task.detail}</p> : null}

          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[0.8125rem]">
            <dt className="text-muted-foreground">검증</dt>
            <dd className="font-mono">{task.verify}</dd>
            {task.scope ? (
              <>
                <dt className="text-muted-foreground">범위</dt>
                <dd className="break-words">{task.scope}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">시도</dt>
            <dd className="font-mono tabular-nums">{countFormat.format(task.attempts)}회</dd>
            {task.commit_hash ? (
              <>
                <dt className="text-muted-foreground">커밋</dt>
                <dd className="flex items-center gap-1.5 font-mono tabular-nums">
                  <Glyph icon={GitCommitHorizontal} className="size-3.5 text-muted-foreground" />
                  {task.commit_hash.slice(0, 7)}
                </dd>
              </>
            ) : null}
          </dl>

          {task.handoff ? <Handoff lines={lines(task.handoff).filter((line) => !line.startsWith('worktree='))} /> : null}

          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-[0.8125rem] font-semibold text-muted-foreground">
              <Glyph icon={History} className="size-3.5" />
              변경 이력
            </h3>
            {events.data?.length ? (
              <ol className="grid gap-1 text-[0.8125rem]">
                {events.data.map((event) => (
                  <li key={event.id} className="grid grid-cols-[3rem_4.5rem_minmax(0,1fr)] gap-x-3">
                    <time className="font-mono text-muted-foreground tabular-nums">{clock(event.created_at)}</time>
                    <span className="font-mono text-muted-foreground">{event.event}</span>
                    <span className="min-w-0 truncate">{event.detail.split('\n')[0]}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">{events.isPending ? '불러오는 중…' : '이력이 없습니다.'}</p>
            )}
          </div>

          {finished ? null : (
            <div className="grid gap-2">
              <div className="flex gap-2">
                {phase === 'running' && task.active_session_id ? (
                  <IconButton variant="outline" icon={Square} label="실행 중단하기" disabled={busy} onClick={() => cancel.mutate(undefined)} />
                ) : null}
                {phase === 'failed' ? (
                  <IconButton icon={RotateCcw} label="다시 실행" disabled={busy} onClick={() => retry.mutate(undefined)} />
                ) : null}
                {phase === 'running' ? null : (
                  <IconButton variant="ghost" icon={Ban} label="제외하기" disabled={busy} onClick={() => drop.mutate(undefined)} />
                )}
              </div>
              {error ? (
                <p role="alert" className="text-[0.8125rem] text-destructive">
                  {error instanceof ApiError ? error.message : '처리하지 못했습니다'}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </DisclosurePanel>
    </li>
  )
}

export function AgentList({ state }: { state: RoomState }) {
  const headingId = useId()
  const busy = new Set(
    state.sessions.filter((s) => s.status === 'queued' || s.status === 'running').map((s) => s.agent_id),
  )

  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold">
        에이전트
        <CountBadge count={state.agents.length} unit="명" />
      </h2>
      <div className="border bg-card">
        {state.agents.length > 0 ? (
          <ul className="divide-y">
            {state.agents.map((agent) => (
              <li key={agent.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[0.9375rem] font-semibold break-words">{agent.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{agent.kind}</span>
                  </p>
                  {agent.good_at.length > 0 ? (
                    <p className="mt-0.5 text-[0.8125rem] text-muted-foreground text-pretty">
                      <span className="sr-only">잘하는 작업: </span>
                      {agent.good_at.join(', ')}
                    </p>
                  ) : null}
                </div>
                {busy.has(agent.id) ? (
                  <span className="flex h-6 items-center">
                    <Arc size={12} color="var(--live)" />
                    <span className="sr-only">실행 중</span>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <AddAgent state={state} />
      </div>
    </section>
  )
}

function AddAgent({ state }: { state: RoomState }) {
  const empty = state.agents.length === 0
  const [open, setOpen] = useState(empty)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('')
  const [goodAt, setGoodAt] = useState('')
  const [invalid, setInvalid] = useState<{ name?: boolean; kind?: boolean }>({})
  const nameRef = useRef<HTMLInputElement>(null)
  const kindRef = useRef<HTMLInputElement>(null)
  const ids = { name: useId(), kind: useId(), goodAt: useId(), nameError: useId(), kindError: useId(), serverError: useId() }
  const add = useRoomMutation(state.room.id, (body: { name: string; kind: string; good_at: string[] }) =>
    api.addAgent(state.room.id, body),
  )

  useEffect(() => {
    if (empty) setOpen(true)
  }, [empty])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = { name: !name.trim(), kind: !kind.trim() }
    setInvalid(next)
    if (next.name) return nameRef.current?.focus()
    if (next.kind) return kindRef.current?.focus()
    add.mutate(
      {
        name: name.trim(),
        kind: kind.trim(),
        good_at: goodAt
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      },
      {
        onSuccess: () => {
          setName('')
          setKind('')
          setGoodAt('')
          setOpen(false)
        },
      },
    )
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        className={cn(
          'h-10 w-full justify-start px-4 text-[0.8125rem] font-medium tracking-normal text-muted-foreground normal-case',
          !empty && 'border-t',
        )}
        onClick={() => {
          setOpen(true)
          requestAnimationFrame(() => nameRef.current?.focus())
        }}
      >
        에이전트 추가
      </Button>
    )
  }

  const label = 'text-xs font-normal text-muted-foreground'
  return (
    <form noValidate onSubmit={submit} className={cn('grid gap-3 px-4 py-4', !empty && 'border-t')}>
      <Field data-invalid={invalid.name || undefined} className="gap-0">
        <FieldLabel htmlFor={ids.name} className={label}>
          이름
        </FieldLabel>
        <Input
          ref={nameRef}
          id={ids.name}
          value={name}
          aria-invalid={invalid.name || undefined}
          aria-describedby={invalid.name ? ids.nameError : undefined}
          onChange={(event) => {
            setName(event.target.value)
            setInvalid((current) => ({ ...current, name: false }))
          }}
        />
        {invalid.name ? <FieldError id={ids.nameError}>에이전트 이름을 입력하세요.</FieldError> : null}
      </Field>
      {/* 종류 목록을 주는 API가 없어 runtime.toml의 [kinds.*] 이름을 직접 씁니다 */}
      <Field data-invalid={invalid.kind || undefined} className="gap-0">
        <FieldLabel htmlFor={ids.kind} className={label}>
          종류
        </FieldLabel>
        <Input
          ref={kindRef}
          id={ids.kind}
          value={kind}
          className="font-mono"
          aria-invalid={invalid.kind || undefined}
          aria-describedby={invalid.kind ? ids.kindError : undefined}
          onChange={(event) => {
            setKind(event.target.value)
            setInvalid((current) => ({ ...current, kind: false }))
          }}
        />
        {invalid.kind ? <FieldError id={ids.kindError}>runtime.toml에 등록된 종류 이름을 입력하세요.</FieldError> : null}
      </Field>
      <Field className="gap-0">
        <FieldLabel htmlFor={ids.goodAt} className={label}>
          잘하는 작업
        </FieldLabel>
        <Input id={ids.goodAt} value={goodAt} onChange={(event) => setGoodAt(event.target.value)} />
      </Field>
      {add.error ? (
        <p id={ids.serverError} role="alert" className="text-[0.8125rem] text-destructive">
          {add.error instanceof ApiError ? add.error.message : '에이전트를 추가하지 못했습니다'}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={add.isPending} className="tracking-normal normal-case">
          추가
        </Button>
        {empty ? null : (
          <Button type="button" size="sm" variant="ghost" className="tracking-normal normal-case" onClick={() => setOpen(false)}>
            취소
          </Button>
        )}
      </div>
    </form>
  )
}
