import { useQuery } from '@tanstack/react-query'
import { Link, getRouteApi, useNavigate } from '@tanstack/react-router'
import { FlaskConical, FolderGit2, LayoutList } from 'lucide-react'
import { useId } from 'react'

import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'

import { AttentionSection } from './attention.tsx'
import { LedgerSection } from './ledger.tsx'
import { sampleReport, type OvernightReport, type ProjectId } from './sampleData.ts'
import { Glyph, countFormat } from './shared.tsx'

const route = getRouteApi('/')

function useOvernightReport() {
  // 백엔드가 생기면 /api/review/overnight 같은 엔드포인트로 바뀝니다
  return useQuery<OvernightReport>({ queryKey: ['overnight-report'], queryFn: async () => sampleReport })
}

export function ReviewPage() {
  const { data: report } = useOvernightReport()
  const { project } = route.useSearch()

  if (!report) return null

  const inScope = <T extends { projectId: ProjectId }>(items: T[]) =>
    project ? items.filter((item) => item.projectId === project) : items

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-8">
      <ReviewHeader report={report} project={project} />

      <div className="grid gap-8 pt-6 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <ProjectRail report={report} project={project} />

        <main id="main" className="grid min-w-0 content-start gap-10">
          <AttentionSection key={project ?? 'all'} items={inScope(report.attention)} />
          <LedgerSection
            projects={report.projects.filter((p) => !project || p.id === project)}
            entries={inScope(report.ledger)}
          />
        </main>
      </div>
    </div>
  )
}

function ReviewHeader({ report, project }: { report: OvernightReport; project?: ProjectId }) {
  const navigate = useNavigate()
  const selectId = useId()

  return (
    <header className="grid items-end gap-x-8 gap-y-4 border-b py-6 sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_auto]">
      <div>
        <p className="flex items-center gap-2 text-[0.9375rem] font-bold">
          afk
          {report.isSample ? (
            <Badge variant="outline" className="gap-1 border border-border px-1.5 py-0.5 text-xs font-medium tracking-normal normal-case">
              <Glyph icon={FlaskConical} className="size-3" />
              예시 데이터
            </Badge>
          ) : null}
        </p>
        <h1 className="mt-1 text-[1.75rem] leading-tight font-bold tracking-tight text-balance">아침 리뷰</h1>
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <dl className="flex gap-x-8">
          <div>
            <dt className="text-xs text-muted-foreground">기간</dt>
            <dd className="font-mono text-[0.8125rem] whitespace-nowrap tabular-nums">
              {report.from} – {report.to}
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
