import {
  Bot,
  ChevronDown,
  CircleCheck,
  FolderGit2,
  ListTodo,
  MessageCircleQuestionMark,
  OctagonPause,
  Play,
  Reply,
  RotateCcw,
  Send,
  TimerOff,
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
import { sampleReport, type AttentionItem, type AttentionKind } from './sampleData.ts'

type Resolution = 'resumed' | 'reassigned' | 'answered'

const RESOLUTION_LABEL: Record<Resolution, string> = {
  resumed: '재개함',
  reassigned: '다시 맡김',
  answered: '답함',
}

const KIND: Record<AttentionKind, { icon: LucideIcon; label: string }> = {
  'jev-stop': { icon: OctagonPause, label: 'Jev 정지' },
  timeout: { icon: TimerOff, label: '시간 초과' },
  question: { icon: MessageCircleQuestionMark, label: '질문' },
}

const DEFAULT_EXPANDED = 'a2'

export function AttentionSection({ items }: { items: AttentionItem[] }) {
  const headingId = useId()
  const [expanded, setExpanded] = useState<string | null>(() =>
    items.some((item) => item.id === DEFAULT_EXPANDED) ? DEFAULT_EXPANDED : null,
  )
  const [replying, setReplying] = useState<string | null>(null)
  const [resolved, setResolved] = useState<Record<string, Resolution>>({})
  const [announcement, setAnnouncement] = useState('')

  const openCount = items.filter((item) => !resolved[item.id]).length

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

  const resolve = (item: AttentionItem, resolution: Resolution) => {
    setResolved((current) => ({ ...current, [item.id]: resolution }))
    setExpanded((current) => (current === item.id ? null : current))
    setReplying(null)
    setAnnouncement(`${item.at} ${item.title}: ${RESOLUTION_LABEL[resolution]}`)
  }

  const undo = (item: AttentionItem) => {
    setResolved((current) => {
      const next = { ...current }
      delete next[item.id]
      return next
    })
    setAnnouncement(`${item.at} ${item.title}: 되돌림`)
  }

  return (
    <section aria-labelledby={headingId} className="grid gap-3 text-[0.9375rem]">
      <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold">
        처리 필요
        <Badge
          className={cn(
            'min-w-6 px-1.5 py-0.5 font-mono text-xs tracking-normal tabular-nums',
            openCount > 0 ? 'bg-attention text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          {countFormat.format(openCount)}
          <span className="sr-only">건</span>
        </Badge>
      </h2>

      {items.length === 0 ? (
        <EmptyAttention />
      ) : (
        <ul className="divide-y border bg-card">
          {items.map((item) => (
            <AttentionRow
              key={item.id}
              item={item}
              open={expanded === item.id}
              replying={replying === item.id}
              resolution={resolved[item.id]}
              onToggle={() => toggle(item.id)}
              onReply={() => reply(item.id)}
              onResolve={(resolution) => resolve(item, resolution)}
              onUndo={() => undo(item)}
            />
          ))}
        </ul>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </section>
  )
}

interface AttentionRowProps {
  item: AttentionItem
  open: boolean
  replying: boolean
  resolution?: Resolution
  onToggle: () => void
  onReply: () => void
  onResolve: (resolution: Resolution) => void
  onUndo: () => void
}

function AttentionRow({ item, open, replying, resolution, onToggle, onReply, onResolve, onUndo }: AttentionRowProps) {
  const panelId = useId()
  const actionsRef = useRef<HTMLDivElement>(null)
  const focusAfterSwap = useRef(false)
  const project = sampleReport.projects.find((p) => p.id === item.projectId)
  const kind = KIND[item.kind]
  const isResolved = resolution !== undefined

  // 처리하거나 되돌리면 누른 버튼이 사라지므로, 새로 나타난 첫 버튼으로 포커스를 옮깁니다
  useEffect(() => {
    if (!focusAfterSwap.current) return
    focusAfterSwap.current = false
    actionsRef.current?.querySelector('button')?.focus()
  }, [isResolved])

  const handleResolve = (next: Resolution) => {
    focusAfterSwap.current = true
    onResolve(next)
  }

  const handleUndo = () => {
    focusAfterSwap.current = true
    onUndo()
  }

  return (
    <li className={cn('transition-colors motion-reduce:transition-none', open && 'bg-muted/50')}>
      <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 gap-y-3 px-4 py-4 sm:grid-cols-[1.25rem_minmax(0,1fr)_auto]">
        <span className="pt-0.5">
          <Glyph
            icon={isResolved ? CircleCheck : kind.icon}
            className={cn('size-5', isResolved ? 'text-muted-foreground' : 'text-attention')}
          />
          <span className="sr-only">{isResolved ? '처리함' : kind.label}</span>
        </span>

        <div className="grid min-w-0 gap-1">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-muted-foreground">
            <time className="font-mono tabular-nums">{item.at}</time>
            <span className="flex items-center gap-1.5">
              <Glyph icon={FolderGit2} className="size-3.5" />
              <span className="sr-only">프로젝트</span>
              {project?.name}
            </span>
          </p>
          <p className={cn('font-semibold text-pretty', isResolved && 'text-muted-foreground line-through')}>
            {item.title}
          </p>
          {item.detail ? <p className="max-w-[65ch] text-muted-foreground text-pretty">{item.detail}</p> : null}
          {item.agent || item.task ? (
            <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[0.8125rem]">
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

        <div ref={actionsRef} className="col-start-2 flex items-center gap-2 sm:col-start-3 sm:items-start">
          {resolution ? (
            <>
              <span className="text-[0.8125rem] text-muted-foreground">{RESOLUTION_LABEL[resolution]}</span>
              <IconButton variant="ghost" icon={Undo2} label="되돌리기" onClick={handleUndo} />
            </>
          ) : (
            <>
              {item.kind === 'jev-stop' ? (
                <IconButton icon={Play} label="재개하기" onClick={() => handleResolve('resumed')} />
              ) : null}
              {item.kind === 'timeout' ? (
                <IconButton icon={RotateCcw} label="다시 맡기기" onClick={() => handleResolve('reassigned')} />
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
              <IconButton
                variant="outline"
                icon={ChevronDown}
                label={open ? '기록 접기' : '기록 펼치기'}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={onToggle}
                className={cn(
                  '[&_svg]:transition-transform [&_svg]:duration-150 motion-reduce:[&_svg]:transition-none',
                  open && '[&_svg]:rotate-180',
                )}
              />
            </>
          )}
        </div>
      </div>

      <DisclosurePanel open={open} id={panelId}>
        <div className="grid gap-6 pr-4 pb-5 pl-12 md:grid-cols-2">
          {replying ? (
            <ReplyForm className="md:col-span-2" onSend={() => handleResolve('answered')} />
          ) : null}
          <Handoff lines={item.handoff} />
          <SessionLog lines={item.log} />
        </div>
      </DisclosurePanel>
    </li>
  )
}

function ReplyForm({ onSend, className }: { onSend: () => void; className?: string }) {
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
    onSend()
  }

  return (
    <form noValidate onSubmit={submit} className={className}>
      <Field data-invalid={error || undefined} className="max-w-[65ch] gap-1">
        <FieldLabel htmlFor={fieldId} className="text-[0.8125rem] font-semibold">
          답장
        </FieldLabel>
        <div className="flex items-end gap-3">
          <Textarea
            ref={fieldRef}
            id={fieldId}
            rows={2}
            value={value}
            placeholder="5회로 해 주세요. 간격은 결제사 문서를 따릅니다."
            aria-invalid={error || undefined}
            aria-describedby={error ? errorId : undefined}
            className="text-base md:text-sm"
            onChange={(event) => {
              setValue(event.target.value)
              if (error) setError(false)
            }}
          />
          <IconButton type="submit" icon={Send} label="답장 보내기" />
        </div>
        {error ? <FieldError id={errorId}>보낼 답장을 입력하세요.</FieldError> : null}
      </Field>
    </form>
  )
}

function EmptyAttention() {
  return (
    <div className="flex items-start gap-3 border bg-card px-4 py-5">
      <Glyph icon={CircleCheck} className="mt-0.5 size-5 text-muted-foreground" />
      <div className="grid gap-1">
        <p className="font-semibold">처리할 일이 없습니다</p>
      </div>
    </div>
  )
}
