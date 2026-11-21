import { Arc } from 'loading-dev'
import { Ban, Bot, Check, FolderCode, GitCommitHorizontal, History, Plus, RotateCcw, Square } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { api, ApiError, type RoomState, type Task } from '@/api/client'
import { IconButton } from '@/components/icon-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { StatusNode } from '../review/ledger.tsx'
import { DisclosurePanel, Glyph, Handoff, STATUS, countFormat } from '../review/shared.tsx'
import { clock, lines, splitRequest, taskPhase, useAgentModels, useRoomMutation, useTaskEvents, type TaskPhase } from './data.ts'
import { ModelPicker, type ModelChoice } from './model-picker.tsx'
import { ROW_HEAD, RowChevron, RowToggle } from './row.tsx'

/**
 * 서버의 이벤트 이름(created, claimed …)과 내부 값(agent:3, 세션 id)을 사람이 읽는 한 문장으로 바꿉니다.
 * 모르는 이벤트는 서버가 준 이름을 그대로 둡니다.
 */
function describeEvent(event: string, detail: string, state: RoomState): { what: string; detail?: string } {
  switch (event) {
    case 'created':
      return { what: '추가됨' }
    case 'claimed': {
      const id = Number(detail.replace('agent:', ''))
      const agent = state.agents.find((candidate) => candidate.id === id)
      return { what: `${agent?.name ?? '에이전트'} 배정` }
    }
    case 'delegated':
      return { what: '작업 시작' }
    case 'released':
      return { what: '담당 해제', detail }
    case 'succeeded':
      return { what: '완료', detail }
    case 'failed':
      return { what: '실패', detail }
    case 'cancelled':
      return { what: '중단됨', detail }
    case 'timeout':
      return { what: '시간 초과', detail }
    case 'retry':
      return { what: '다시 실행' }
    case 'drop':
      return { what: '제외됨' }
    case 'chat_failed_release':
      return { what: '대화가 실패해 담당 해제', detail }
    case 'recovered':
      return { what: '서버 재시작 뒤 다시 열림' }
    default:
      return { what: event, detail }
  }
}

const PHASE_ORDER: Record<TaskPhase, number> = { running: 0, failed: 1, waiting: 2, done: 3, dropped: 4 }

function CountBadge({ count, unit }: { count: number; unit: string }) {
  return (
    <Badge className="min-w-6 px-1.5 py-0.5 font-mono text-xs tracking-normal text-muted-foreground tabular-nums">
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
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold">
          할 일
          <CountBadge count={state.tasks.length} unit="개" />
        </h2>
        <AddTask state={state} onAdded={setOpenId} />
      </div>
      {tasks.length === 0 ? (
        <p className="border bg-card px-4 py-4 text-body text-muted-foreground">아직 할 일이 없습니다.</p>
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

/**
 * 할 일마다 서버에 등록된 검증 프로필 이름을 보내야 합니다.
 * 사람이 고를 일이 아니고 목록을 주는 API도 없어, runtime.example.toml의 [verify.unit]을 늘 씁니다.
 */
const VERIFY_PROFILE = 'unit'

function AddTask({ state, onAdded }: { state: RoomState; onAdded: (taskId: number) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const ids = { text: useId(), error: useId() }
  const add = useRoomMutation(state.room.id, (body: string) => {
    const { title, detail } = splitRequest(body)
    return api.createTask(state.room.id, { title, detail, scope: '', verify: VERIFY_PROFILE })
  })

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!text.trim()) {
      setInvalid(true)
      return textRef.current?.focus()
    }
    add.mutate(text.trim(), {
      onSuccess: (task) => {
        setText('')
        setOpen(false)
        onAdded(task.id)
      },
    })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setInvalid(false)
      }}
    >
      <PopoverTrigger render={<IconButton variant="outline" icon={Plus} label="할 일 추가" />} />
      <PopoverContent side="bottom" align="end" initialFocus={textRef} className="w-80">
        <form noValidate aria-label="할 일 추가" onSubmit={submit} className="grid gap-3">
          <Field data-invalid={invalid || undefined} className="gap-0">
            <FieldLabel htmlFor={ids.text} className="text-label font-medium">
              할 일
            </FieldLabel>
            <div className="flex items-end gap-2">
              <Textarea
                ref={textRef}
                id={ids.text}
                value={text}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? ids.error : undefined}
                className="max-h-64 min-h-20"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
                }}
                onChange={(event) => {
                  setText(event.target.value)
                  if (invalid) setInvalid(false)
                }}
              />
              <IconButton type="submit" icon={Check} label="할 일 추가" disabled={add.isPending} />
            </div>
            {invalid ? <FieldError id={ids.error}>할 일을 입력하세요.</FieldError> : null}
          </Field>
          {add.error ? (
            <p role="alert" className="text-label text-destructive">
              {add.error instanceof ApiError ? add.error.message : '할 일을 추가하지 못했습니다.'} 잠시 후 다시 시도하세요.
            </p>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  )
}

/** 되돌릴 수 없는 동작을 그 자리에서 한 번 더 묻습니다. 열리면 취소에 초점을 두고, Escape로 닫습니다. */
function InlineConfirm({
  question,
  confirmLabel,
  disabled,
  onConfirm,
  onCancel,
}: {
  question: string
  confirmLabel: string
  disabled: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const questionId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  return (
    <div
      role="group"
      aria-labelledby={questionId}
      className="flex flex-wrap items-center gap-x-3 gap-y-2"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onCancel()
        }
      }}
    >
      <p id={questionId} className="text-body">
        {question}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" className="tracking-normal normal-case" disabled={disabled} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button ref={cancelRef} size="sm" variant="outline" className="tracking-normal normal-case" onClick={onCancel}>
          취소
        </Button>
      </div>
    </div>
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
  const retry = useRoomMutation(roomId, () => api.retry(task.id, '사람이 프로젝트에서 다시 실행'))
  const drop = useRoomMutation(roomId, () => api.drop(task.id, '사람이 프로젝트에서 제외함'))
  const cancel = useRoomMutation(roomId, () => api.cancel(task.active_session_id ?? ''))
  const error = [retry, drop, cancel].find((m) => m.error)?.error
  const busy = retry.isPending || drop.isPending || cancel.isPending
  const [confirming, setConfirming] = useState<'drop' | 'cancel' | null>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const closeConfirm = () => {
    setConfirming(null)
    // 확인을 닫으면 초점을 동작 버튼 줄로 되돌립니다
    requestAnimationFrame(() => actionsRef.current?.querySelector('button')?.focus())
  }

  return (
    <li
      data-focus-key={task.id}
      data-focused={focused || undefined}
      className={cn(
        'group/row relative transition-colors duration-700 ease-out motion-reduce:transition-none data-focused:bg-muted/50',
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
            <span className="font-mono text-label whitespace-nowrap text-muted-foreground tabular-nums">#{task.id}</span>
            <span className={cn('min-w-0 text-body text-pretty break-words', finished && 'text-muted-foreground')}>
              <RowToggle open={open} panelId={panelId} onToggle={onToggle} className={cn(dropped && 'line-through decoration-from-font')}>
                {task.title}
              </RowToggle>
            </span>
          </p>
          {owner ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-label text-muted-foreground">
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
          {task.detail ? <p className="max-w-[60ch] text-body whitespace-pre-line text-pretty">{task.detail}</p> : null}

          {task.scope || task.commit_hash || task.attempts > 1 ? (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-muted-foreground">
              {task.scope ? (
                <span className="flex min-w-0 items-center gap-1.5 break-words">
                  <Glyph icon={FolderCode} className="size-3.5" />
                  <span className="sr-only">범위</span>
                  {task.scope}
                </span>
              ) : null}
              {task.commit_hash ? (
                <span className="flex items-center gap-1.5 font-mono tabular-nums">
                  <Glyph icon={GitCommitHorizontal} className="size-3.5" />
                  <span className="sr-only">커밋</span>
                  {task.commit_hash.slice(0, 7)}
                </span>
              ) : null}
              {task.attempts > 1 ? <span>{countFormat.format(task.attempts)}번째 시도</span> : null}
            </p>
          ) : null}

          {task.handoff ? <Handoff lines={lines(task.handoff).filter((line) => !line.startsWith('worktree='))} /> : null}

          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-label font-semibold text-muted-foreground">
              <Glyph icon={History} className="size-3.5" />
              변경 이력
            </h3>
            {events.data?.length ? (
              <ol className="grid gap-1 text-label">
                {events.data.map((event) => {
                  const { what, detail } = describeEvent(event.event, event.detail, state)
                  return (
                    <li key={event.id} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3">
                      <time className="font-mono text-muted-foreground tabular-nums">{clock(event.created_at)}</time>
                      <p className="min-w-0 break-words whitespace-pre-line">
                        {what}
                        {detail ? <span className="text-muted-foreground">: {detail}</span> : null}
                      </p>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <p className="text-label text-muted-foreground">{events.isPending ? '불러오는 중…' : '이력이 없습니다.'}</p>
            )}
          </div>

          {finished ? null : (
            <div className="grid gap-2">
              {confirming ? (
                <InlineConfirm
                  question={confirming === 'drop' ? '이 할 일을 제외할까요?' : '실행을 중단할까요?'}
                  confirmLabel={confirming === 'drop' ? '제외' : '중단'}
                  disabled={busy}
                  onConfirm={() => {
                    const mutation = confirming === 'drop' ? drop : cancel
                    mutation.mutate(undefined, { onSettled: () => setConfirming(null) })
                  }}
                  onCancel={closeConfirm}
                />
              ) : (
                <div ref={actionsRef} className="flex gap-2">
                  {phase === 'running' && task.active_session_id ? (
                    <IconButton variant="outline" icon={Square} label="실행 중단하기" disabled={busy} onClick={() => setConfirming('cancel')} />
                  ) : null}
                  {phase === 'failed' ? (
                    <IconButton icon={RotateCcw} label="다시 실행" disabled={busy} onClick={() => retry.mutate(undefined)} />
                  ) : null}
                  {phase === 'running' ? null : (
                    <IconButton variant="outline" icon={Ban} label="제외하기" disabled={busy} onClick={() => setConfirming('drop')} />
                  )}
                </div>
              )}
              {error ? (
                <p role="alert" className="text-label text-destructive">
                  {error instanceof ApiError ? error.message : '처리하지 못했습니다.'} 잠시 후 다시 시도하세요.
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
  const [adding, setAdding] = useState(false)
  const busy = new Set(
    state.sessions.filter((s) => s.status === 'queued' || s.status === 'running').map((s) => s.agent_id),
  )

  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold">
          에이전트
          <CountBadge count={state.agents.length} unit="명" />
        </h2>
        <Popover open={adding} onOpenChange={setAdding}>
          <PopoverTrigger render={<IconButton variant="outline" icon={Plus} label="에이전트 추가" />} />
          <PopoverContent side="bottom" align="end" className="w-80">
            <AddAgent state={state} onClose={() => setAdding(false)} />
          </PopoverContent>
        </Popover>
      </div>
      {state.agents.length === 0 ? (
        <p className="border bg-card px-4 py-4 text-body text-muted-foreground">아직 에이전트가 없습니다.</p>
      ) : (
        <ul className="border bg-card py-1.5">
          {state.agents.map((agent) => (
            <li key={agent.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-2">
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-body font-semibold break-words">{agent.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {[agent.model || agent.kind, agent.effort].filter(Boolean).join(' · ')}
                  </span>
                </p>
                {agent.good_at.length > 0 ? (
                  <p className="mt-0.5 text-label text-pretty text-muted-foreground">
                    <span className="sr-only">담당 업무: </span>
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
      )}
    </section>
  )
}

function AddAgent({ state, onClose }: { state: RoomState; onClose: () => void }) {
  const providers = useAgentModels()
  const [choice, setChoice] = useState<ModelChoice | null>(null)
  const [duty, setDuty] = useState('')
  const [name, setName] = useState('')
  const [invalid, setInvalid] = useState<{ name?: boolean; model?: boolean }>({})
  const nameRef = useRef<HTMLInputElement>(null)
  const ids = {
    model: useId(),
    modelError: useId(),
    modelsError: useId(),
    duty: useId(),
    name: useId(),
    nameError: useId(),
    serverError: useId(),
  }
  const add = useRoomMutation(
    state.room.id,
    (body: { name: string; kind: string; model: string; effort: string; good_at: string[] }) => api.addAgent(state.room.id, body),
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = { model: !choice, name: !name.trim() }
    setInvalid(next)
    if (next.model) return document.getElementById(ids.model)?.focus()
    if (next.name || !choice) return nameRef.current?.focus()
    add.mutate(
      {
        name: name.trim(),
        kind: choice.provider,
        model: choice.model,
        effort: choice.effort,
        good_at: duty
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      },
      { onSuccess: onClose },
    )
  }

  const label = 'text-label font-medium'
  return (
    <form noValidate aria-label="에이전트 추가" onSubmit={submit} className="grid gap-3">
      <Field data-invalid={invalid.model || undefined} className="gap-0">
        <FieldLabel htmlFor={ids.model} className={label}>
          모델
        </FieldLabel>
        <ModelPicker
          id={ids.model}
          providers={providers.data ?? []}
          value={choice}
          disabled={!providers.data}
          invalid={invalid.model}
          describedBy={cn(invalid.model && ids.modelError, providers.error && ids.modelsError) || undefined}
          onChange={(next) => {
            setChoice(next)
            setInvalid((current) => ({ ...current, model: false }))
          }}
        />
        {invalid.model ? <FieldError id={ids.modelError}>모델을 선택하세요.</FieldError> : null}
        {providers.error ? (
          <p id={ids.modelsError} role="alert" className="mt-1 text-label text-destructive">
            모델 목록을 불러오지 못했습니다.
          </p>
        ) : null}
      </Field>
      <Field className="gap-0">
        <FieldLabel htmlFor={ids.duty} className={label}>
          담당 업무
        </FieldLabel>
        <Input id={ids.duty} value={duty} onChange={(event) => setDuty(event.target.value)} />
      </Field>
      <Field data-invalid={invalid.name || undefined} className="gap-0">
        <FieldLabel htmlFor={ids.name} className={label}>
          이름
        </FieldLabel>
        <div className="flex items-center gap-2">
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
          <IconButton type="submit" icon={Check} label="에이전트 추가" disabled={add.isPending} />
        </div>
        {invalid.name ? <FieldError id={ids.nameError}>에이전트 이름을 입력하세요.</FieldError> : null}
      </Field>
      {add.error ? (
        <p id={ids.serverError} role="alert" className="text-label text-destructive">
          {add.error instanceof ApiError ? add.error.message : '에이전트를 추가하지 못했습니다.'} 잠시 후 다시 시도하세요.
        </p>
      ) : null}
    </form>
  )
}
