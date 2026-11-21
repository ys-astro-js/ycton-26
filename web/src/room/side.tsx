import { Arc } from 'loading-dev'
import { Ban, Bot, Check, CircleCheck, Cpu, FolderCode, Gauge, GitCommitHorizontal, History, NotebookText, Pencil, Plus, RotateCcw, Square, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { api, ApiError, knownAgents, modelLabel, type Agent, type ModelProvider, type RoomState, type Task } from '@/api/client'
import { IconButton } from '@/components/icon-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { StatusNode } from '../review/ledger.tsx'
import { DisclosurePanel, Glyph, STATUS, countFormat } from '../review/shared.tsx'
import { clock, lines, splitRequest, taskPhase, useAgentModels, useRoomMutation, useTaskEvents, workSessions, type TaskPhase } from './data.ts'
import { Clamp } from './clamp.tsx'
import { MessageBody } from './message-body.tsx'
import { ModelPicker, type ModelChoice } from './model-picker.tsx'
import { ROW_HEAD, RowChevron, RowToggle } from './row.tsx'
import { SessionDetails } from './session-details.tsx'

/**
 * 서버의 이벤트 이름(created, claimed …)과 내부 값(agent:3, 세션 id)을 사람이 읽는 한 문장으로 바꿉니다.
 * 모르는 이벤트는 서버가 준 이름을 그대로 둡니다.
 */
function describeEvent(event: string, detail: string, state: RoomState): { what: string; detail?: string; hash?: string } {
  switch (event) {
    case 'created':
      return { what: '추가됨' }
    case 'claimed':
    case 'assigned': {
      // detail은 "agent:4" 또는 "agent:4 verify=unit"입니다. 검증 프로필은 화면에 두지 않습니다.
      const id = Number(/agent:(\d+)/.exec(detail)?.[1])
      const agent = knownAgents(state).find((candidate) => candidate.id === id)
      return { what: `${agent?.name ?? '에이전트'} 배정` }
    }
    case 'committed':
      // detail은 "<전체 해시> <커밋 제목>"입니다. 짧은 해시만 둡니다.
      return { what: '커밋', hash: detail.split(' ')[0]?.slice(0, 7) }
    case 'delegated':
      return { what: '작업 시작' }
    case 'released':
      // 에이전트를 지우면 detail이 "agent:4 삭제"로 옵니다. 내부 id 대신 이름을 씁니다.
      return {
        what: '담당 해제',
        detail: detail.replace(/agent:(\d+)/g, (raw, id) => knownAgents(state).find((a) => a.id === Number(id))?.name ?? raw),
      }
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

/** 서버가 붙이는 key=value 줄(worktree=…, exit_code=0)은 사람이 읽을 내용이 아니라 빼고 보여 줍니다 */
function readableLines(text: string) {
  return lines(text).filter((line) => !/^[a-z_]+=/.test(line))
}

const PHASE_ORDER: Record<TaskPhase, number> = { running: 0, failed: 1, held: 2, waiting: 3, done: 4, dropped: 5 }

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
  // 완료와 제외는 기본 목록에서 빼고, 버튼으로 따로 봅니다. 목록 자리는 하나라 보기를 바꿔도 머리 줄은 그대로입니다.
  const [showDone, setShowDone] = useState(false)
  const isClosed = (task: Task) => {
    const phase = taskPhase(task, state)
    return phase === 'done' || phase === 'dropped'
  }
  const tasks = state.tasks
    .filter((task) => isClosed(task) === showDone)
    .sort((a, b) => PHASE_ORDER[taskPhase(a, state)] - PHASE_ORDER[taskPhase(b, state)] || b.id - a.id)

  // 리뷰나 할 일 추가에서 넘어온 할 일은 그 할 일이 있는 목록에서 펼쳐서 보여 줍니다
  useEffect(() => {
    if (focus === undefined) return
    setOpenId(focus)
    const task = state.tasks.find((candidate) => candidate.id === focus)
    if (task) setShowDone(isClosed(task))
    // focus가 바뀔 때만 목록을 고릅니다. 상태 갱신마다 사람이 고른 보기를 바꾸지 않습니다.
  }, [focus])

  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold">
          할 일
          <CountBadge count={tasks.length} unit="개" />
        </h2>
        <div className="flex gap-2">
          <IconButton
            variant="outline"
            icon={CircleCheck}
            label="완료된 할 일 보기"
            aria-pressed={showDone}
            className="aria-pressed:bg-muted"
            onClick={() => setShowDone((current) => !current)}
          />
          <AddTask
            state={state}
            onAdded={(taskId) => {
              setShowDone(false)
              setOpenId(taskId)
            }}
          />
        </div>
      </div>
      {tasks.length === 0 ? (
        <p className="border bg-card px-4 py-4 text-body text-muted-foreground">
          {showDone ? '완료된 할 일이 없습니다.' : state.tasks.length === 0 ? '아직 할 일이 없습니다.' : '남은 할 일이 없습니다.'}
        </p>
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

function AddTask({ state, onAdded }: { state: RoomState; onAdded: (taskId: number) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const ids = { text: useId(), error: useId() }
  // 검증 프로필은 보내지 않습니다. 서버의 Jev가 담당과 함께 고릅니다.
  const add = useRoomMutation(state.room.id, ({ body }: { body: string }) => {
    const { title, detail } = splitRequest(body)
    return api.createTask(state.room.id, { title, detail })
  })

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!text.trim()) {
      setInvalid(true)
      return textRef.current?.focus()
    }
    if (add.isPending) return
    add.mutate({ body: text.trim() }, {
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
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event)
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
  description,
  confirmLabel,
  disabled,
  onConfirm,
  onCancel,
}: {
  question: string
  /** 확인하면 무엇이 어떻게 되는지. 질문만으로 결과가 분명하면 비웁니다 */
  description?: string
  confirmLabel: string
  disabled: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const questionId = useId()
  const descriptionId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  return (
    <div
      role="group"
      aria-labelledby={questionId}
      aria-describedby={description ? descriptionId : undefined}
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
      {description ? <p id={descriptionId} className="basis-full text-label text-pretty text-muted-foreground">{description}</p> : null}
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
  const owner = knownAgents(state).find((agent) => agent.id === task.owner_id)
  const dropped = phase === 'dropped'
  const finished = phase === 'done' || dropped
  const events = useTaskEvents(task.id, open)
  const handoff = readableLines(task.handoff)

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
          {phase !== 'held' ? <span className="sr-only">{STATUS[phase].label}</span> : null}
        </span>
        <div className="min-w-0 py-1.5">
          {/* 번호를 제목 버튼 안의 같은 글줄에 둡니다. 버튼은 inline이 될 수 없어(inline-block) 밖에 두면 긴 제목이 번호 다음 줄로 밀립니다. */}
          <p className={cn('text-body text-pretty break-words', finished && 'text-muted-foreground')}>
            <RowToggle open={open} panelId={panelId} onToggle={onToggle}>
              <span className="me-2 font-mono text-label whitespace-nowrap text-muted-foreground tabular-nums">#{task.id}</span>
              <span className={cn(dropped && 'line-through decoration-from-font')}>{task.title}</span>
            </RowToggle>
          </p>
          {phase === 'held' ? <p className="text-label text-muted-foreground">{STATUS.held.label}</p> : null}
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
        {/* 패널 안에 따로 스크롤을 두지 않습니다. 긴 글은 몇 줄만 보이고 펼치기로 전체를 엽니다. */}
        <div className="grid min-w-0 gap-5 ps-12 pe-4 pt-1 pb-4">
          {task.detail ? (
            <Clamp lines={3}>
              <MessageBody text={task.detail} className="max-w-[60ch] min-w-0 space-y-2 text-body text-pretty" />
            </Clamp>
          ) : null}

          {task.scope || task.commit_hash || task.attempts > 1 ? (
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-muted-foreground">
              {task.scope ? (
                <li className="flex min-w-0 items-center gap-1.5">
                  <Glyph icon={FolderCode} className="size-3.5" />
                  <span className="sr-only">범위</span>
                  <span className="min-w-0 break-all">{task.scope}</span>
                </li>
              ) : null}
              {task.commit_hash ? (
                <li className="flex items-center gap-1.5 font-mono tabular-nums">
                  <Glyph icon={GitCommitHorizontal} className="size-3.5" />
                  <span className="sr-only">커밋</span>
                  {task.commit_hash.slice(0, 7)}
                </li>
              ) : null}
              {task.attempts > 1 ? <li>{countFormat.format(task.attempts)}번째 시도</li> : null}
            </ul>
          ) : null}

          {/* 동작은 긴 기록 아래에 묻히지 않도록 내용 요약 바로 다음에 둡니다 */}
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
                  {phase === 'failed' || phase === 'held' ? (
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

          {handoff.length ? (
            <div className="min-w-0">
              <h3 className="mb-2 flex items-center gap-1.5 text-label font-semibold text-muted-foreground">
                <Glyph icon={NotebookText} className="size-3.5" />
                인계 노트
              </h3>
              {/* 줄 수 자르기(line-clamp)가 목록 안까지 닿도록 grid가 아닌 블록 흐름으로 둡니다 */}
              <Clamp lines={4}>
                <ul className="max-w-[60ch] min-w-0 space-y-1 text-body text-pretty">
                  {handoff.map((line) => (
                    <li key={line} className="min-w-0">
                      <MessageBody text={line} />
                    </li>
                  ))}
                </ul>
              </Clamp>
            </div>
          ) : null}

          <div className="min-w-0">
            <h3 className="mb-2 flex items-center gap-1.5 text-label font-semibold text-muted-foreground">
              <Glyph icon={History} className="size-3.5" />
              변경 이력
            </h3>
            {events.data?.length ? (
              <ol className="grid gap-1 text-label">
                {events.data.map((event) => {
                  const { what, detail, hash } = describeEvent(event.event, event.detail, state)
                  // 완료 기록의 내용은 위 인계 노트와 같으므로 다시 쓰지 않습니다
                  const note = detail && !(event.event === 'succeeded' && handoff.length) ? readableLines(detail).join('\n') : ''
                  return (
                    <li key={event.id} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3">
                      <time className="font-mono text-muted-foreground tabular-nums">{clock(event.created_at)}</time>
                      <div className="min-w-0 break-words">
                        <p>
                          {what}
                          {hash ? <span className="ms-2 font-mono text-muted-foreground tabular-nums">{hash}</span> : null}
                        </p>
                        {note ? (
                          <Clamp lines={2}>
                            <MessageBody text={note} className="space-y-1 text-muted-foreground" />
                          </Clamp>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <p className="text-label text-muted-foreground">{events.isPending ? '불러오는 중…' : '이력이 없습니다.'}</p>
            )}
          </div>

          {open ? <SessionDetails sessions={workSessions(state, task.id)} /> : null}
        </div>
      </DisclosurePanel>
    </li>
  )
}

export function AgentList({ state }: { state: RoomState }) {
  const headingId = useId()
  const { data: providers } = useAgentModels()
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
            <AgentForm state={state} onClose={() => setAdding(false)} />
          </PopoverContent>
        </Popover>
      </div>
      {state.agents.length === 0 ? (
        <p className="border bg-card px-4 py-4 text-body text-muted-foreground">아직 에이전트가 없습니다.</p>
      ) : (
        <ul className="border bg-card py-1.5">
          {state.agents.map((agent) => (
            <AgentRow key={agent.id} state={state} agent={agent} providers={providers} busy={busy.has(agent.id)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function AgentRow({
  state,
  agent,
  providers,
  busy,
}: {
  state: RoomState
  agent: Agent
  providers: ModelProvider[] | undefined
  busy: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const remove = useRoomMutation(state.room.id, () => api.removeAgent(agent.id))

  return (
    <li className="group/agent grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 ps-4 pe-1.5 py-1">
      <div className="min-w-0 py-1">
        <p className="text-body font-semibold break-words">{agent.name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5 break-all">
            <Glyph icon={Cpu} className="size-3.5" />
            <span className="sr-only">모델</span>
            {agent.model ? (
              <span className={cn(modelLabel(providers, agent.kind, agent.model) === agent.model && 'font-mono')}>
                {modelLabel(providers, agent.kind, agent.model)}
              </span>
            ) : (
              <span className="font-mono">{agent.kind}</span>
            )}
          </span>
          {agent.effort ? (
            <span className="flex items-center gap-1.5">
              <Glyph icon={Gauge} className="size-3.5" />
              <span className="sr-only">추론 수준</span>
              {agent.effort}
            </span>
          ) : null}
        </p>
        {agent.good_at.length > 0 ? (
          <p className="mt-0.5 text-label text-pretty text-muted-foreground">
            <span className="sr-only">담당 업무: </span>
            {agent.good_at.join(', ')}
          </p>
        ) : null}
      </div>
      <div className="flex items-center">
        {/* 실행 표시 자리는 늘 비워 두어, 실행이 시작되고 끝날 때 버튼과 이름 줄이 움직이지 않게 합니다 */}
        <span className="flex w-5 justify-center">
          {busy ? (
            <>
              <Arc size={12} color="var(--live)" />
              <span className="sr-only">실행 중</span>
            </>
          ) : null}
        </span>
        {/* 편집과 삭제는 행에 마우스를 올리거나 행 안에 초점이 있을 때만 보입니다. 자리는 그대로 두고 투명도만 바꿔 행이 움직이지 않게 합니다.
            호버가 없는 터치 기기와 양식이 열려 있는 동안은 늘 보입니다. */}
        <div
          data-open={editing || removing || undefined}
          className="flex opacity-0 transition-opacity duration-150 group-focus-within/agent:opacity-100 group-hover/agent:opacity-100 data-open:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
        >
          <Popover open={editing} onOpenChange={setEditing}>
            <PopoverTrigger render={<IconButton variant="ghost" icon={Pencil} label="에이전트 편집" />} />
            <PopoverContent side="bottom" align="end" className="w-80">
              <AgentForm state={state} agent={agent} onClose={() => setEditing(false)} />
            </PopoverContent>
          </Popover>
          <Popover
            open={removing}
            onOpenChange={(next) => {
              setRemoving(next)
              if (!next) remove.reset()
            }}
          >
            <PopoverTrigger render={<IconButton variant="ghost" icon={Trash2} label="에이전트 삭제" />} />
            <PopoverContent side="bottom" align="end" className="w-80 gap-3">
              <InlineConfirm
                question={`${agent.name} 에이전트를 삭제할까요?`}
                description="기록은 남고, 맡은 할 일은 다시 배정됩니다."
                confirmLabel="삭제"
                disabled={remove.isPending}
                onConfirm={() => remove.mutate(undefined, { onSuccess: () => setRemoving(false) })}
                onCancel={() => setRemoving(false)}
              />
              {remove.error ? (
                <p role="alert" className="text-label text-destructive">
                  {remove.error instanceof ApiError ? remove.error.message : '에이전트를 삭제하지 못했습니다. 잠시 후 다시 시도하세요.'}
                </p>
              ) : null}
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </li>
  )
}

type AgentBody = { name: string; kind: string; model: string; effort: string; good_at: string[] }

/** 서버의 모델 목록에 있는 조합인지 봅니다. 목록에서 빠진 모델로 만든 에이전트를 편집할 때 다시 고르게 합니다 */
function offered(providers: ModelProvider[] | undefined, choice: ModelChoice) {
  const provider = providers?.find((p) => p.id === choice.provider)
  if (!provider) return !providers
  const model = provider.models.length === 0 ? choice.model === '' : provider.models.includes(choice.model)
  const effort = provider.efforts.length === 0 ? choice.effort === '' : provider.efforts.includes(choice.effort)
  return model && effort
}

/** 에이전트 추가와 편집이 함께 쓰는 양식입니다. agent를 넘기면 그 값으로 채우고 저장합니다 */
function AgentForm({ state, agent, onClose }: { state: RoomState; agent?: Agent; onClose: () => void }) {
  const providers = useAgentModels()
  const [choice, setChoice] = useState<ModelChoice | null>(
    agent ? { provider: agent.kind, model: agent.model, effort: agent.effort } : null,
  )
  const [duty, setDuty] = useState(agent?.good_at.join(', ') ?? '')
  const [name, setName] = useState(agent?.name ?? '')
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
  const save = useRoomMutation(state.room.id, (body: AgentBody) =>
    agent ? api.updateAgent(agent.id, body) : api.addAgent(state.room.id, body),
  )
  const action = agent ? '에이전트 편집' : '에이전트 추가'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = { model: !choice || !offered(providers.data, choice), name: !name.trim() }
    setInvalid(next)
    if (next.model) return document.getElementById(ids.model)?.focus()
    if (next.name || !choice) return nameRef.current?.focus()
    save.mutate(
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
    <form noValidate aria-label={action} onSubmit={submit} className="grid gap-3">
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
          <IconButton type="submit" icon={Check} label={agent ? '저장' : '에이전트 추가'} disabled={save.isPending} />
        </div>
        {invalid.name ? <FieldError id={ids.nameError}>에이전트 이름을 입력하세요.</FieldError> : null}
      </Field>
      {save.error ? (
        <p id={ids.serverError} role="alert" className="text-label text-destructive">
          {save.error instanceof ApiError
            ? save.error.message
            : agent
              ? '에이전트를 저장하지 못했습니다.'
              : '에이전트를 추가하지 못했습니다.'}{' '}
          잠시 후 다시 시도하세요.
        </p>
      ) : null}
    </form>
  )
}
