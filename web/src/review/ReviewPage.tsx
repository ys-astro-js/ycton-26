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
import { Glyph } from './shared.tsx'
import { PageHeader } from '../shell/PageHeader.tsx'

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
    if (resolution === 'reassigned' && taskId !== undefined) await api.retry(taskId, '사람이 아침 리뷰에서 다시 실행')
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
    <Shell>
      <div className="grid min-w-0 content-start gap-10 pt-6 pb-16">
          <section aria-labelledby="compose-heading" className="grid gap-3">
            <h2 id="compose-heading" className="flex min-h-9 items-center text-lg font-semibold">
              새 할 일
            </h2>
            <div className="border bg-card px-4 pt-2 pb-3">
              <Composer />
            </div>
          </section>
          <AttentionSection
            items={report.attention}
            projects={report.projects}
            onAction={act}
            onUndo={undo}
          />
          <LedgerSection
            projects={report.projects.filter((p) => !project || p.id === project)}
            entries={inScope(report.ledger)}
            period={report.from && report.to ? `${report.from} – ${report.to}` : undefined}
            filter={<ProjectFilter report={report} project={project} />}
          />
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main id="main">
      <PageHeader title="아침 리뷰" />
      {children}
    </main>
  )
}

/**
 * 기록을 한 프로젝트로 좁히는 선택. 처리할 일은 몇 건 안 되고 급하므로 가리지 않고, 길어지는 기록에만 씁니다.
 */
function ProjectFilter({ report, project }: { report: OvernightReport; project?: ProjectId }) {
  const navigate = useNavigate()
  const selectId = useId()
  if (report.projects.length < 2) return null

  return (
    <div className="w-full sm:w-56">
      <Label htmlFor={selectId} className="sr-only">
        기록을 볼 프로젝트
      </Label>
      <NativeSelect
        id={selectId}
        className="w-full"
        value={project ?? ''}
        onChange={(event) => {
          const value = event.target.value as ProjectId | ''
          navigate({ to: '/', search: value ? { project: value } : {}, resetScroll: false })
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
  )
}
