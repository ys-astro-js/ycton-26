// 예시 데이터: 백엔드 API가 생기기 전까지 아침 리뷰 화면을 채우는 가짜 기록입니다.
// 실제 사용 기록이 아니며, 화면에는 '예시 데이터'로 표시됩니다.

export type ProjectId = 'afk-web' | 'payments-api' | 'docs-site'

export interface Project {
  id: ProjectId
  name: string
}

export interface LogLine {
  at: string
  kind: 'tool_call' | 'message' | 'plan' | 'timeout' | 'commit' | 'error'
  text: string
}

export type AttentionKind = 'jev-stop' | 'timeout' | 'question'

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
}

export type LedgerStatus = 'done' | 'running' | 'dropped'

export interface LedgerEntry {
  taskId: string
  projectId: ProjectId
  start: string
  end?: string
  commit?: string
  title: string
  agent?: string
  status: LedgerStatus
  note?: string
  handoff: string[]
  log: LogLine[]
}

export interface OvernightReport {
  from: string
  to: string
  projects: Project[]
  attention: AttentionItem[]
  ledger: LedgerEntry[]
  commitCount: number
  isSample: boolean
}

export const sampleReport: OvernightReport = {
  from: '11/20 23:40',
  to: '11/21 07:52',
  isSample: true,
  commitCount: 14,
  projects: [
    { id: 'afk-web', name: 'afk-web' },
    { id: 'payments-api', name: 'payments-api' },
    { id: 'docs-site', name: 'docs-site' },
  ],
  attention: [
    {
      id: 'a1',
      at: '03:12',
      projectId: 'payments-api',
      kind: 'jev-stop',
      title: 'Jev가 멈춤',
      detail: '에이전트 대화가 14턴째 진척 없음',
      handoff: [
        'backend와 qa가 재시도 정책을 두고 같은 주장을 반복함',
        '결정에 필요한 정보: 결제사 웹훅 재전송 간격',
        '사람이 정책을 정하면 바로 이어서 진행 가능',
      ],
      log: [
        { at: '02:58:41', kind: 'message', text: 'backend 재시도는 3회면 충분합니다' },
        { at: '03:04:10', kind: 'message', text: 'qa 결제사 문서상 5회까지 재전송됩니다' },
        { at: '03:12:00', kind: 'plan', text: 'jev stop 진척 없음 14턴' },
      ],
    },
    {
      id: 'a2',
      at: '04:47',
      projectId: 'afk-web',
      kind: 'timeout',
      title: '서브세션 #41 시간 초과(600초)',
      agent: 'frontend(Claude Code)',
      task: { id: 'T-41', title: '로그인 폼 검증' },
      handoff: ['폼 검증 스키마 작성 완료', 'e2e 테스트가 600초 넘게 걸려 중단됨', '다음 담당: 테스트를 나눠 실행 필요'],
      log: [
        { at: '04:37:12', kind: 'tool_call', text: 'bun test' },
        { at: '04:41:50', kind: 'message', text: '테스트 대기 중' },
        { at: '04:47:00', kind: 'timeout', text: 'session/cancel' },
      ],
    },
    {
      id: 'a3',
      at: '06:05',
      projectId: 'payments-api',
      kind: 'question',
      title: 'backend(Codex)의 질문',
      detail: '@정호 웹훅 재시도 횟수를 3회로 할까요, 5회로 할까요?',
      agent: 'backend(Codex)',
      handoff: ['T-12 웹훅 엔드포인트는 완료, 재시도 정책만 남음', '답을 받으면 T-13으로 이어서 구현'],
      log: [
        { at: '06:01:33', kind: 'tool_call', text: 'rg "retry" src/webhooks' },
        { at: '06:04:58', kind: 'plan', text: '정책 결정 전까지 T-13 보류' },
        { at: '06:05:02', kind: 'message', text: '@정호 재시도 횟수 질문' },
      ],
    },
  ],
  ledger: [
    {
      taskId: 'T-38',
      projectId: 'afk-web',
      start: '23:52',
      end: '00:31',
      commit: 'a1f3c9e',
      title: '로그인 화면 레이아웃',
      agent: 'frontend(Claude Code)',
      status: 'done',
      handoff: ['로그인 화면 레이아웃과 반응형 처리 완료', '폼 검증은 T-41로 분리'],
      log: [
        { at: '23:52:10', kind: 'plan', text: '레이아웃 먼저, 검증은 분리' },
        { at: '00:28:44', kind: 'tool_call', text: 'bun run build' },
        { at: '00:31:02', kind: 'commit', text: 'a1f3c9e feat: add login layout' },
      ],
    },
    {
      taskId: 'T-40',
      projectId: 'afk-web',
      start: '02:20',
      title: '세션 로그 스트리밍',
      agent: 'frontend(Claude Code)',
      status: 'running',
      handoff: ['WebSocket 구독까지 연결, 재연결 처리 중'],
      log: [
        { at: '02:20:05', kind: 'plan', text: 'session/update를 화면에 흘려보내기' },
        { at: '07:49:30', kind: 'tool_call', text: 'bun test src/stream' },
      ],
    },
    {
      taskId: 'T-12',
      projectId: 'payments-api',
      start: '00:10',
      end: '01:44',
      commit: '7be21d0',
      title: '결제 웹훅 엔드포인트',
      agent: 'backend(Codex)',
      status: 'done',
      handoff: ['서명 검증과 멱등 키 처리 포함', '재시도 정책은 사람 결정 대기'],
      log: [
        { at: '00:10:22', kind: 'plan', text: '엔드포인트, 서명 검증, 멱등 키' },
        { at: '01:40:15', kind: 'tool_call', text: 'uv run pytest tests/webhooks' },
        { at: '01:44:09', kind: 'commit', text: '7be21d0 feat: add payment webhook endpoint' },
      ],
    },
    {
      taskId: 'T-07',
      projectId: 'docs-site',
      start: '01:05',
      end: '01:39',
      commit: '4c90ab2',
      title: '설치 가이드 갱신',
      agent: 'docs(Gemini CLI)',
      status: 'done',
      handoff: ['uv와 bun 기준으로 설치 절차 갱신'],
      log: [
        { at: '01:05:40', kind: 'plan', text: '설치 가이드를 새 스택에 맞추기' },
        { at: '01:39:11', kind: 'commit', text: '4c90ab2 docs: update install guide' },
      ],
    },
    {
      taskId: 'T-09',
      projectId: 'docs-site',
      start: '05:30',
      title: 'FAQ 정리',
      status: 'dropped',
      note: '중복',
      handoff: ['T-07 설치 가이드와 내용이 겹쳐 내려놓음'],
      log: [{ at: '05:30:00', kind: 'plan', text: 'drop 중복: T-07에 포함됨' }],
    },
  ],
}
