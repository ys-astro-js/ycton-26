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

/** 서버 설정에 정의된 모델 제공자. 사람은 이 안의 모델과 추론 수준만 고릅니다 */
export interface ModelProvider {
  id: string
  label: string
  models: string[]
  efforts: string[]
  /** 어댑터가 알려 준 모델 표시 이름(opus → Opus 5.5). 서버가 아직 받지 못했거나 mock이면 비어 있습니다 */
  model_labels?: Record<string, string>
}

/** 모델 값을 사람이 읽는 이름으로 바꿉니다. 이름을 모르면 값을 그대로 씁니다 */
export function modelLabel(providers: ModelProvider[] | undefined, provider: string, model: string) {
  return providers?.find((p) => p.id === provider)?.model_labels?.[model] ?? model
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
  repository_id: string
  /** 폴더 선택으로 연결한 Git 저장소의 절대 경로. 있으면 repository_id(빈 문자열) 대신 이 폴더를 씁니다 */
  repo: string | null
  paused: number
  chat_rounds: number
}

/** 서버 컴퓨터의 폴더 선택 창에서 고른 Git 저장소. 취소하면 둘 다 null입니다 */
export interface PickedFolder {
  path: string | null
  name: string | null
}

export interface RuntimeRepositoryOption {
  id: string
  label: string
  verification_profiles: string[]
  default_verification_profile: string
}

export interface RuntimeOptions {
  mode: 'acp' | 'mock'
  agent_kinds: string[]
  default_agent_kind: string
  default_repository_id: string | null
  repositories: RuntimeRepositoryOption[]
  /** 폴더 선택으로 연결한 프로젝트가 쓸 수 있는 검증 프로필 */
  folder: Pick<RuntimeRepositoryOption, 'verification_profiles' | 'default_verification_profile'>
}

export interface Agent {
  id: number
  room_id: number
  name: string
  kind: string
  model: string
  effort: string
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
  retry_required: 0 | 1
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

/** 프로젝트 저장소의 현재 브랜치와 origin 원격(host/경로). 실제 폴더가 없는 mock 기본 저장소는 null입니다 */
export interface GitInfo {
  branch: string | null
  remote: string | null
}

export interface RoomState {
  room: Room
  git: GitInfo | null
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
  runtimeOptions: () => request<RuntimeOptions>('/api/runtime/options'),
  rooms: () => request<Room[]>('/api/rooms'),
  roomState: (roomId: number) => request<RoomState>(`/api/rooms/${roomId}/state`),
  taskEvents: (taskId: number) => request<TaskEvent[]>(`/api/tasks/${taskId}/events`),
  resume: (roomId: number) => request<Room>(`/api/rooms/${roomId}/resume`, { method: 'POST' }),
  pause: (roomId: number) => request<Room>(`/api/rooms/${roomId}/pause`, { method: 'POST' }),
  retry: (taskId: number, note: string) => request<Task>(`/api/tasks/${taskId}/retry`, { method: 'POST', body: { note } }),
  postMessage: (roomId: number, content: string) =>
    request<{ ok: boolean }>(`/api/rooms/${roomId}/messages`, { method: 'POST', body: { content } }),
  agentModels: () => request<ModelProvider[]>('/api/agent-models'),
  /** 경로를 입력받지 않고, 서버가 띄운 OS 폴더 선택 창에서 고른 결과만 씁니다 */
  pickFolder: () => request<PickedFolder>('/api/folders/pick', { method: 'POST' }),
  /** 설정 저장소(repository_id) 또는 고른 폴더(repo) 가운데 하나로 만듭니다 */
  createRoom: (body: { name: string; repository_id: string } | { name: string; repo: string }) =>
    request<Room>('/api/rooms', { method: 'POST', body }),
  addAgent: (roomId: number, agent: { name: string; kind: string; model: string; effort: string; good_at: string[] }) =>
    request<Agent>(`/api/rooms/${roomId}/agents`, { method: 'POST', body: agent }),
  /** verify는 이 프로젝트에서 허용된 검증 프로필 이름이어야 합니다 */
  createTask: (roomId: number, task: { title: string; detail: string; scope: string; verify: string }) =>
    request<Task>(`/api/rooms/${roomId}/tasks`, { method: 'POST', body: task }),
  drop: (taskId: number, note: string) => request<Task>(`/api/tasks/${taskId}/drop`, { method: 'POST', body: { note } }),
  session: (sessionId: string) => request<Session>(`/api/sessions/${sessionId}`),
  cancel: (sessionId: string) => request<Session>(`/api/sessions/${sessionId}/cancel`, { method: 'POST' }),
}
