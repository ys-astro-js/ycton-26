// 백엔드의 방 상태(RoomState)를 아침 리뷰 뷰 모델로 바꿉니다.

import type { Agent, RoomState, Session, Task, TaskEvent } from '@/api/client'

import type { AttentionItem, LedgerEntry, LedgerStatus, LogLine, OvernightReport } from './model.ts'

/** 백엔드 시각은 시간대 없는 UTC("2026-11-21 04:05:01")입니다 */
function parse(value: string | null | undefined) {
  if (!value) return undefined
  const date = new Date(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const clock = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const clockWithSeconds = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})
/** 헤더의 기간 표기: 11/21 13:09 */
function dayAndClock(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${clock.format(date)}`
}

const hm = (date?: Date) => (date ? clock.format(date) : undefined)

function lines(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function agentLabel(agent?: Agent) {
  return agent ? `${agent.name}(${agent.kind})` : undefined
}

function workSessions(state: RoomState, taskId: number) {
  return state.sessions.filter((session) => session.kind === 'work' && session.task_id === taskId)
}

function latest(sessions: Session[]) {
  return [...sessions].sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1)
}

const ALARMING_EVENTS = new Set(['failed', 'cancelled', 'chat_failed_release'])

function eventLog(events: TaskEvent[]): LogLine[] {
  return events.map((event) => {
    const at = parse(event.created_at)
    return {
      at: at ? clockWithSeconds.format(at) : '',
      kind: event.event,
      text: event.detail.split('\n')[0] ?? '',
      alarming: ALARMING_EVENTS.has(event.event),
    }
  })
}

function ledgerStatus(task: Task): LedgerStatus {
  if (task.status === 'done') return 'done'
  if (task.status === 'dropped') return 'dropped'
  if (task.status === 'claimed' || task.active_session_id) return 'running'
  return 'waiting'
}

export function toReport(states: RoomState[], eventsByTask: Map<number, TaskEvent[]>): OvernightReport {
  const attention: { item: AttentionItem; sortKey: number }[] = []
  const ledger: LedgerEntry[] = []
  const stamps: Date[] = []

  for (const state of states) {
    const projectId = String(state.room.id)
    const agents = new Map(state.agents.map((agent) => [agent.id, agent]))
    for (const session of state.sessions) {
      for (const stamp of [parse(session.created_at), parse(session.finished_at)]) if (stamp) stamps.push(stamp)
    }

    // 사람이 멈췄거나 Jev가 멈춘 방
    if (state.room.paused || state.jev.action === 'stop') {
      attention.push({
        sortKey: Number.MAX_SAFE_INTEGER,
        item: {
          id: `room-${state.room.id}-stop`,
          at: '',
          projectId,
          kind: 'jev-stop',
          title: '자동 진행이 멈춤',
          detail: state.jev.reason,
          handoff: [],
          log: [],
          target: { roomId: state.room.id },
        },
      })
    }

    for (const task of state.tasks) {
      const sessions = workSessions(state, task.id)
      const last = latest(sessions)
      const events = eventsByTask.get(task.id) ?? []

      // 실패하거나 시간 초과로 다시 열린 할 일
      if (task.status === 'open' && last && (last.status === 'failed' || last.status === 'cancelled')) {
        const finished = parse(last.finished_at) ?? parse(last.created_at)
        const timedOut = /timeout|시간 초과/i.test(`${last.stop_reason ?? ''} ${last.summary}`)
        attention.push({
          sortKey: finished?.getTime() ?? 0,
          item: {
            id: `session-${last.id}`,
            at: hm(finished) ?? '',
            projectId,
            kind: timedOut ? 'timeout' : 'failed',
            title: timedOut ? '서브세션 시간 초과' : '서브세션 실패',
            detail: lines(last.summary)[0],
            agent: agentLabel(agents.get(last.agent_id)),
            task: { id: `#${task.id}`, title: task.title },
            handoff: lines(task.handoff || last.summary),
            log: eventLog(events),
            target: { roomId: state.room.id, taskId: task.id },
          },
        })
      }

      const first = [...sessions].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
      const owner = agents.get(task.owner_id ?? last?.agent_id ?? -1)
      ledger.push({
        taskId: `#${task.id}`,
        projectId,
        start: hm(parse(first?.created_at)),
        end: task.status === 'done' ? hm(parse(last?.finished_at)) : undefined,
        commit: task.commit_hash?.slice(0, 7) ?? undefined,
        title: task.title,
        agent: agentLabel(owner),
        status: ledgerStatus(task),
        handoff: lines(task.handoff),
        log: eventLog(events),
      })
    }

    // 사람의 마지막 메시지 뒤에 에이전트가 @로 사람을 부른 메시지
    const lastHuman = state.messages.findLast((message) => message.author === 'human')?.id ?? 0
    for (const message of state.messages) {
      if (message.id <= lastHuman || !message.author.startsWith('agent:') || !message.content.includes('@')) continue
      const agent = agents.get(Number(message.author.slice('agent:'.length)))
      const at = parse(message.created_at)
      attention.push({
        sortKey: at?.getTime() ?? 0,
        item: {
          id: `message-${message.id}`,
          at: hm(at) ?? '',
          projectId,
          kind: 'question',
          title: `${agent?.name ?? '에이전트'}의 질문`,
          detail: message.content,
          agent: agentLabel(agent),
          handoff: [],
          log: [],
          target: { roomId: state.room.id },
        },
      })
    }
  }

  stamps.sort((a, b) => a.getTime() - b.getTime())
  return {
    from: stamps[0] ? dayAndClock(stamps[0]) : undefined,
    to: stamps.at(-1) ? dayAndClock(stamps.at(-1)!) : undefined,
    projects: states.map((state) => ({ id: String(state.room.id), name: state.room.name })),
    attention: attention.sort((a, b) => a.sortKey - b.sortKey).map((entry) => entry.item),
    ledger,
  }
}
