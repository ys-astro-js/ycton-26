import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { ChevronDown, Folder, Pause, Play, Unplug } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { api, ApiError, type RoomState } from '@/api/client'
import { IconButton } from '@/components/icon-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { Composer } from '../compose/Composer.tsx'
import { DisclosurePanel, Glyph, countFormat } from '../review/shared.tsx'
import { useRoomMutation, useRoomState, useRuntimeOptions } from './data.ts'
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

/**
 * 위에 붙는 상태 줄의 실제 높이를 --status-bar-height로 알립니다. 옆 패널의 고정 위치와 스크롤 여백이 이 값을 씁니다.
 * 폴더 경로가 길거나 자동 진행이 멈춰 줄이 높아져도 옆 패널과 초점이 그 밑에 가리지 않게 합니다.
 */
function useStatusBarHeight(ready: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const bar = ref.current
    if (!bar) return
    const root = document.documentElement
    const observer = new ResizeObserver(([entry]) => {
      root.style.setProperty('--status-bar-height', `${entry.borderBoxSize[0].blockSize}px`)
    })
    observer.observe(bar)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--status-bar-height')
    }
  }, [ready])
  return ref
}

export function RoomPage() {
  const params = route.useParams()
  const roomId = Number(params.roomId)
  const { focus } = route.useSearch()
  const { data: state, error, isPending, refetch, isRefetching } = useRoomState(roomId)
  const { data: runtimeOptions } = useRuntimeOptions(state !== undefined)
  const barRef = useStatusBarHeight(state !== undefined)
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
  // mock 모드의 설정 저장소는 실제 폴더가 없는 자리표시라 이름을 보이지 않습니다
  const repositoryLabel = runtimeOptions?.mode === 'mock' ? null
    : (runtimeOptions?.repositories.find(({ id }) => id === room.repository_id)?.label ?? room.repository_id)
  const stopped = Boolean(room.paused) || state.jev.action === 'stop'
  const toggleError = pause.error ?? resume.error

  const side = (
    <div className="grid content-start gap-8">
      <TaskList key={room.id} state={state} focus={focus} />
      <AgentList state={state} />
    </div>
  )

  return (
    // 화면 높이를 채워, 대화가 짧아도 입력 바가 화면 맨 아래에 붙어 있게 합니다
    <main id="main" className="flex min-h-dvh flex-col">
      <PageHeader title={room.name} />

      {/*
        프로젝트의 폴더와 자동 진행 조작을 한 줄에 둡니다. 넓은 화면에서는 위에 붙어 있고, 레일의 워드마크 줄과 같은 높이에 섭니다.
        이 줄의 높이는 프로젝트나 상태와 상관없이 버튼 한 줄 높이로 고정합니다. 긴 경로는 줄여서 보이고, 프로젝트를 옮겨도 아래 내용이 움직이지 않습니다.
        자동 진행이 멈췄을 때만 그 사실을 조작 버튼 옆에 적습니다. 진행 중은 따로 적지 않습니다.
      */}
      <div
        ref={barRef}
        className="z-10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 bg-background pt-4 pb-3 lg:sticky lg:top-0 lg:border-b lg:pt-6"
      >
        <ProjectSource state={state} repositoryLabel={repositoryLabel} />
        <div className="flex items-center gap-3">
          <p role="status" className="text-label font-semibold whitespace-nowrap empty:hidden">
            {stopped ? '일시 정지' : null}
          </p>
          {stopped ? (
            <IconButton icon={Play} label="재개" disabled={resume.isPending} onClick={() => resume.mutate(undefined)} />
          ) : (
            <IconButton variant="outline" icon={Pause} label="일시 정지" disabled={pause.isPending} onClick={() => pause.mutate(undefined)} />
          )}
        </div>
        {toggleError ? (
          <p role="alert" className="col-span-2 mt-2 text-label text-destructive">
            {toggleError.message}. 잠시 후 다시 시도하세요.
          </p>
        ) : null}
      </div>

      <div className="grid flex-1 grid-rows-[auto_minmax(0,1fr)] gap-8 pt-6 xl:grid-cols-[minmax(0,1fr)_20rem] xl:grid-rows-1">
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
          <div className="sticky bottom-0 z-10 mt-auto border-t bg-background px-4 pt-3 pb-5">
            <Composer roomId={room.id} />
          </div>
        </section>

        {wide ? (
          <aside aria-label="할 일과 에이전트" className="sticky top-[calc(var(--status-bar-height)+1.5rem)] max-h-[calc(100dvh-var(--status-bar-height)-3rem)] self-start overflow-y-auto">
            {side}
          </aside>
        ) : null}
      </div>
    </main>
  )
}

/**
 * 이 프로젝트가 연결된 폴더. 한 줄이고, 현재 브랜치는 같은 줄의 배지로 붙입니다. 넘치면 경로의 앞쪽을 줄입니다.
 * 고른 폴더는 경로를, 설정 저장소는 설정의 이름을 씁니다. 경로는 기계가 만든 값이라 고정폭입니다.
 */
function ProjectSource({ state, repositoryLabel }: { state: RoomState; repositoryLabel: string | null }) {
  const { repo } = state.room
  const branch = state.git?.branch ?? null
  const source = repo ?? repositoryLabel

  return (
    <dl className="flex min-w-0 items-center gap-1.5 text-label text-muted-foreground">
      {source ? (
        <>
          <dt className="contents">
            <Glyph icon={Folder} className="size-3.5 shrink-0" />
            <span className="sr-only">폴더</span>
          </dt>
          {/* 넘칠 때 경로의 앞쪽을 줄여, 폴더 이름이 있는 끝이 남게 합니다 */}
          <dd dir="rtl" className={cn('min-w-0 truncate text-left', repo && 'font-mono')} title={source}>
            <bdi dir="ltr">{source}</bdi>
          </dd>
        </>
      ) : null}
      {branch ? (
        <>
          <dt className="sr-only">브랜치</dt>
          <dd className="shrink-0">
            <Badge className="border px-1.5 py-0 font-mono text-xs leading-[1.125rem] font-normal tracking-normal text-muted-foreground normal-case">
              {branch}
            </Badge>
          </dd>
        </>
      ) : null}
    </dl>
  )
}
