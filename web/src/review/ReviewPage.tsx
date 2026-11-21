import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Unplug } from 'lucide-react'
import { useId } from 'react'

import { api, type TaskEvent } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import { Composer } from '../compose/Composer.tsx'

import { toReport } from './adapter.ts'
import { AttentionSection, type Resolution } from './attention.tsx'
import { LedgerSection } from './ledger.tsx'
import type { AttentionItem, OvernightReport, ProjectId } from './model.ts'
import { Glyph, countFormat } from './shared.tsx'

const route = getRouteApi('/')

const REPORT_KEY = ['overnight-report']

/** 모든 방의 상태와 할 일 이력을 모아 하나의 리포트로 만듭니다. 서버에 실시간 채널이 없어 주기적으로 다시 읽습니다. */
export function useOvernightReport() {
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
      <div className="pt-6">
        <main id="main" className="grid min-w-0 content-start gap-10">
          <section aria-labelledby="compose-heading" className="grid gap-3">
            <h2 id="compose-heading" className="text-lg font-semibold">
              새로 맡기기
            </h2>
            <div className="border bg-card px-4 pt-3 pb-4">
              <Composer />
            </div>
          </section>
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
    <>
      <ReviewHeader report={report} project={project} />
      {children}
    </>
  )
}

function ReviewHeader({ report, project }: { report?: OvernightReport; project?: ProjectId }) {
  const navigate = useNavigate()
  const selectId = useId()

  return (
    <header className="grid items-end gap-x-8 gap-y-4 border-b py-6 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_auto]">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight text-balance">아침 리뷰</h1>
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

        {/* 왼쪽 레일은 아침 리뷰와 채팅방 사이를 오가므로, 프로젝트는 이 선택으로 좁힙니다 */}
        <div className="grid w-full gap-1 sm:w-56">
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
