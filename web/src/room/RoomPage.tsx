import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { ChevronDown, OctagonPause, Pause, Play, Unplug } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { api, ApiError } from '@/api/client'
import { IconButton } from '@/components/icon-button'
import { Button } from '@/components/ui/button'

import { Composer } from '../compose/Composer.tsx'
import { DisclosurePanel, Glyph, countFormat } from '../review/shared.tsx'
import { useRoomMutation, useRoomState } from './data.ts'
import { AgentList, TaskList } from './side.tsx'
import { Timeline } from './timeline.tsx'
import { PageHeader } from '../shell/PageHeader.tsx'

const route = getRouteApi('/rooms/$roomId')

/** 사이드가 대화 옆에 설 만큼 넓은지(80rem). 좁으면 사이드를 대화 위의 접힌 구역으로 둡니다. */
function useWide() {
  const query = '(min-width: 80rem)'
  const [wide, setWide] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setWide(list.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [])
  return wide
}

export function RoomPage() {
  const params = route.useParams()
  const roomId = Number(params.roomId)
  const { focus } = route.useSearch()
  const { data: state, error, isPending, refetch, isRefetching } = useRoomState(roomId)
  const navigate = useNavigate()
  const wide = useWide()
  const [sideOpen, setSideOpen] = useState(false)
  const sidePanelId = useId()

  const pause = useRoomMutation(roomId, () => api.pause(roomId))
  const resume = useRoomMutation(roomId, () => api.resume(roomId))

  // 넘어온 할 일이 있으면 대화 속 그 자리로, 없으면 대화 맨 아래로 스크롤합니다.
  // 라우터의 스크롤 복원이 끝난 다음 프레임에 맞추고, 강조가 끝나 focus만 사라질 때는 건드리지 않습니다.
  const lastRoom = useRef<number | null>(null)
  const loaded = state !== undefined
  useEffect(() => {
    if (!loaded) return
    if (focus === undefined && lastRoom.current === roomId) return
    lastRoom.current = roomId
    if (focus !== undefined && !wide) setSideOpen(true)
    const frame = requestAnimationFrame(() => {
      const target =
        focus !== undefined ? document.querySelector(`ol[aria-label="대화"] [data-focus-key="${focus}"]`) : null
      if (target) target.scrollIntoView({ block: 'center' })
      else window.scrollTo({ top: document.body.scrollHeight })
    })
    return () => cancelAnimationFrame(frame)
    // 방, 초점, 첫 로드 때만 다시 맞춥니다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, focus, loaded])

  // 강조는 잠깐 보이고 사라집니다
  useEffect(() => {
    if (focus === undefined) return
    const timer = window.setTimeout(() => {
      navigate({ to: '/rooms/$roomId', params: { roomId: String(roomId) }, search: {}, replace: true, resetScroll: false })
    }, 2400)
    return () => window.clearTimeout(timer)
  }, [focus, roomId, navigate])

  if (isPending) {
    return (
      <main id="main">
        <PageHeader title="프로젝트" />
        <p role="status" className="pt-6 text-muted-foreground">
          불러오는 중…
        </p>
      </main>
    )
  }

  if (error || !state) {
    const missing = error instanceof ApiError && error.status === 404
    return (
      <main id="main">
      <PageHeader title="프로젝트" />
      <div role="alert" className="mt-6 flex max-w-xl items-start gap-3 border bg-card px-4 py-5">
        <Glyph icon={Unplug} className="mt-0.5 size-5 text-attention" />
        <div className="grid justify-items-start gap-3">
          <div className="grid gap-1">
            <p className="font-semibold">{missing ? '프로젝트를 찾을 수 없습니다' : '프로젝트를 불러오지 못했습니다'}</p>
            <p className="text-muted-foreground">
              {missing ? '삭제되었거나 주소가 잘못되었습니다. 다른 프로젝트를 고르세요.' : `${error?.message ?? '응답이 비어 있습니다'}. 서버가 켜져 있는지 확인하고 다시 시도하세요.`}
            </p>
          </div>
          {missing ? null : (
            <Button variant="outline" size="sm" disabled={isRefetching} onClick={() => refetch()} className="tracking-normal normal-case">
              다시 시도
            </Button>
          )}
        </div>
      </div>
      </main>
    )
  }

  const { room } = state
  const stopped = Boolean(room.paused) || state.jev.action === 'stop'
  const toggleError = pause.error ?? resume.error

  const side = (
    <div className="grid content-start gap-8">
      <TaskList state={state} focus={focus} />
      <AgentList state={state} />
    </div>
  )

  return (
    <main id="main">
      <PageHeader title={room.name}>
        {stopped ? null : (
          <IconButton variant="outline" icon={Pause} label="자동 진행 멈추기" disabled={pause.isPending} onClick={() => pause.mutate(undefined)} />
        )}
      </PageHeader>

      {stopped ? (
        <div role="status" className="mt-6 grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-3 border bg-card px-4 py-4">
          <Glyph icon={OctagonPause} className="mt-0.5 size-5 text-attention" />
          <div className="min-w-0">
            <p className="text-body font-semibold">자동 진행 멈춤</p>
            {state.jev.reason ? <p className="text-body text-muted-foreground text-pretty">{state.jev.reason}</p> : null}
          </div>
          <IconButton icon={Play} label="자동 진행 재개하기" disabled={resume.isPending} onClick={() => resume.mutate(undefined)} />
        </div>
      ) : null}
      {toggleError ? (
        <p role="alert" className="mt-3 text-label text-destructive">
          {toggleError.message}. 잠시 후 다시 시도하세요.
        </p>
      ) : null}

      <div className="grid gap-8 pt-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        {wide ? null : (
          <section className="border bg-card">
            <div className="flex items-center justify-between gap-3 py-1 ps-4 pe-1">
              <h2 className="text-body font-semibold">
                할 일 {countFormat.format(state.tasks.length)}개
                <span className="font-normal text-muted-foreground">, 에이전트 {countFormat.format(state.agents.length)}명</span>
              </h2>
              <IconButton
                label={sideOpen ? '할 일과 에이전트 접기' : '할 일과 에이전트 펼치기'}
                icon={ChevronDown}
                variant="ghost"
                aria-expanded={sideOpen}
                aria-controls={sidePanelId}
                onClick={() => setSideOpen((current) => !current)}
                className="text-muted-foreground [&_svg]:transition-transform [&_svg]:duration-150 [&_svg]:ease-out aria-expanded:[&_svg]:rotate-180 motion-reduce:[&_svg]:transition-none"
              />
            </div>
            <DisclosurePanel open={sideOpen} id={sidePanelId}>
              <div className="border-t px-4 pt-4 pb-5">{side}</div>
            </DisclosurePanel>
          </section>
        )}

        <section aria-label="대화와 입력" className="@container flex min-w-0 flex-col">
          {state.messages.length === 0 ? (
            <p className="px-4 py-6 text-body text-muted-foreground">아직 대화가 없습니다.</p>
          ) : (
            <Timeline state={state} focus={focus} />
          )}
          <div className="sticky bottom-0 z-10 mt-2 border-t bg-background px-4 pt-3 pb-5">
            <Composer
              roomId={room.id}
              onAssigned={(taskId) =>
                navigate({ to: '/rooms/$roomId', params: { roomId: String(room.id) }, search: { focus: taskId }, resetScroll: false })
              }
            />
          </div>
        </section>

        {wide ? (
          <aside aria-label="할 일과 에이전트" className="sticky top-[calc(var(--page-header-height)+1.5rem)] max-h-[calc(100dvh-var(--page-header-height)-3rem)] self-start overflow-y-auto">
            {side}
          </aside>
        ) : null}
      </div>
    </main>
  )
}
