import { useQuery } from '@tanstack/react-query'
import { Link, getRouteApi, useNavigate } from '@tanstack/react-router'
import {
  Bot,
  ChevronDown,
  CircleCheck,
  CircleDot,
  CircleSlash,
  FlaskConical,
  FolderGit2,
  GitCommitHorizontal,
  LayoutList,
  ListTodo,
  MessageCircleQuestionMark,
  NotebookText,
  OctagonPause,
  Play,
  Reply,
  RotateCcw,
  ScrollText,
  Send,
  Terminal,
  TimerOff,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { useId, useMemo, useState, type FormEvent } from 'react'

import { Collapse } from './Collapse.tsx'
import './review.css'
import {
  sampleReport,
  type AttentionItem,
  type AttentionKind,
  type LedgerEntry,
  type LedgerStatus,
  type LogLine,
  type OvernightReport,
  type ProjectId,
} from './sampleData.ts'

const route = getRouteApi('/')

type Resolution = 'resumed' | 'reassigned' | 'answered'

const RESOLUTION_LABEL: Record<Resolution, string> = {
  resumed: '재개함',
  reassigned: '다시 맡김',
  answered: '답함',
}

const KIND_ICON: Record<AttentionKind, { icon: LucideIcon; label: string }> = {
  'jev-stop': { icon: OctagonPause, label: 'Jev 정지' },
  timeout: { icon: TimerOff, label: '시간 초과' },
  question: { icon: MessageCircleQuestionMark, label: '질문' },
}

/** 할 일 상태는 화면 어디서나 이 이름과 아이콘 하나로만 부릅니다 */
const STATUS: Record<LedgerStatus, { label: string; icon: LucideIcon }> = {
  done: { label: '완료', icon: CircleCheck },
  running: { label: '진행 중', icon: CircleDot },
  dropped: { label: '제외', icon: CircleSlash },
}

const countFormat = new Intl.NumberFormat('ko-KR')

function useOvernightReport() {
  // 백엔드가 생기면 /api/review/overnight 같은 엔드포인트로 바뀝니다
  return useQuery<OvernightReport>({ queryKey: ['overnight-report'], queryFn: async () => sampleReport })
}

function Icon({ icon: Glyph, size = 16 }: { icon: LucideIcon; size?: number }) {
  return <Glyph aria-hidden="true" className="icon" width={size} height={size} strokeWidth={1.75} />
}

export function ReviewPage() {
  const { data: report } = useOvernightReport()
  const { project } = route.useSearch()

  const [expanded, setExpanded] = useState<string | null>('a2')
  const [replying, setReplying] = useState<string | null>(null)
  const [resolved, setResolved] = useState<Record<string, Resolution>>({})
  const [announcement, setAnnouncement] = useState('')

  if (!report) return null

  const inScope = <T extends { projectId: ProjectId }>(items: T[]) =>
    project ? items.filter((item) => item.projectId === project) : items

  const attention = inScope(report.attention)
  const ledger = inScope(report.ledger)
  const openCount = attention.filter((item) => !resolved[item.id]).length

  const toggle = (id: string) => {
    setExpanded((current) => (current === id ? null : id))
    setReplying(null)
  }

  const resolve = (item: AttentionItem, resolution: Resolution) => {
    setResolved((current) => ({ ...current, [item.id]: resolution }))
    setExpanded((current) => (current === item.id ? null : current))
    setReplying(null)
    setAnnouncement(`${item.at} ${item.title}: ${RESOLUTION_LABEL[resolution]}`)
  }

  const undo = (item: AttentionItem) => {
    setResolved((current) => {
      const next = { ...current }
      delete next[item.id]
      return next
    })
    setAnnouncement(`${item.at} ${item.title}: 되돌림`)
  }

  return (
    <div className="review">
      <ReviewHeader report={report} project={project} />

      <div className="review-body">
        <ProjectRail report={report} project={project} />

        <main className="review-main" id="main">
          <section className="attn" aria-labelledby="attn-heading">
            <h2 className="section-heading" id="attn-heading">
              처리 필요
              <span className="count-badge" data-tone={openCount > 0 ? 'attention' : 'quiet'}>
                {countFormat.format(openCount)}
                <span className="sr-only">건</span>
              </span>
            </h2>

            {attention.length === 0 ? (
              <EmptyAttention />
            ) : (
              <ol className="attn-list">
                {attention.map((item) => (
                  <AttentionRow
                    key={item.id}
                    item={item}
                    open={expanded === item.id}
                    replying={replying === item.id}
                    resolution={resolved[item.id]}
                    onToggle={() => toggle(item.id)}
                    onReply={() => {
                      setExpanded(item.id)
                      setReplying(item.id)
                    }}
                    onResolve={(resolution) => resolve(item, resolution)}
                    onUndo={() => undo(item)}
                  />
                ))}
              </ol>
            )}
            <p className="sr-only" role="status">
              {announcement}
            </p>
          </section>

          <Ledger report={report} entries={ledger} project={project} />
        </main>
      </div>
    </div>
  )
}

function ReviewHeader({ report, project }: { report: OvernightReport; project?: ProjectId }) {
  const navigate = useNavigate()
  const selectId = useId()

  return (
    <header className="review-header">
      <div className="masthead">
        <p className="wordmark">
          afk
          {report.isSample ? (
            <span className="sample-badge">
              <Icon icon={FlaskConical} size={14} />
              예시 데이터
            </span>
          ) : null}
        </p>
        <h1 className="title">아침 리뷰</h1>
      </div>

      <dl className="meta">
        <div>
          <dt>기간</dt>
          <dd className="numeric">
            {report.from} – {report.to}
          </dd>
        </div>
        <div>
          <dt>프로젝트</dt>
          <dd>{countFormat.format(report.projects.length)}개</dd>
        </div>
      </dl>

      <div className="project-select">
        <label htmlFor={selectId}>프로젝트</label>
        <div className="select-field">
          <select
            id={selectId}
            value={project ?? ''}
            onChange={(event) => {
              const value = event.target.value as ProjectId | ''
              navigate({ to: '/', search: value ? { project: value } : {} })
            }}
          >
            <option value="">전체 프로젝트</option>
            {report.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" className="select-icon" width={16} height={16} strokeWidth={1.75} />
        </div>
      </div>
    </header>
  )
}

function ProjectRail({ report, project }: { report: OvernightReport; project?: ProjectId }) {
  const countFor = (id?: ProjectId) =>
    report.attention.filter((item) => !id || item.projectId === id).length +
    report.ledger.filter((entry) => !id || entry.projectId === id).length
  const items: { id?: ProjectId; name: string }[] = [{ name: '전체 프로젝트' }, ...report.projects]

  return (
    <nav className="rail" aria-label="프로젝트">
      <ul>
        {items.map((item) => (
          <li key={item.name}>
            <Link
              to="/"
              search={item.id ? { project: item.id } : {}}
              aria-current={item.id === project ? 'page' : undefined}
              className="rail-link"
            >
              <Icon icon={item.id ? FolderGit2 : LayoutList} />
              <span className="rail-name">{item.name}</span>
              <span className="rail-count numeric">{countFormat.format(countFor(item.id))}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

interface AttentionRowProps {
  item: AttentionItem
  open: boolean
  replying: boolean
  resolution?: Resolution
  onToggle: () => void
  onReply: () => void
  onResolve: (resolution: Resolution) => void
  onUndo: () => void
}

function AttentionRow({ item, open, replying, resolution, onToggle, onReply, onResolve, onUndo }: AttentionRowProps) {
  const panelId = useId()
  const project = sampleReport.projects.find((p) => p.id === item.projectId)
  const kind = KIND_ICON[item.kind]

  return (
    <li className="attn-row" data-open={open} data-resolved={resolution !== undefined}>
      <div className="attn-main">
        <span className="attn-kind" title={kind.label}>
          <Icon icon={resolution ? CircleCheck : kind.icon} size={18} />
          <span className="sr-only">{resolution ? '처리함' : kind.label}</span>
        </span>

        <div className="attn-body">
          <p className="attn-context">
            <time className="numeric">{item.at}</time>
            <span className="attn-project">
              <Icon icon={FolderGit2} size={14} />
              {project?.name}
            </span>
          </p>
          <p className="attn-title">{item.title}</p>
          {item.detail ? <p className="attn-detail">{item.detail}</p> : null}
          {item.agent || item.task ? (
            <dl className="attn-facts">
              {item.agent ? (
                <div>
                  <dt>
                    <Icon icon={Bot} size={14} />
                    <span className="sr-only">에이전트</span>
                  </dt>
                  <dd>{item.agent}</dd>
                </div>
              ) : null}
              {item.task ? (
                <div>
                  <dt>
                    <Icon icon={ListTodo} size={14} />
                    <span className="sr-only">할 일</span>
                  </dt>
                  <dd>
                    <span className="numeric">{item.task.id}</span> {item.task.title}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>

        <div className="attn-actions">
          {resolution ? (
            <>
              <span className="attn-resolution">{RESOLUTION_LABEL[resolution]}</span>
              <button type="button" className="btn btn-quiet" onClick={onUndo}>
                <Icon icon={Undo2} />
                되돌리기
              </button>
            </>
          ) : (
            <>
              {item.kind === 'jev-stop' ? (
                <button type="button" className="btn btn-primary" onClick={() => onResolve('resumed')}>
                  <Icon icon={Play} />
                  재개하기
                </button>
              ) : null}
              {item.kind === 'timeout' ? (
                <button type="button" className="btn btn-primary" onClick={() => onResolve('reassigned')}>
                  <Icon icon={RotateCcw} />
                  다시 맡기기
                </button>
              ) : null}
              {item.kind === 'question' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  aria-expanded={open && replying}
                  aria-controls={panelId}
                  onClick={open && replying ? onToggle : onReply}
                >
                  <Icon icon={Reply} />
                  답하기
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-disclosure"
                aria-expanded={open && !replying}
                aria-controls={panelId}
                onClick={onToggle}
              >
                <Icon icon={ScrollText} />
                {open && !replying ? '기록 접기' : '기록 보기'}
              </button>
            </>
          )}
        </div>
      </div>

      <Collapse open={open} id={panelId}>
        <div className="detail-panel">
          {replying ? <ReplyForm onSend={() => onResolve('answered')} /> : null}
          <Handoff lines={item.handoff} />
          <SessionLog lines={item.log} />
        </div>
      </Collapse>
    </li>
  )
}

function ReplyForm({ onSend }: { onSend: () => void }) {
  const fieldId = useId()
  const errorId = useId()
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!value.trim()) {
      setError(true)
      document.getElementById(fieldId)?.focus()
      return
    }
    onSend()
  }

  return (
    <form className="reply" onSubmit={submit} noValidate>
      <label htmlFor={fieldId} className="panel-heading">
        <Icon icon={Reply} size={14} />
        답장
      </label>
      <textarea
        id={fieldId}
        rows={2}
        value={value}
        placeholder="5회로 해 주세요. 간격은 결제사 문서를 따릅니다."
        aria-invalid={error}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setValue(event.target.value)
          if (error) setError(false)
        }}
      />
      {error ? (
        <p className="reply-error" id={errorId}>
          보낼 답장을 입력하세요.
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary reply-send">
        <Icon icon={Send} />
        답장 보내기
      </button>
    </form>
  )
}

function Handoff({ lines }: { lines: string[] }) {
  return (
    <div className="handoff">
      <h3 className="panel-heading">
        <Icon icon={NotebookText} size={14} />
        인계 노트
      </h3>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  )
}

function SessionLog({ lines }: { lines: LogLine[] }) {
  return (
    <div className="session-log">
      <h3 className="panel-heading">
        <Icon icon={Terminal} size={14} />
        세션 로그
      </h3>
      <ol>
        {lines.map((line) => (
          <li key={`${line.at}-${line.kind}`} data-kind={line.kind}>
            <time className="log-at">{line.at}</time>
            <span className="log-kind">{line.kind}</span>
            <span className="log-text">{line.text}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function EmptyAttention() {
  return (
    <div className="attn-empty">
      <Icon icon={CircleCheck} size={20} />
      <div>
        <p className="attn-empty-title">처리할 일이 없습니다</p>
        <p>멈춘 작업과 에이전트의 질문이 생기면 여기에 모입니다. 끝난 일은 아래 밤사이 기록에서 확인하세요.</p>
      </div>
    </div>
  )
}

function Ledger({ report, entries, project }: { report: OvernightReport; entries: LedgerEntry[]; project?: ProjectId }) {
  const [open, setOpen] = useState<string | null>(null)

  const groups = useMemo(
    () =>
      report.projects
        .filter((p) => !project || p.id === project)
        .map((p) => ({ project: p, entries: entries.filter((entry) => entry.projectId === p.id) }))
        .filter((group) => group.entries.length > 0),
    [report.projects, entries, project],
  )

  const tally: { label: string; icon: LucideIcon; value: number }[] = [
    { ...STATUS.done, value: entries.filter((e) => e.status === 'done').length },
    { ...STATUS.running, value: entries.filter((e) => e.status === 'running').length },
    { label: '커밋', icon: GitCommitHorizontal, value: entries.filter((e) => e.commit).length },
  ]

  return (
    <section className="ledger" aria-labelledby="ledger-heading">
      <div className="ledger-head">
        <h2 className="section-heading" id="ledger-heading">
          밤사이 기록
        </h2>
        <dl className="tally">
          {tally.map((row) => (
            <div key={row.label}>
              <dt>
                <Icon icon={row.icon} size={14} />
                {row.label}
              </dt>
              <dd className="numeric">{countFormat.format(row.value)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {groups.length === 0 ? (
        <p className="ledger-empty">이 프로젝트에는 밤사이 기록이 없습니다.</p>
      ) : (
        groups.map((group) => (
          <section key={group.project.id} className="ledger-group" aria-labelledby={`group-${group.project.id}`}>
            <h3 className="ledger-group-name" id={`group-${group.project.id}`}>
              <Icon icon={FolderGit2} size={14} />
              {group.project.name}
            </h3>
            <ol className="lane">
              {group.entries.map((entry) => (
                <LedgerRow
                  key={entry.taskId}
                  entry={entry}
                  open={open === entry.taskId}
                  onToggle={() => setOpen((current) => (current === entry.taskId ? null : entry.taskId))}
                />
              ))}
            </ol>
          </section>
        ))
      )}
    </section>
  )
}

function LedgerRow({ entry, open, onToggle }: { entry: LedgerEntry; open: boolean; onToggle: () => void }) {
  const panelId = useId()
  const status = STATUS[entry.status]
  const range = entry.end ? `${entry.start}–${entry.end}` : entry.status === 'running' ? `${entry.start}–` : entry.start

  return (
    <li className="ledger-row" data-status={entry.status} data-open={open}>
      <button type="button" className="ledger-toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <span className="lane-node" aria-hidden="true" />
        <span className="ledger-time numeric">{range}</span>
        <span className="ledger-task numeric">{entry.taskId}</span>
        <span className="ledger-title">{entry.title}</span>
        <span className="ledger-agent">
          {entry.agent ? (
            <>
              <Icon icon={Bot} size={14} />
              {entry.agent}
            </>
          ) : null}
        </span>
        <span className="ledger-commit numeric">
          {entry.commit ? (
            <>
              <Icon icon={GitCommitHorizontal} size={14} />
              {entry.commit}
            </>
          ) : null}
        </span>
        <span className="status" data-status={entry.status}>
          <Icon icon={status.icon} size={14} />
          {status.label}
          {entry.note ? <span className="status-note">({entry.note})</span> : null}
        </span>
        <ChevronDown aria-hidden="true" className="row-chevron" width={16} height={16} strokeWidth={1.75} />
      </button>
      <Collapse open={open} id={panelId}>
        <div className="detail-panel ledger-panel">
          <Handoff lines={entry.handoff} />
          <SessionLog lines={entry.log} />
        </div>
      </Collapse>
    </li>
  )
}
