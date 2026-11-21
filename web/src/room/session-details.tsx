import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'

import { api, type Session, type SessionEventPage } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

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
              <NativeSelectOption key={session.id} value={session.id}>{index + 1}번째 · {STATUS[session.status]}</NativeSelectOption>
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
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 break-all text-label">
        <dt>상태</dt><dd>{STATUS[session.status]}</dd>
        {session.acp_session_id ? <><dt>ACP 세션</dt><dd>{session.acp_session_id}</dd></> : null}
        {session.stop_reason ? <><dt>종료 사유</dt><dd>{session.stop_reason}</dd></> : null}
        {session.commit_hash ? <><dt>커밋</dt><dd>{session.commit_hash}</dd></> : null}
      </dl>
      {detail.error ? <p role="alert" className="text-label text-destructive">{detail.error.message}</p> : null}
      {session.verification_output ? (
        <div>
          <h4 className="mb-1 text-label font-semibold">검증 출력</h4>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-label">{session.verification_output}</pre>
        </div>
      ) : null}
      <div className="min-w-0">
        <h4 className="mb-2 text-label font-semibold">ACP 실행 로그</h4>
        {events.error ? <p role="alert" className="text-label text-destructive">{events.error.message}</p> : null}
        {events.isPending ? <p role="status" className="text-label">불러오는 중…</p> : null}
        {page && rows.length === 0 ? <p className="text-label text-muted-foreground">이 페이지에는 표시할 ACP 이벤트가 없습니다.</p> : null}
        {rows.length ? (
          <ol className="grid max-h-64 gap-2 overflow-auto text-label">
            {rows.map((event) => (
              <li key={event.id} className="break-words whitespace-pre-wrap">
                <span className="me-2 font-semibold text-muted-foreground">{EVENT[event.kind]}</span>{event.text}
              </li>
            ))}
          </ol>
        ) : null}
        {positions.length > 1 || page?.has_more ? (
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="outline" disabled={positions.length === 1} onClick={() => setPositions((p) => p.slice(0, -1))}>이전 이벤트</Button>
            <Button size="sm" variant="outline" disabled={!page?.has_more} onClick={() => {
              if (page?.has_more) setPositions((p) => [...p, page.next_cursor])
            }}>다음 이벤트</Button>
          </div>
        ) : null}
      </div>
    </>
  )
}
