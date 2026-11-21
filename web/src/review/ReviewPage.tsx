import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, getRouteApi, useNavigate } from '@tanstack/react-router'
import { FolderGit2, LayoutList, Unplug } from 'lucide-react'
import { useId } from 'react'

import { api, type TaskEvent } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'

import { toReport } from './adapter.ts'
import { AttentionSection, type Resolution } from './attention.tsx'
import { LedgerSection } from './ledger.tsx'
import type { AttentionItem, OvernightReport, ProjectId } from './model.ts'
import { Glyph, countFormat } from './shared.tsx'

const route = getRouteApi('/')

const REPORT_KEY = ['overnight-report']

/** 모든 방의 상태와 할 일 이력을 모아 하나의 리포트로 만듭니다. 서버에 실시간 채널이 없어 주기적으로 다시 읽습니다. */
function useOvernightReport() {
  return useQuery<OvernightReport>({
    queryKey: REPORT_KEY,
    queryFn: async () => {
      const rooms = await api.rooms()
      const states = await Promise.all(rooms.map((room) => api.roomState(room.id)))
      const tasks = states.flatMap((state) => state.tasks)
      const events = await Promise.all(tasks.map((task) => api.taskEvents(task.id)))
      const eventsByTask = new Map<number, TaskEvent[]>(tasks.map((task, index) => [task.id, events[index] ?? []]))
      return toReport(states, eventsByTask)
    },
    refetchInterval: 5000,
    retry: 1,
  })
}

export function ReviewPage() {
  const { data: report, error, isPending, refetch, isRefetching } = useOvernightReport()
  const { project } = route.useSearch()
  const queryClient = useQueryClient()

  const refresh = () => queryClient.invalidateQueries({ queryKey: REPORT_KEY })

  const act = async (item: AttentionItem, resolution: Resolution, text?: string) => {
    const { roomId, taskId } = item.target
    if (resolution === 'resumed') await api.resume(roomId)
    if (resolution === 'reassigned' && taskId !== undefined) await api.retry(taskId, '사람이 아침 리뷰에서 다시 맡김')
    if (resolution === 'answered' && text) await api.postMessage(roomId, text)
    await refresh()
  }

  const undo = async (item: AttentionItem, resolution: Resolution) => {
    if (resolution === 'resumed') await api.pause(item.target.roomId)
    await refresh()
  }

  if (isPending) {
    return (
      <Shell>
        <p role="status" className="pt-10 text-muted-foreground">
          불러오는 중…
        </p>
      </Shell>
    )
  }

  if (error || !report) {
    return (
      <Shell>
        <div role="alert" className="mt-10 flex max-w-xl items-start gap-3 border bg-card px-4 py-5">
          <Glyph icon={Unplug} className="mt-0.5 size-5 text-attention" />
          <div className="grid justify-items-start gap-3">
            <div className="grid gap-1">
              <p className="font-semibold">오케스트레이션 서버에서 기록을 불러오지 못했습니다</p>
              <p className="text-muted-foreground">
                {error?.message ?? '응답이 비어 있습니다'}. 서버(<code className="font-mono">uvicorn ycton.orchestration.main:app</code>)가 켜져
                있는지 확인한 뒤 다시 시도하세요.
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={isRefetching} onClick={() => refetch()}>
              다시 시도
            </Button>
          </div>
        </div>
      </Shell>
    )
  }

  const inScope = <T extends { projectId: ProjectId }>(items: T[]) =>
    project ? items.filter((item) => item.projectId === project) : items

  return (
    <Shell report={report} project={project}>
      <div className="grid gap-8 pt-6 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <ProjectRail report={report} project={project} />

        <main id="main" className="grid min-w-0 content-start gap-10">
          <AttentionSection
            key={project ?? 'all'}
            items={inScope(report.attention)}
            projects={report.projects}
            onAction={act}
            onUndo={undo}
          />
          <LedgerSection
            projects={report.projects.filter((p) => !project || p.id === project)}
            entries={inScope(report.ledger)}
          />
        </main>
      </div>
    </Shell>
  )
}

function Shell({ report, project, children }: { report?: OvernightReport; project?: ProjectId; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-8">
      <ReviewHeader report={report} project={project} />
      {children}
    </div>
  )
}

function ReviewHeader({ report, project }: { report?: OvernightReport; project?: ProjectId }) {
  const navigate = useNavigate()
  const selectId = useId()

  return (
    <header className="grid items-end gap-x-8 gap-y-4 border-b py-6 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_auto]">
      <div>
        <p className="text-[0.9375rem] font-bold">afk</p>
        <h1 className="mt-1 text-[1.75rem] leading-tight font-bold tracking-tight text-balance">아침 리뷰</h1>
      </div>

      {report ? (
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <dl className="flex gap-x-8">
          <div>
            <dt className="text-xs text-muted-foreground">기간</dt>
            <dd className="font-mono text-[0.8125rem] whitespace-nowrap tabular-nums">
              {report.from && report.to ? `${report.from} – ${report.to}` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">프로젝트</dt>
            <dd className="text-[0.9375rem]">{countFormat.format(report.projects.length)}개</dd>
          </div>
        </dl>

        {/* 레일이 숨는 좁은 화면에서만 프로젝트를 이 선택으로 고릅니다 */}
        <div className="grid w-full gap-1 sm:w-56 lg:hidden">
          <Label htmlFor={selectId} className="text-xs text-muted-foreground">
            프로젝트
          </Label>
          <NativeSelect
            id={selectId}
            className="w-full"
            value={project ?? ''}
            onChange={(event) => {
              const value = event.target.value as ProjectId | ''
              navigate({ to: '/', search: value ? { project: value } : {} })
            }}
          >
            <NativeSelectOption value="">모든 프로젝트</NativeSelectOption>
            {report.projects.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      ) : null}
    </header>
  )
}

function ProjectRail({ report, project }: { report: OvernightReport; project?: ProjectId }) {
  const countFor = (id?: ProjectId) =>
    report.attention.filter((item) => !id || item.projectId === id).length +
    report.ledger.filter((entry) => !id || entry.projectId === id).length
  const items: { id?: ProjectId; name: string }[] = [{ name: '모든 프로젝트' }, ...report.projects]

  return (
    <nav aria-label="프로젝트" className="sticky top-6 hidden self-start lg:block">
      <ul className="grid gap-0.5">
        {items.map((item) => {
          const current = item.id === project
          return (
            <li key={item.name}>
              <Link
                to="/"
                search={item.id ? { project: item.id } : {}}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex min-h-9 items-center gap-2.5 px-3 text-[0.9375rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  current && 'bg-muted font-semibold text-foreground',
                )}
              >
                <Glyph icon={item.id ? FolderGit2 : LayoutList} />
                <span className="min-w-0 break-words">{item.name}</span>
                <span className="ms-auto font-mono text-xs tabular-nums">{countFormat.format(countFor(item.id))}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
