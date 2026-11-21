import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { Arc } from 'loading-dev'
import { FolderGit2, Menu, Sunrise, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { IconButton } from '@/components/icon-button'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
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
    <>
      {/* 키보드 사용자가 레일을 건너뛰고 바로 본문으로 갈 수 있게, 포커스를 받을 때만 보입니다 */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:border focus:bg-background focus:px-3 focus:py-2 focus:text-label focus:font-semibold"
      >
        본문으로 건너뛰기
      </a>
    <div className="mx-auto max-w-7xl px-4 sm:px-8 lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-8">
      <Rail />
      <MobileBar />
      {/* 아래 여백을 본문 열에 두어야 짧은 화면에서도 레일이 끝까지 위에 붙어 있습니다 */}
      <div className="min-w-0 pb-16">
        <Outlet />
      </div>
    </div>
    </>
  )
}

function Wordmark() {
  return (
    <p className="text-lg leading-tight font-bold tracking-tight">afk</p>
  )
}

const RAIL_LINK =
  'flex min-h-9 items-center gap-2.5 px-3 text-body text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
const RAIL_LINK_CURRENT = 'bg-muted font-semibold text-foreground'

/** 그 방에서 사람이 처리할 일의 수. 0이면 숫자를 쓰지 않습니다(아침 리뷰 레일과 같은 표기). */
function AttentionBadge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span className="font-mono text-xs font-semibold text-attention-foreground tabular-nums">
      {countFormat.format(count)}
      <span className="sr-only">건 처리할 일</span>
    </span>
  )
}

function Rail() {
  return (
    <aside className="sticky top-0 hidden h-dvh self-start overflow-y-auto pb-8 lg:block">
      {/* 워드마크를 화면 머리와 같은 높이의 칸 가운데에 두어 제목과 한 줄에 섭니다 */}
      <div className="mb-6 flex h-(--page-header-height) items-center border-b px-3">
        <Wordmark />
      </div>
      <RailNav />
    </aside>
  )
}

/** 넓은 화면의 레일과 좁은 화면의 메뉴가 같이 쓰는 내비게이션 */
function RailNav() {
  const { data: rooms = [] } = useRooms()
  const signals = useRoomSignals()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const headingId = useId()

  return (
    <nav aria-label="화면" className="grid gap-5">
      <Link to="/" aria-current={pathname === '/' ? 'page' : undefined} className={cn(RAIL_LINK, pathname === '/' && RAIL_LINK_CURRENT)}>
        <Glyph icon={Sunrise} />
        <span className="min-w-0 break-words">아침 리뷰</span>
        <span className="ms-auto">
          <AttentionBadge count={signals.attention()} />
        </span>
      </Link>

      <div>
        <h2 id={headingId} className="px-3 pb-1 text-label font-semibold text-muted-foreground">
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
        className="mt-1 h-9 w-full justify-start px-3 text-label font-medium tracking-normal text-muted-foreground normal-case"
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
        <p role="alert" className="text-label text-destructive">
          {create.error instanceof ApiError ? create.error.message : '채팅방을 만들지 못했습니다'}. 잠시 후 다시 시도하세요.
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

/** 레일이 숨는 좁은 화면에서는 같은 내비게이션을 메뉴 버튼으로 여닫습니다 */
function MobileBar() {
  const [open, setOpen] = useState(false)
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  // 다른 화면으로 옮기면 메뉴를 닫습니다
  useEffect(() => setOpen(false), [pathname])

  return (
    <div
      className="pt-4 pb-2 lg:hidden"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          setOpen(false)
          buttonRef.current?.focus()
        }
      }}
    >
      <div className="flex items-center justify-between">
        <Wordmark />
        <IconButton
          ref={buttonRef}
          variant="outline"
          icon={open ? X : Menu}
          label={open ? '메뉴 닫기' : '메뉴 열기'}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
        />
      </div>
      {open ? (
        <div id={panelId} className="mt-4 -mx-3 border-b pb-4">
          <RailNav />
        </div>
      ) : null}
    </div>
  )
}
