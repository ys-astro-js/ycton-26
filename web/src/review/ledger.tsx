import { Link } from '@tanstack/react-router'
import { Arc } from 'loading-dev'
import { Bot, ChevronDown, CircleAlert, CircleCheck, CircleDashed, CircleX, FolderGit2, GitCommitHorizontal } from 'lucide-react'
import { useId, useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

import type { LedgerEntry, LedgerStatus, Project } from './model.ts'
import { DisclosurePanel, Glyph, Handoff, SessionLog, STATUS } from './shared.tsx'

/*
 * 행 배치
 * 좁은 컨테이너(기본): 노드 열 + 세 줄 블록
 *   [node] 작업 ID  제목                 [펼치기]
 *          시간
 *          에이전트                       커밋
 * 넓은 컨테이너(@min-[52rem]): 한 줄 격자
 *   node | 시간 | 작업 ID | 제목 | 에이전트 | 커밋 | 펼치기
 * 상태는 오른쪽에 다시 쓰지 않고 왼쪽 노드 하나로만 보여 줍니다.
 */
const ROW_GRID =
  'grid grid-cols-[1.25rem_auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 px-4 py-2 ' +
  '@min-[52rem]:grid-cols-[1.25rem_7rem_3.25rem_minmax(0,1fr)_11.5rem_5.75rem_2.25rem] @min-[52rem]:gap-y-0'

const CELL = {
  node: 'col-start-1 row-start-1 row-span-3 @min-[52rem]:row-span-1',
  time: 'col-start-2 col-span-3 row-start-2 @min-[52rem]:col-start-2 @min-[52rem]:col-span-1 @min-[52rem]:row-start-1',
  task: 'col-start-2 row-start-1 @min-[52rem]:col-start-3',
  title: 'col-start-3 row-start-1 @min-[52rem]:col-start-4',
  agent: 'col-start-2 col-span-2 row-start-3 @min-[52rem]:col-start-5 @min-[52rem]:col-span-1 @min-[52rem]:row-start-1',
  commit: 'col-start-4 row-start-3 justify-self-end @min-[52rem]:col-start-6 @min-[52rem]:row-start-1 @min-[52rem]:justify-self-start',
  toggle: 'col-start-4 row-start-1 justify-self-end @min-[52rem]:col-start-7',
}

/** 넓을 때는 모든 칸을 펼치기 버튼 높이(2.25rem)에 맞춰 세로 가운데에 둡니다 */
const WIDE_LINE = '@min-[52rem]:min-h-9'

const META_TEXT = 'text-label text-muted-foreground'

/**
 * 상태 표식. 네 상태 모두 같은 16px 원 하나로 그립니다.
 * 완료는 체크 원, 진행 중은 같은 지름으로 도는 호, 대기는 점선 원, 실패는 느낌표 원, 제외는 X 원. 뜻은 sr-only 글자가 전합니다.
 */
const NODE_ICON = { done: CircleCheck, waiting: CircleDashed, failed: CircleAlert, dropped: CircleX } as const

export function StatusNode({ status }: { status: LedgerStatus }) {
  if (status === 'running') {
    // 다른 표식과 같은 원이 보이도록, 흐린 고리 위에서 호가 돕니다
    return (
      <span aria-hidden="true" className="relative size-4">
        <svg viewBox="0 0 24 24" fill="none" className="absolute inset-0 size-4 text-border">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={2.5} />
        </svg>
        <Arc size={16} color="var(--live)" className="absolute inset-0" />
      </span>
    )
  }
  const Icon = NODE_ICON[status]
  // 실패는 사람이 다시 실행해야 하는 일이라 빨강(attention)으로, 나머지는 흐린 회색으로 둡니다
  return (
    <Icon
      aria-hidden="true"
      strokeWidth={2.5}
      className={cn('size-4', status === 'failed' ? 'text-attention' : 'text-muted-foreground')}
    />
  )
}

export function LedgerSection({
  projects,
  entries,
  period,
  filter,
}: {
  projects: Project[]
  entries: LedgerEntry[]
  period?: string
  /** 제목 줄 끝에 두는 프로젝트 선택 */
  filter?: React.ReactNode
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const headingId = useId()

  const groups = useMemo(
    () =>
      projects
        .map((project) => ({ project, entries: entries.filter((entry) => entry.projectId === project.id) }))
        .filter((group) => group.entries.length > 0),
    [projects, entries],
  )

  return (
    <section aria-labelledby={headingId} className="@container">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 id={headingId} className="text-lg font-semibold">
            기록
          </h2>
          {period ? <p className="font-mono text-label text-muted-foreground tabular-nums">{period}</p> : null}
        </div>
        {filter}
      </div>

      {groups.length === 0 ? (
        <p className={cn('mt-3', META_TEXT, 'text-body')}>아직 기록이 없습니다.</p>
      ) : (
        <div className="mt-3 grid gap-3">
          {groups.map((group) => (
            <ProjectGroup
              key={group.project.id}
              project={group.project}
              entries={group.entries}
              openId={openId}
              onToggle={(taskId) => setOpenId((current) => (current === taskId ? null : taskId))}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ProjectGroup({
  project,
  entries,
  openId,
  onToggle,
}: {
  project: Project
  entries: LedgerEntry[]
  openId: string | null
  onToggle: (taskId: string) => void
}) {
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className="border bg-card">
      <h3
        id={headingId}
        className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-label font-semibold text-muted-foreground"
      >
        <Link
          to="/rooms/$roomId"
          params={{ roomId: project.id }}
          className="flex items-center gap-1.5 underline-offset-4 hover:text-foreground hover:underline"
        >
          <Glyph icon={FolderGit2} className="size-3.5" />
          <span className="sr-only">프로젝트 열기: </span>
          {project.name}
        </Link>
      </h3>
      <ol className="pb-2">
        {entries.map((entry) => (
          <LedgerRow
            key={entry.taskId}
            entry={entry}
            open={openId === entry.taskId}
            onToggle={() => onToggle(entry.taskId)}
          />
        ))}
      </ol>
    </section>
  )
}

function timeRange(entry: LedgerEntry) {
  if (!entry.start) return '—'
  if (entry.end) return `${entry.start}–${entry.end}`
  if (entry.status === 'running') return `${entry.start}–`
  return entry.start
}

function LedgerRow({ entry, open, onToggle }: { entry: LedgerEntry; open: boolean; onToggle: () => void }) {
  const panelId = useId()
  const dropped = entry.status === 'dropped'

  return (
    <li className={cn('group/row relative', open && 'bg-muted/50')}>
      {/* 레인: 노드 중심(위 여백 0.5rem + 버튼 높이 절반 1.125rem)을 기준으로 위아래 선을 잇습니다. 첫 행과 마지막 행은 바깥쪽 선을 그리지 않습니다. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute start-[calc(1.625rem-1px)] top-0 h-[calc(1.625rem-0.5rem)] w-0.5 bg-border group-first/row:hidden"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute start-[calc(1.625rem-1px)] top-[calc(1.625rem+0.5rem)] bottom-0 w-0.5 bg-border group-last/row:hidden"
      />

      {/* 행 전체가 펼침 버튼의 클릭 영역입니다. 버튼은 제목 글자만 담고, 클릭 영역은 ::after로 행 전체에 넓힙니다. */}
      <div
        className={cn(
          ROW_GRID,
          'relative cursor-pointer transition-colors hover:bg-muted/40 motion-reduce:transition-none',
          'has-[[data-row-toggle]:focus-visible]:outline-2 has-[[data-row-toggle]:focus-visible]:-outline-offset-2 has-[[data-row-toggle]:focus-visible]:outline-foreground',
        )}
      >
        <span className={cn('flex h-9 items-center justify-center', CELL.node)}>
          <StatusNode status={entry.status} />
          <span className="sr-only">
            {STATUS[entry.status].label}
          </span>
        </span>

        <span className={cn('flex items-center font-mono tabular-nums', META_TEXT, WIDE_LINE, CELL.time)}>
          {timeRange(entry)}
        </span>

        <span className={cn('flex min-h-9 items-center font-mono tabular-nums', META_TEXT, CELL.task)}>
          {entry.taskId}
        </span>

        <span
          className={cn(
            'flex min-h-9 min-w-0 items-center text-body text-pretty break-words',
            dropped && 'text-muted-foreground',
            CELL.title,
          )}
        >
          <button
            type="button"
            data-row-toggle=""
            aria-expanded={open}
            aria-controls={panelId}
            onClick={onToggle}
            className={cn(
              'cursor-pointer text-start outline-none after:absolute after:inset-0',
              dropped && 'line-through decoration-from-font',
            )}
          >
            {entry.title}
          </button>
        </span>

        <span className={cn('flex min-w-0 items-center gap-1.5', META_TEXT, WIDE_LINE, CELL.agent)}>
          {entry.agent ? (
            <>
              <Glyph icon={Bot} className="size-3.5" />
              <span className="min-w-0 break-words">{entry.agent}</span>
            </>
          ) : null}
        </span>

        <span className={cn('flex items-center gap-1.5 font-mono tabular-nums', META_TEXT, WIDE_LINE, CELL.commit)}>
          {entry.commit ? (
            <>
              <Glyph icon={GitCommitHorizontal} className="size-3.5" />
              {entry.commit}
            </>
          ) : null}
        </span>

        {/* 펼침 단서. 버튼이 아니며, 눌러도 행의 펼침 버튼으로 전달됩니다. */}
        <span aria-hidden="true" className={cn('pointer-events-none flex size-9 items-center justify-center', CELL.toggle)}>
          <ChevronDown
            strokeWidth={1.75}
            className={cn(
              'size-4 text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none',
              open && 'rotate-180',
            )}
          />
        </span>
      </div>

      <DisclosurePanel open={open} id={panelId}>
        <div className="grid gap-6 ps-12 pe-4 pt-2 pb-4 @min-[52rem]:grid-cols-2">
          <Handoff lines={entry.handoff} />
          <SessionLog lines={entry.log} />
        </div>
      </DisclosurePanel>
    </li>
  )
}
