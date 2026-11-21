import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'

import { api, type Session, type SessionEventPage } from '@/api/client'
import { IconButton } from '@/components/icon-button'
import { Field, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import { Clamp } from './clamp.tsx'

const STATUS: Record<Session['status'], string> = {
  queued: '대기', running: '진행 중', succeeded: '성공', failed: '실패', cancelled: '중단',
}
const EVENT = { message: '에이전트 응답', tool: '도구', plan: '계획', log_gap: '기록 누락' }
const POLL: Record<Session['status'], 1000 | false> = {
  queued: 1000, running: 1000, succeeded: false, failed: false, cancelled: false,
}

function groupMessages(events: SessionEventPage['events']) {
  const rows: SessionEventPage['events'] = []
  for (const event of events) {
    const last = rows.at(-1)
    if (event.kind === 'message' && last?.kind === 'message') last.text += event.text
    else rows.push({ ...event })
  }
  return rows
}

export function SessionDetails({ sessions }: { sessions: Session[] }) {
  const label = useId()
  const [selectedId, setSelectedId] = useState('')
  const selected = sessions.find((session) => session.id === selectedId) ?? sessions.at(-1)
  if (!selected) return null

  return (
    <section className="grid min-w-0 gap-3" aria-labelledby={label}>
      <h3 id={label} className="text-label font-semibold text-muted-foreground">실행 세션 상세</h3>
      {sessions.length > 1 ? (
        <Field className="gap-1">
          <FieldLabel htmlFor={`${label}-attempt`} className="text-label">실행 시도</FieldLabel>
          <NativeSelect id={`${label}-attempt`} value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>
            {sessions.map((session, index) => (
              <NativeSelectOption key={session.id} value={session.id}>{index + 1}번째 시도 {STATUS[session.status]}</NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      <SessionAttempt key={selected.id} initial={selected} />
    </section>
  )
}

function SessionAttempt({ initial }: { initial: Session }) {
  const [positions, setPositions] = useState([0])
  const cursor = positions.at(-1) ?? 0
  const detail = useQuery({
    queryKey: ['session', initial.id],
    queryFn: () => api.session(initial.id),
    refetchInterval: (query) => POLL[(query.state.data ?? initial).status],
  })
  const session = detail.data ?? initial
  const interval = POLL[session.status]
  const events = useQuery({
    queryKey: ['session-events', session.id, cursor, interval],
    queryFn: () => api.sessionEvents(session.id, cursor),
    refetchInterval: interval,
  })
  const page = events.data
  const rows = page ? groupMessages(page.events) : []
  return (
    <>
      {/* 사람이 판단에 쓰는 값만 둡니다. ACP 세션 id와 종료 사유 같은 내부 값은 두지 않습니다. */}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-label">
        <dt className="text-muted-foreground">상태</dt><dd>{STATUS[session.status]}</dd>
        {session.commit_hash ? <><dt className="text-muted-foreground">커밋</dt><dd className="font-mono tabular-nums">{session.commit_hash.slice(0, 7)}</dd></> : null}
      </dl>
      {detail.error ? <p role="alert" className="text-label text-destructive">{detail.error.message}</p> : null}
      {/* 통과한 검증의 출력(exit_code=0)은 읽을 것이 없어 실패했을 때만 보여 줍니다 */}
      {session.verification_output && session.status !== 'succeeded' ? (
        <div className="min-w-0">
          <h4 className="mb-1 text-label font-semibold">검증 출력</h4>
          <Clamp lines={4}>
            <pre className="font-mono text-label break-all whitespace-pre-wrap">{session.verification_output}</pre>
          </Clamp>
        </div>
      ) : null}
      <div className="min-w-0">
        <h4 className="mb-2 text-label font-semibold">ACP 실행 로그</h4>
        {events.error ? <p role="alert" className="text-label text-destructive">{events.error.message}</p> : null}
        {events.isPending ? <p role="status" className="text-label">불러오는 중…</p> : null}
        {page && rows.length === 0 ? <p className="text-label text-muted-foreground">이 페이지에는 표시할 ACP 이벤트가 없습니다.</p> : null}
        {rows.length ? (
          <ol className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-label">
            {rows.map((event) => (
              <li key={event.id} className="col-span-2 grid grid-cols-subgrid">
                <span className="text-muted-foreground">{EVENT[event.kind]}</span>
                <Clamp lines={2}>
                  <p className="break-words whitespace-pre-wrap">{event.text}</p>
                </Clamp>
              </li>
            ))}
          </ol>
        ) : null}
        {positions.length > 1 || page?.has_more ? (
          <div className="mt-2 flex gap-2">
            <IconButton variant="outline" icon={ChevronLeft} label="이전 이벤트" disabled={positions.length === 1} onClick={() => setPositions((p) => p.slice(0, -1))} />
            <IconButton variant="outline" icon={ChevronRight} label="다음 이벤트" disabled={!page?.has_more} onClick={() => {
              if (page?.has_more) setPositions((p) => [...p, page.next_cursor])
            }} />
          </div>
        ) : null}
      </div>
    </>
  )
}
