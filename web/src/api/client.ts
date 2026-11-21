// 오케스트레이션 서버(FastAPI)의 사람용 API 클라이언트입니다.
// 주소는 VITE_API_URL로 주입합니다. 비우면 같은 출처의 /api를 쓰고, 개발 서버는 이를 백엔드로 프록시합니다.

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      method: init?.method ?? 'GET',
      headers: { 'X-Orch-Client': 'web', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다', 0)
  }
  if (!response.ok) {
    const detail = await response
      .json()
      .then((data: { detail?: unknown }) => (typeof data.detail === 'string' ? data.detail : null))
      .catch(() => null)
    // 개발 프록시는 백엔드가 꺼져 있으면 본문 없는 500을 돌려줍니다
    const fallback = response.status >= 500 ? '서버에 연결할 수 없습니다' : `요청에 실패했습니다 (${response.status})`
    throw new ApiError(detail ?? fallback, response.status)
  }
  return (await response.json()) as T
}

// ----- 백엔드 응답 모양 (src/ycton/orchestration/db.py) -----

export interface Room {
  id: number
  name: string
  paused: number
  chat_rounds: number
}

export interface Agent {
  id: number
  room_id: number
  name: string
  kind: string
  good_at: string[]
}

export type TaskStatus = 'open' | 'claimed' | 'done' | 'dropped'

export interface Task {
  id: number
  room_id: number
  title: string
  detail: string
  scope: string
  verify: string
  status: TaskStatus
  owner_id: number | null
  active_session_id: string | null
  attempts: number
  handoff: string
  commit_hash: string | null
}

export interface Session {
  id: string
  room_id: number
  agent_id: number
  task_id: number | null
  kind: 'chat' | 'work'
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  instruction: string
  summary: string
  verification: string
  commit_hash: string | null
  stop_reason: string | null
  verification_output: string | null
  latest_event: string | null
  created_at: string
  finished_at: string | null
}

export interface Message {
  id: number
  room_id: number
  author: string
  content: string
  created_at: string
}

export interface Jev {
  action: 'stop' | 'wait' | 'go' | 'spawn_suggested'
  reason: string
}

export interface RoomState {
  room: Room
  agents: Agent[]
  tasks: Task[]
  sessions: Session[]
  messages: Message[]
  jev: Jev
  mode: string
}

export interface TaskEvent {
  id: number
  task_id: number
  event: string
  detail: string
  created_at: string
}

export const api = {
  rooms: () => request<Room[]>('/api/rooms'),
  roomState: (roomId: number) => request<RoomState>(`/api/rooms/${roomId}/state`),
  taskEvents: (taskId: number) => request<TaskEvent[]>(`/api/tasks/${taskId}/events`),
  resume: (roomId: number) => request<Room>(`/api/rooms/${roomId}/resume`, { method: 'POST' }),
  pause: (roomId: number) => request<Room>(`/api/rooms/${roomId}/pause`, { method: 'POST' }),
  retry: (taskId: number, note: string) => request<Task>(`/api/tasks/${taskId}/retry`, { method: 'POST', body: { note } }),
  postMessage: (roomId: number, content: string) =>
    request<{ ok: boolean }>(`/api/rooms/${roomId}/messages`, { method: 'POST', body: { content } }),
  createRoom: (name: string) => request<Room>('/api/rooms', { method: 'POST', body: { name } }),
  addAgent: (roomId: number, agent: { name: string; kind: string; good_at: string[] }) =>
    request<Agent>(`/api/rooms/${roomId}/agents`, { method: 'POST', body: agent }),
  /** verify는 acp 모드에서 서버에 등록된 검증 프로필 이름이어야 합니다 */
  createTask: (roomId: number, task: { title: string; detail: string; scope: string; verify: string }) =>
    request<Task>(`/api/rooms/${roomId}/tasks`, { method: 'POST', body: task }),
  drop: (taskId: number, note: string) => request<Task>(`/api/tasks/${taskId}/drop`, { method: 'POST', body: { note } }),
  session: (sessionId: string) => request<Session>(`/api/sessions/${sessionId}`),
  cancel: (sessionId: string) => request<Session>(`/api/sessions/${sessionId}/cancel`, { method: 'POST' }),
}
