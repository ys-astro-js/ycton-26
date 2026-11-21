// 프로젝트 화면이 쓰는 조회와 변경. 모든 요청은 api/client.ts 한 곳을 거칩니다.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, type Message, type Room, type RoomState, type Session, type Task, type TaskEvent } from '@/api/client'

import type { LedgerStatus } from '../review/model.ts'

export const ROOMS_KEY = ['rooms'] as const
export const roomKey = (roomId: number) => ['room', roomId] as const
const eventsKey = (taskId: number) => ['task-events', taskId] as const

/** 아침 리뷰 리포트도 방 상태로 만들므로, 방을 바꾸면 리포트도 다시 읽게 합니다 */
const REPORT_KEY = ['overnight-report']

export function useRooms() {
  return useQuery({ queryKey: ROOMS_KEY, queryFn: api.rooms, refetchInterval: 5000, retry: 1 })
}

/** 에이전트 추가 팝오버가 열릴 때마다 서버의 모델 목록을 다시 읽습니다. 실패하면 같은 요청을 되풀이하지 않습니다. */
export function useAgentModels() {
  return useQuery({ queryKey: ['agent-models'], queryFn: api.agentModels, retry: false })
}

export function useRuntimeOptions(enabled = true) {
  return useQuery({ queryKey: ['runtime-options'], queryFn: api.runtimeOptions, enabled, retry: 1 })
}

/**
 * 할 일에 붙일 검증 프로필. 사람이 고르지 않고 프로젝트의 기본값을 씁니다.
 * 고른 폴더에 연결한 프로젝트는 서버가 폴더용으로 정한 기본값을 씁니다.
 */
export function useVerificationProfile(room: Pick<Room, 'repository_id' | 'repo'> | undefined, enabled = true) {
  const options = useRuntimeOptions(enabled)
  const repositoryId = room?.repo ? undefined : room?.repository_id
  const repository = options.isError ? undefined
    : room?.repo ? options.data?.folder
    : options.data?.repositories.find(({ id }) => id === repositoryId)
  const verify = repository?.default_verification_profile
  const error = options.isError ? '실행 설정을 불러오지 못했습니다'
    : options.data && repositoryId && !repository ? '서버 설정에 없는 저장소입니다'
    : undefined
  return { verify, error }
}

/** 서버에 실시간 채널이 없어 1초마다 방 상태를 다시 읽습니다 */
export function useRoomState(roomId: number) {
  return useQuery<RoomState>({
    queryKey: roomKey(roomId),
    queryFn: () => api.roomState(roomId),
    refetchInterval: 1000,
    retry: 1,
  })
}

export function useTaskEvents(taskId: number, enabled: boolean) {
  return useQuery<TaskEvent[]>({
    queryKey: eventsKey(taskId),
    queryFn: () => api.taskEvents(taskId),
    enabled,
    refetchInterval: enabled ? 3000 : false,
  })
}

/** 방 하나를 바꾸는 요청. 끝나면 그 방과 리포트를 다시 읽습니다. */
export function useRoomMutation<TInput, TResult>(roomId: number, run: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: roomKey(roomId) }),
        client.invalidateQueries({ queryKey: ROOMS_KEY }),
        client.invalidateQueries({ queryKey: REPORT_KEY }),
      ])
    },
  })
}

// ----- 표시용 변환 -----

/** 백엔드 시각은 시간대 없는 UTC("2026-11-21 04:05:01")입니다 */
export function parseTime(value: string | null | undefined) {
  if (!value) return undefined
  const date = new Date(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const clockFormat = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export const clock = (value: string | null | undefined) => {
  const date = parseTime(value)
  return date ? clockFormat.format(date) : ''
}

export type TaskPhase = LedgerStatus

export function workSessions(state: RoomState, taskId: number) {
  return state.sessions
    .filter((session) => session.kind === 'work' && session.task_id === taskId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

export function taskPhase(task: Task, state: RoomState): TaskPhase {
  if (task.status === 'done') return 'done'
  if (task.status === 'dropped') return 'dropped'
  if (task.active_session_id) return 'running'
  if (task.status === 'open') {
    if (task.retry_required) return 'held'
    if (task.attempts > 0) {
      const last = workSessions(state, task.id).at(-1)
      if (last?.status === 'failed' || last?.status === 'cancelled') return 'failed'
    }
  }
  return 'waiting'
}

export function isLive(state: RoomState) {
  return state.sessions.some((session) => session.kind === 'work' && (session.status === 'queued' || session.status === 'running'))
}

export function lines(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

// ----- 메시지 해석 -----

export type TimelineEntry =
  | { type: 'human'; message: Message }
  | { type: 'agent'; message: Message; agentId: number }
  | { type: 'system'; message: Message; taskId?: number }
  | {
      type: 'result'
      message: Message
      taskId: number
      outcome: 'succeeded' | 'failed' | 'cancelled'
      summary: string[]
      session?: Session
    }

const RESULT = /^할 일 #(\d+) (succeeded|failed|cancelled): ([\s\S]*)$/
const TASK_REF = /#(\d+)/

/**
 * 메시지 author는 "human", "agent:<id>", "system" 세 가지입니다.
 * 작업 결과는 "할 일 #n <status>: <요약>" 형식의 system 메시지로만 남으므로 이 형식을 결과 행으로 바꿉니다.
 */
export function toTimeline(state: RoomState): TimelineEntry[] {
  return state.messages.map((message) => {
    if (message.author === 'human') return { type: 'human', message }
    if (message.author.startsWith('agent:')) {
      return { type: 'agent', message, agentId: Number(message.author.slice('agent:'.length)) }
    }
    const result = RESULT.exec(message.content)
    if (result) {
      const taskId = Number(result[1])
      const outcome = result[2] as 'succeeded' | 'failed' | 'cancelled'
      // 결과 메시지와 같은 결과로 끝난, 메시지보다 먼저 끝난 마지막 작업 세션을 짝지어 검증 결과를 붙입니다
      const session = workSessions(state, taskId)
        .filter((s) => s.status === outcome && (s.finished_at ?? '') <= message.created_at)
        .at(-1)
      return {
        type: 'result',
        message,
        taskId,
        outcome,
        summary: lines(result[3] ?? '').filter((line) => !line.startsWith('worktree=')),
        session,
      }
    }
    const ref = TASK_REF.exec(message.content)
    return { type: 'system', message, taskId: ref ? Number(ref[1]) : undefined }
  })
}

/** 할 일은 첫 줄이 제목, 나머지가 상세입니다 */
export function splitRequest(text: string) {
  const [first = '', ...rest] = text.trim().split('\n')
  return { title: first.trim().slice(0, 200), detail: rest.join('\n').trim() }
}
