// 아침 리뷰 화면이 쓰는 뷰 모델입니다. 백엔드 응답은 adapter.ts가 이 모양으로 바꿉니다.

/** 프로젝트 = 백엔드의 방(room). 경로 검색어에는 방 id를 문자열로 씁니다. */
export type ProjectId = string

export interface Project {
  id: ProjectId
  name: string
}

export interface LogLine {
  at: string
  kind: string
  text: string
  alarming?: boolean
}

export type AttentionKind = 'jev-stop' | 'timeout' | 'failed' | 'held' | 'question'

export interface AttentionItem {
  id: string
  at: string
  projectId: ProjectId
  kind: AttentionKind
  title: string
  detail?: string
  agent?: string
  task?: { id: string; title: string }
  handoff: string[]
  log: LogLine[]
  /** 백엔드에 보낼 대상 */
  target: { roomId: number; taskId?: number }
}

export type LedgerStatus = 'done' | 'running' | 'waiting' | 'failed' | 'held' | 'dropped'

export interface LedgerEntry {
  taskId: string
  projectId: ProjectId
  start?: string
  end?: string
  commit?: string
  title: string
  agent?: string
  status: LedgerStatus
  handoff: string[]
  log: LogLine[]
}

export interface OvernightReport {
  from?: string
  to?: string
  projects: Project[]
  attention: AttentionItem[]
  ledger: LedgerEntry[]
}
