import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { Arc } from 'loading-dev'
import { FolderGit2, Sunrise } from 'lucide-react'
import { useId, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api, ApiError } from '@/api/client'

import { useOvernightReport } from '../review/ReviewPage.tsx'
import { Glyph, countFormat } from '../review/shared.tsx'
import { ROOMS_KEY, useRooms } from '../room/data.ts'

/**
 * 레일과 좁은 화면의 이동 선택이 같이 쓰는 방별 신호.
 * 처리 필요 개수와 진행 중 여부는 아침 리뷰 리포트(모든 방 상태)에서 셉니다.
 */
function useRoomSignals() {
  const { data: report } = useOvernightReport()
  return {
    attention: (roomId?: number) =>
      report?.attention.filter((item) => roomId === undefined || item.target.roomId === roomId).length ?? 0,
    live: (roomId: number) =>
      report?.ledger.some((entry) => entry.projectId === String(roomId) && entry.status === 'running') ?? false,
  }
}

export function AppShell() {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-8 lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-8">
      <Rail />
      <MobileBar />
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  )
}

function Wordmark() {
  return (
    <p className="text-[0.9375rem] font-bold">afk</p>
  )
}

const RAIL_LINK =
  'flex min-h-9 items-center gap-2.5 px-3 text-[0.9375rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
const RAIL_LINK_CURRENT = 'bg-muted font-semibold text-foreground'

/** 그 방에서 사람이 처리할 일의 수. 0이면 숫자를 쓰지 않습니다(아침 리뷰 레일과 같은 표기). */
function AttentionBadge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span className="font-mono text-xs font-semibold text-attention-foreground tabular-nums">
      {countFormat.format(count)}
      <span className="sr-only">건 처리 필요</span>
    </span>
  )
}

function Rail() {
  const { data: rooms = [] } = useRooms()
  const signals = useRoomSignals()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const headingId = useId()

  return (
    <aside className="sticky top-0 hidden h-dvh self-start overflow-y-auto pt-6 pb-8 lg:block">
      <div className="flex min-h-[5.25rem] items-start px-3">
        <Wordmark />
      </div>

      <nav aria-label="화면" className="grid gap-5">
        <Link to="/" aria-current={pathname === '/' ? 'page' : undefined} className={cn(RAIL_LINK, pathname === '/' && RAIL_LINK_CURRENT)}>
          <Glyph icon={Sunrise} />
          <span className="min-w-0 break-words">아침 리뷰</span>
          <span className="ms-auto">
            <AttentionBadge count={signals.attention()} />
          </span>
        </Link>

        <div>
          <h2 id={headingId} className="px-3 pb-1 text-[0.8125rem] font-semibold text-muted-foreground">
            채팅방
          </h2>
          <ul aria-labelledby={headingId} className="grid gap-0.5">
            {rooms.map((room) => {
              const current = pathname === `/rooms/${room.id}`
              const live = signals.live(room.id)
              return (
                <li key={room.id}>
                  <Link
                    to="/rooms/$roomId"
                    params={{ roomId: String(room.id) }}
                    aria-current={current ? 'page' : undefined}
                    className={cn(RAIL_LINK, current && RAIL_LINK_CURRENT)}
                  >
                    <Glyph icon={FolderGit2} />
                    <span className="min-w-0 break-words">{room.name}</span>
                    <span className="ms-auto flex items-center gap-2">
                      {live ? (
                        <>
                          <Arc size={12} color="var(--live)" />
                          <span className="sr-only">진행 중</span>
                        </>
                      ) : null}
                      <AttentionBadge count={signals.attention(room.id)} />
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
          <NewRoom />
        </div>
      </nav>
    </aside>
  )
}

function NewRoom() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fieldId = useId()
  const errorId = useId()
  const navigate = useNavigate()
  const client = useQueryClient()
  const create = useMutation({
    mutationFn: (roomName: string) => api.createRoom(roomName),
    onSuccess: async (room) => {
      await client.invalidateQueries({ queryKey: ROOMS_KEY })
      await client.invalidateQueries({ queryKey: ['overnight-report'] })
      setName('')
      setOpen(false)
      navigate({ to: '/rooms/$roomId', params: { roomId: String(room.id) } })
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setError(true)
      inputRef.current?.focus()
      return
    }
    create.mutate(name.trim())
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        className="mt-1 h-9 w-full justify-start px-3 text-[0.8125rem] font-medium tracking-normal text-muted-foreground normal-case"
        onClick={() => {
          setOpen(true)
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
      >
        새 채팅방
      </Button>
    )
  }

  return (
    <form noValidate onSubmit={submit} className="mt-2 grid gap-2 px-3">
      <Field data-invalid={error || undefined} className="gap-0">
        <FieldLabel htmlFor={fieldId} className="text-xs text-muted-foreground">
          채팅방 이름
        </FieldLabel>
        <Input
          ref={inputRef}
          id={fieldId}
          value={name}
          placeholder="mobile-app"
          aria-invalid={error || undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setName(event.target.value)
            if (error) setError(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
          }}
        />
        {error ? <FieldError id={errorId}>이름을 입력하세요.</FieldError> : null}
      </Field>
      {create.error ? (
        <p role="alert" className="text-[0.8125rem] text-destructive">
          {create.error instanceof ApiError ? create.error.message : '채팅방을 만들지 못했습니다'}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={create.isPending} className="tracking-normal normal-case">
          만들기
        </Button>
        <Button type="button" size="sm" variant="ghost" className="tracking-normal normal-case" onClick={() => setOpen(false)}>
          취소
        </Button>
      </div>
    </form>
  )
}

/** 레일이 숨는 좁은 화면에서 아침 리뷰와 채팅방 사이를 이 선택 하나로 오갑니다 */
function MobileBar() {
  const { data: rooms = [] } = useRooms()
  const signals = useRoomSignals()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const navigate = useNavigate()
  const selectId = useId()

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b pt-5 pb-4 lg:hidden">
      <Wordmark />
      <div className="grid w-full gap-1 sm:w-56">
        <Label htmlFor={selectId} className="text-xs text-muted-foreground">
          이동
        </Label>
        <NativeSelect
          id={selectId}
          className="w-full"
          value={pathname}
          onChange={(event) => {
            const value = event.target.value
            if (value === '/') navigate({ to: '/' })
            else navigate({ to: '/rooms/$roomId', params: { roomId: value.replace('/rooms/', '') } })
          }}
        >
          <NativeSelectOption value="/">아침 리뷰 (처리 필요 {signals.attention()})</NativeSelectOption>
          {rooms.map((room) => (
            <NativeSelectOption key={room.id} value={`/rooms/${room.id}`}>
              {room.name}
              {signals.live(room.id) ? ' (진행 중)' : ''}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </div>
  )
}
