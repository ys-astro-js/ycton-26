import { Link } from '@tanstack/react-router'
import {
  Bot,
  ChevronDown,
  CircleCheck,
  CirclePause,
  FolderGit2,
  ListTodo,
  MessageCircleQuestionMark,
  OctagonPause,
  Play,
  Reply,
  RotateCcw,
  Send,
  TimerOff,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { IconButton } from '@/components/icon-button'
import { Badge } from '@/components/ui/badge'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { DisclosurePanel, Glyph, Handoff, SessionLog, countFormat } from './shared.tsx'
import type { AttentionItem, AttentionKind, Project } from './model.ts'

export type Resolution = 'resumed' | 'reassigned' | 'answered'

const RESOLUTION_LABEL: Record<Resolution, string> = {
  resumed: '재개함',
  reassigned: '다시 실행함',
  answered: '답함',
}

const KIND: Record<AttentionKind, { icon: LucideIcon; label: string }> = {
  'jev-stop': { icon: OctagonPause, label: '멈춤' },
  timeout: { icon: TimerOff, label: '시간 초과' },
  failed: { icon: TriangleAlert, label: '실패' },
  held: { icon: CirclePause, label: '중단됨' },
  question: { icon: MessageCircleQuestionMark, label: '질문' },
}

interface AttentionSectionProps {
  items: AttentionItem[]
  projects: Project[]
  /** 백엔드에 처리를 보냅니다. 실패하면 오류를 던집니다. */
  onAction: (item: AttentionItem, resolution: Resolution, text?: string) => Promise<void>
  /** 되돌릴 수 있는 처리(재개)만 되돌립니다. */
  onUndo: (item: AttentionItem, resolution: Resolution) => Promise<void>
}

const UNDOABLE: Resolution[] = ['resumed']

export function AttentionSection({ items, projects, onAction, onUndo }: AttentionSectionProps) {
  const headingId = useId()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  // 처리한 항목은 서버 목록에서 빠져도 이 화면에서는 남겨 두어 결과와 되돌리기를 보여 줍니다
  const [kept, setKept] = useState<Record<string, AttentionItem>>({})
  const [replying, setReplying] = useState<string | null>(null)
  const [resolved, setResolved] = useState<Record<string, Resolution>>({})
  const [announcement, setAnnouncement] = useState('')

  const shown = [...items, ...Object.values(kept).filter((item) => !items.some((current) => current.id === item.id))]
  const openCount = shown.filter((item) => !resolved[item.id]).length
  const allClear = openCount === 0

  // 마지막 항목을 처리해 0이 된 순간에만 체크를 그립니다. 처음 들어왔을 때 이미 0이면 움직이지 않습니다.
  const hadOpen = useRef(openCount > 0)
  const [justCleared, setJustCleared] = useState(false)
  useEffect(() => {
    if (hadOpen.current && openCount === 0) setJustCleared(true)
    hadOpen.current = openCount > 0
  }, [openCount])

  const toggle = (id: string) => {
    setExpanded((current) => (current === id ? null : id))
    setReplying(null)
  }

  const reply = (id: string) => {
    if (expanded === id && replying === id) {
      setExpanded(null)
      setReplying(null)
      return
    }
    setExpanded(id)
    setReplying(id)
  }

  const resolve = async (item: AttentionItem, resolution: Resolution, text?: string) => {
    setPending(item.id)
    try {
      await onAction(item, resolution, text)
      setKept((current) => ({ ...current, [item.id]: item }))
      setResolved((current) => ({ ...current, [item.id]: resolution }))
      setExpanded((current) => (current === item.id ? null : current))
      setReplying(null)
      setAnnouncement(`${item.title}: ${RESOLUTION_LABEL[resolution]}`)
    } catch (error) {
      setAnnouncement(`${item.title}: ${error instanceof Error ? error.message : '처리하지 못했습니다'}. 다시 시도하세요.`)
    } finally {
      setPending(null)
    }
  }

  const undo = async (item: AttentionItem) => {
    const resolution = resolved[item.id]
    if (!resolution) return
    setPending(item.id)
    try {
      await onUndo(item, resolution)
      setResolved((current) => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
      setAnnouncement(`${item.title}: 되돌림`)
    } catch (error) {
      setAnnouncement(`${item.title}: ${error instanceof Error ? error.message : '되돌리지 못했습니다'}. 다시 시도하세요.`)
    } finally {
      setPending(null)
    }
  }

  return (
    <section aria-labelledby={headingId} className="grid gap-3 text-body">
      {allClear ? (
        // 처리할 일이 없으면 제목과 개수 대신 이 사실 하나를 구역의 제목으로 세웁니다
        <div className="flex items-center gap-4 border bg-card px-5 py-7">
          <AllClearMark draw={justCleared} />
          <h2 id={headingId} className="text-lg font-semibold tracking-tight">
            처리할 일이 없습니다
          </h2>
        </div>
      ) : (
        <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold">
          처리할 일
          <Badge className="min-w-6 bg-attention px-1.5 py-0.5 font-mono text-xs tracking-normal text-primary-foreground tabular-nums">
            {countFormat.format(openCount)}
            <span className="sr-only">건</span>
          </Badge>
        </h2>
      )}

      {shown.length === 0 ? null : (
        <ul className="divide-y border bg-card">
          {shown.map((item) => (
            <AttentionRow
              key={item.id}
              item={item}
              projectName={projects.find((project) => project.id === item.projectId)?.name}
              busy={pending === item.id}
              open={expanded === item.id}
              replying={replying === item.id}
              resolution={resolved[item.id]}
              onToggle={() => toggle(item.id)}
              onReply={() => reply(item.id)}
              onResolve={(resolution, text) => resolve(item, resolution, text)}
              onUndo={() => undo(item)}
            />
          ))}
        </ul>
      )}

      {/* 처리 결과와 실패를 알립니다. 실패는 화면에도 보입니다. */}
      <p role="status" aria-live="polite" className="text-label text-attention-foreground empty:hidden">
        {announcement.includes('다시 시도하세요') ? announcement : null}
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement.includes('다시 시도하세요') ? null : announcement}
      </p>
    </section>
  )
}

interface AttentionRowProps {
  item: AttentionItem
  projectName?: string
  busy: boolean
  open: boolean
  replying: boolean
  resolution?: Resolution
  onToggle: () => void
  onReply: () => void
  onResolve: (resolution: Resolution, text?: string) => void
  onUndo: () => void
}

function AttentionRow({
  item,
  projectName,
  busy,
  open,
  replying,
  resolution,
  onToggle,
  onReply,
  onResolve,
  onUndo,
}: AttentionRowProps) {
  const panelId = useId()
  const actionsRef = useRef<HTMLDivElement>(null)
  const focusAfterSwap = useRef(false)
  const kind = KIND[item.kind]
  const isResolved = resolution !== undefined

  // 처리하거나 되돌리면 누른 버튼이 사라지므로, 새로 나타난 첫 버튼으로 포커스를 옮깁니다
  useEffect(() => {
    if (!focusAfterSwap.current) return
    focusAfterSwap.current = false
    actionsRef.current?.querySelector('button')?.focus()
  }, [isResolved])

  const handleResolve = (next: Resolution, text?: string) => {
    focusAfterSwap.current = true
    onResolve(next, text)
  }

  const handleUndo = () => {
    focusAfterSwap.current = true
    onUndo()
  }

  return (
    <li className={cn('transition-colors motion-reduce:transition-none', open && 'bg-muted/50')}>
      {/* 행 머리 전체가 펼침 버튼의 클릭 영역입니다. 버튼은 제목 글자만 담고, 클릭 영역은 ::after로 행 전체에 넓힙니다. */}
      <div
        className="relative grid cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 gap-y-3 py-4 ps-4 pe-11 transition-colors hover:bg-muted/40 motion-reduce:transition-none sm:grid-cols-[1.25rem_minmax(0,1fr)_auto] has-[[data-row-toggle]:focus-visible]:outline-2 has-[[data-row-toggle]:focus-visible]:-outline-offset-2 has-[[data-row-toggle]:focus-visible]:outline-foreground"
      >
        <span className="pt-0.5">
          <Glyph
            icon={isResolved ? CircleCheck : kind.icon}
            className={cn('size-5', isResolved ? 'text-muted-foreground' : 'text-attention')}
          />
          <span className="sr-only">{isResolved ? '처리함' : kind.label}</span>
        </span>

        <div className="grid min-w-0 gap-1">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted-foreground">
            {item.at ? <time className="font-mono tabular-nums">{item.at}</time> : null}
            {/* 행 펼침 영역(::after) 위로 올려 따로 누를 수 있게 합니다 */}
            <Link
              to="/rooms/$roomId"
              params={{ roomId: String(item.target.roomId) }}
              search={item.target.taskId !== undefined ? { focus: item.target.taskId } : {}}
              className="relative z-10 flex items-center gap-1.5 underline-offset-4 hover:text-foreground hover:underline"
            >
              <Glyph icon={FolderGit2} className="size-3.5" />
              <span className="sr-only">프로젝트 열기: </span>
              {projectName}
            </Link>
          </p>
          <p className={cn('font-semibold text-pretty', isResolved && 'text-muted-foreground line-through')}>
            <button
              type="button"
              data-row-toggle=""
              aria-expanded={open}
              aria-controls={panelId}
              onClick={onToggle}
              className={cn(
                'cursor-pointer text-start outline-none after:absolute after:inset-0',
                isResolved && 'line-through decoration-from-font',
              )}
            >
              {item.title}
            </button>
          </p>
          {item.detail ? <p className="max-w-[65ch] text-muted-foreground text-pretty">{item.detail}</p> : null}
          {item.agent || item.task ? (
            <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-label">
              {item.agent ? (
                <div className="flex items-center gap-1.5">
                  <dt className="text-muted-foreground">
                    <Glyph icon={Bot} className="size-3.5" />
                    <span className="sr-only">에이전트</span>
                  </dt>
                  <dd>{item.agent}</dd>
                </div>
              ) : null}
              {item.task ? (
                <div className="flex items-center gap-1.5">
                  <dt className="text-muted-foreground">
                    <Glyph icon={ListTodo} className="size-3.5" />
                    <span className="sr-only">할 일</span>
                  </dt>
                  <dd className="flex gap-1.5">
                    <span className="font-mono tabular-nums">{item.task.id}</span>
                    <span>{item.task.title}</span>
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>

        <div
          ref={actionsRef}
          className="pointer-events-none relative z-10 col-start-2 flex items-center gap-2 *:pointer-events-auto sm:col-start-3 sm:items-start"
        >
          {resolution ? (
            <>
              <span className="text-label text-muted-foreground">{RESOLUTION_LABEL[resolution]}</span>
              {UNDOABLE.includes(resolution) ? (
                <IconButton variant="ghost" icon={Undo2} label="되돌리기" disabled={busy} onClick={handleUndo} />
              ) : null}
            </>
          ) : (
            <>
              {item.kind === 'jev-stop' ? (
                <IconButton icon={Play} label="재개하기" disabled={busy} onClick={() => handleResolve('resumed')} />
              ) : null}
              {item.kind === 'timeout' || item.kind === 'failed' || item.kind === 'held' ? (
                <IconButton
                  icon={RotateCcw}
                  label="다시 실행"
                  disabled={busy}
                  onClick={() => handleResolve('reassigned')}
                />
              ) : null}
              {item.kind === 'question' ? (
                <IconButton
                  icon={Reply}
                  label="답하기"
                  aria-expanded={open && replying}
                  aria-controls={panelId}
                  onClick={onReply}
                />
              ) : null}
            </>
          )}
        </div>
        {/* 펼침 단서. 버튼이 아니며, 눌러도 행 머리의 펼침 버튼으로 전달됩니다. */}
        <ChevronDown
          aria-hidden="true"
          strokeWidth={1.75}
          className={cn(
            'pointer-events-none absolute end-4 top-[1.375rem] size-4 text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </div>

      <DisclosurePanel open={open} id={panelId}>
        <div className="grid gap-6 ps-12 pe-4 pb-5 md:grid-cols-2">
          {replying ? (
            <ReplyForm className="md:col-span-2" busy={busy} onSend={(text) => handleResolve('answered', text)} />
          ) : null}
          {item.handoff.length ? <Handoff lines={item.handoff} /> : null}
          {item.log.length ? <SessionLog lines={item.log} /> : null}
          {!replying && !item.handoff.length && !item.log.length ? (
            <p className="text-muted-foreground">인계 노트와 로그가 없습니다.</p>
          ) : null}
        </div>
      </DisclosurePanel>
    </li>
  )
}

function ReplyForm({
  onSend,
  busy,
  className,
}: {
  onSend: (text: string) => void
  busy: boolean
  className?: string
}) {
  const fieldId = useId()
  const errorId = useId()
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)

  // 답하기를 누르면 바로 쓸 수 있게 입력란으로 포커스를 옮깁니다
  useEffect(() => {
    fieldRef.current?.focus({ preventScroll: true })
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!value.trim()) {
      setError(true)
      fieldRef.current?.focus()
      return
    }
    onSend(value.trim())
  }

  return (
    <form noValidate onSubmit={submit} className={className}>
      <Field data-invalid={error || undefined} className="max-w-[65ch] gap-1">
        <FieldLabel htmlFor={fieldId} className="text-label font-semibold">
          답장
        </FieldLabel>
        <div className="flex items-end gap-3">
          <Textarea
            ref={fieldRef}
            id={fieldId}
            rows={2}
            value={value}
            aria-invalid={error || undefined}
            aria-describedby={error ? errorId : undefined}
            className="text-base md:text-sm"
            onChange={(event) => {
              setValue(event.target.value)
              if (error) setError(false)
            }}
          />
          <IconButton type="submit" icon={Send} label="답장 보내기" disabled={busy} />
        </div>
        {error ? <FieldError id={errorId}>보낼 답장을 입력하세요.</FieldError> : null}
      </Field>
    </form>
  )
}

/** 처리 완료 표시. 손으로 그린 듯 원을 두르고 체크를 긋습니다(동작 줄이기에서는 바로 나타남). */
function AllClearMark({ draw }: { draw: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-draw={draw || undefined}
      className="all-clear-mark size-8 shrink-0 text-foreground"
    >
      <circle cx="12" cy="12" r="10" pathLength={1} />
      <path d="m8 12.5 2.75 2.75L16 9.5" pathLength={1} />
    </svg>
  )
}
