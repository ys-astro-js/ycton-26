import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react'

import type { ModelProvider } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface ModelChoice {
  provider: string
  model: string
  effort: string
}

interface Point {
  x: number
  y: number
}

function side(p: Point, a: Point, b: Point) {
  return (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y)
}

function inTriangle(p: Point, a: Point, b: Point, c: Point) {
  const d1 = side(p, a, b)
  const d2 = side(p, b, c)
  const d3 = side(p, c, a)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

/** 다음 열로 대각선으로 가는 동안 지나치는 항목은 고르지 않고, 멈추면 그때 고릅니다 */
const AIM_DELAY_MS = 200

/**
 * 메뉴의 안전 삼각형. 포인터가 조금 전 위치에서 다음 열의 왼쪽 위·아래 모서리로 이루는 삼각형 안으로 움직이면
 * 다음 열을 향해 가는 중으로 보고, 지나치는 항목으로 미리 보기를 바꾸지 않습니다.
 */
function useAimGuard() {
  const trail = useRef<Point[]>([])
  const timer = useRef<number | undefined>(undefined)
  const columns = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const aiming = (column: number) => {
    const next = columns.current[column + 1]
    const from = trail.current[0]
    const to = trail.current.at(-1)
    if (!next || !from || !to || to.x <= from.x) return false
    const rect = next.getBoundingClientRect()
    return inTriangle(to, from, { x: rect.left, y: rect.top }, { x: rect.left, y: rect.bottom })
  }

  return {
    columns,
    track: (event: { clientX: number; clientY: number }) => {
      trail.current = [...trail.current.slice(-3), { x: event.clientX, y: event.clientY }]
    },
    hover: (column: number, preview: () => void) => {
      window.clearTimeout(timer.current)
      if (aiming(column)) timer.current = window.setTimeout(preview, AIM_DELAY_MS)
      else preview()
    },
    cancel: () => window.clearTimeout(timer.current),
  }
}

/**
 * 모델 제공자, 모델, 추론 수준을 왼쪽에서 오른쪽으로 한 열씩 고릅니다.
 * 앞 열을 고르면 다음 열이 열리고, 마지막 열을 고르면 선택이 끝나 닫힙니다.
 */
export function ModelPicker({
  id,
  providers,
  value,
  invalid,
  describedBy,
  disabled,
  onChange,
}: {
  id: string
  providers: ModelProvider[]
  value: ModelChoice | null
  invalid?: boolean
  describedBy?: string
  disabled?: boolean
  onChange: (choice: ModelChoice) => void
}) {
  const [open, setOpen] = useState(false)
  const [providerId, setProviderId] = useState(value?.provider ?? '')
  const [model, setModel] = useState(value?.model ?? '')
  const provider = providers.find((candidate) => candidate.id === providerId)
  const aim = useAimGuard()
  // 세 열을 처음부터 같은 크기로 띄워, 고를 때마다 팝오버 크기가 바뀌지 않게 합니다
  const rows = Math.max(providers.length, ...providers.flatMap((p) => [p.models.length, p.efforts.length]), 1)

  const finish = (choice: ModelChoice) => {
    onChange(choice)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // 다시 열면 지금 고른 값에서 시작합니다
        if (next) {
          setProviderId(value?.provider ?? '')
          setModel(value?.model ?? '')
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn(
              'h-10 w-full justify-start px-3 text-body font-normal tracking-normal normal-case',
              !value && 'text-muted-foreground',
            )}
          />
        }
      >
        {/* 모델과 추론 수준은 가운뎃점으로 잇지 않고 양 끝에 따로 둡니다 */}
        {value ? (
          <>
            <span className="min-w-0 truncate font-mono text-label">{value.model}</span>
            {value.effort ? (
              <span className="ms-auto shrink-0 text-label text-muted-foreground">
                <span className="sr-only">추론 수준 </span>
                {value.effort}
              </span>
            ) : null}
          </>
        ) : (
          <span className="min-w-0 truncate">모델 선택</span>
        )}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-auto flex-row gap-0 p-0" onPointerMoveCapture={aim.track}>
        <Column title="제공자" rows={rows} columnRef={(node) => { aim.columns.current[0] = node }}>
          {providers.map((candidate) => (
            <Option
              key={candidate.id}
              selected={candidate.id === providerId}
              onPreview={(fromPointer) => {
                const preview = () => {
                  setProviderId(candidate.id)
                  setModel((current) => (candidate.id === providerId ? current : ''))
                }
                if (fromPointer) aim.hover(0, preview)
                else preview()
              }}
              onLeave={aim.cancel}
              onSelect={() => {
                setProviderId(candidate.id)
                setModel('')
              }}
            >
              {candidate.label}
            </Option>
          ))}
        </Column>
        <Column title="모델" rows={rows} columnRef={(node) => { aim.columns.current[1] = node }}>
          {provider?.models.map((candidate) => (
            <Option
              key={candidate}
              mono
              selected={candidate === model}
              onPreview={(fromPointer) => {
                if (provider.efforts.length === 0) return
                const preview = () => setModel(candidate)
                if (fromPointer) aim.hover(1, preview)
                else preview()
              }}
              onLeave={aim.cancel}
              onSelect={() => {
                if (provider.efforts.length === 0) finish({ provider: provider.id, model: candidate, effort: '' })
                else setModel(candidate)
              }}
            >
              {candidate}
            </Option>
          ))}
        </Column>
        <Column title="추론 수준" rows={rows} columnRef={(node) => { aim.columns.current[2] = node }}>
          {provider && model ? provider.efforts.map((candidate) => (
            <Option
              key={candidate}
              selected={value?.provider === provider.id && value.model === model && value.effort === candidate}
              onSelect={() => finish({ provider: provider.id, model, effort: candidate })}
            >
              {candidate}
            </Option>
          )) : null}
        </Column>
      </PopoverContent>
    </Popover>
  )
}

function Column({
  title,
  rows,
  columnRef,
  children,
}: {
  title: string
  rows: number
  columnRef: Ref<HTMLDivElement>
  children: ReactNode
}) {
  const headingId = useId()
  return (
    <div
      ref={columnRef}
      role="group"
      aria-labelledby={headingId}
      style={{ gridTemplateRows: `auto repeat(${rows}, 2.25rem)` }}
      className="grid w-44 content-start gap-0.5 border-e p-1.5 last:border-e-0"
    >
      <p id={headingId} className="px-2 pt-1 pb-1.5 text-label font-semibold text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  )
}

/**
 * onPreview는 마우스를 올리거나 키보드로 초점을 옮길 때 다음 열을 미리 엽니다. 클릭은 고르기입니다.
 * 포인터로 미리 볼 때는 안전 삼각형을 거치도록 fromPointer를 넘깁니다.
 */
function Option({
  selected,
  mono,
  onPreview,
  onLeave,
  onSelect,
  children,
}: {
  selected: boolean
  mono?: boolean
  onPreview?: (fromPointer: boolean) => void
  onLeave?: () => void
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-pressed={selected}
      onPointerEnter={() => onPreview?.(true)}
      onPointerMove={() => onPreview?.(true)}
      onPointerLeave={onLeave}
      onFocus={() => onPreview?.(false)}
      onClick={onSelect}
      className={cn(
        'h-9 w-full justify-start px-2 text-body font-normal tracking-normal normal-case',
        mono && 'font-mono text-label',
        selected && 'bg-muted font-semibold',
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
    </Button>
  )
}
