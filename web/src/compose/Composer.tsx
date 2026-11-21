import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Send } from 'lucide-react'
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

import { api, ApiError } from '@/api/client'
import { IconButton } from '@/components/icon-button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

import { ROOMS_KEY, roomKey, splitRequest, useRooms } from '../room/data.ts'

type Intent = 'say' | 'assign'

const LABEL = 'text-xs font-normal text-muted-foreground'

/** 검증 프로필 목록을 주는 API가 없어, runtime.example.toml의 [verify.unit]을 기본값으로 씁니다 */
const DEFAULT_VERIFY = 'unit'

/**
 * 새 일을 맡기는 입력. 아침 리뷰(어느 방에 맡길지 고름)와 채팅방(그 방의 입력창)이 같이 씁니다.
 * - 말하기: POST /api/rooms/{id}/messages. 에이전트가 대화로 답합니다.
 * - 맡기기: POST /api/rooms/{id}/tasks. 에이전트는 할 일을 만들 수 없으므로 실제 작업은 이 경로로만 시작됩니다.
 */
export function Composer({ roomId, onAssigned }: { roomId?: number; onAssigned?: (taskId: number) => void }) {
  const global = roomId === undefined
  const { data: rooms = [] } = useRooms()
  const navigate = useNavigate()
  const client = useQueryClient()

  const [intent, setIntent] = useState<Intent>(global ? 'assign' : 'say')
  const [target, setTarget] = useState(roomId !== undefined ? String(roomId) : '')
  const [verify, setVerify] = useState(DEFAULT_VERIFY)
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState<{ room?: boolean; text?: boolean; verify?: boolean }>({})
  // 아침 리뷰에서는 처리 필요를 밀어내지 않도록 입력 한 줄만 두고, 쓰기 시작하면 방과 검증을 펼칩니다
  const [engaged, setEngaged] = useState(false)

  const textRef = useRef<HTMLTextAreaElement>(null)
  const roomSelectRef = useRef<HTMLSelectElement>(null)
  const verifyRef = useRef<HTMLInputElement>(null)
  const ids = {
    room: useId(),
    verify: useId(),
    text: useId(),
    textError: useId(),
    roomError: useId(),
    verifyError: useId(),
    title: useId(),
    server: useId(),
  }

  const assigning = intent === 'assign'
  const { title } = splitRequest(text)
  const showFields = global ? engaged || text.length > 0 || Boolean(invalid.room) : assigning

  const send = useMutation({
    mutationFn: async ({ room, body, asTask }: { room: number; body: string; asTask: boolean }) => {
      if (!asTask) {
        await api.postMessage(room, body)
        return undefined
      }
      const { title: taskTitle, detail } = splitRequest(body)
      return api.createTask(room, { title: taskTitle, detail, scope: '', verify: verify.trim() })
    },
    onSuccess: async (task, { room }) => {
      setText('')
      await Promise.all([
        client.invalidateQueries({ queryKey: roomKey(room) }),
        client.invalidateQueries({ queryKey: ROOMS_KEY }),
        client.invalidateQueries({ queryKey: ['overnight-report'] }),
      ])
      if (!task) return
      if (global) navigate({ to: '/rooms/$roomId', params: { roomId: String(room) }, search: { focus: task.id } })
      else onAssigned?.(task.id)
    },
  })

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const room = roomId ?? Number(target)
    const next = { room: !room, text: !text.trim(), verify: assigning && !verify.trim() }
    setInvalid(next)
    if (next.room) return roomSelectRef.current?.focus()
    if (next.text) return textRef.current?.focus()
    if (next.verify) return verifyRef.current?.focus()
    send.mutate({ room, body: text.trim(), asTask: assigning })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      className="grid gap-3"
      onFocus={() => setEngaged(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !text) setEngaged(false)
      }}
    >
      {global ? null : (
        <ToggleGroup
          aria-label="보내는 방식"
          spacing={0}
          variant="outline"
          size="sm"
          value={[intent]}
          onValueChange={(value) => {
            if (value[0] === 'say' || value[0] === 'assign') setIntent(value[0])
          }}
        >
          <ToggleGroupItem value="say" className="h-8 px-3! text-[0.8125rem] tracking-normal normal-case">
            말하기
          </ToggleGroupItem>
          <ToggleGroupItem value="assign" className="h-8 px-3! text-[0.8125rem] tracking-normal normal-case">
            할 일로 맡기기
          </ToggleGroupItem>
        </ToggleGroup>
      )}

      <Field data-invalid={invalid.text || undefined} className="gap-0">
        <FieldLabel htmlFor={ids.text} className={cn(LABEL, !global && !assigning && 'sr-only')}>
          {assigning ? '요청' : '메시지'}
        </FieldLabel>
        <div className="flex items-end gap-3">
          <Textarea
            ref={textRef}
            id={ids.text}
            rows={1}
            value={text}
            placeholder={
              assigning
                ? showFields
                  ? '로그인 화면에 다크 모드 추가\n토글은 헤더 오른쪽, 시스템 설정을 따름'
                  : '맡길 일 쓰기'
                : '메시지 보내기'
            }
            aria-invalid={invalid.text || undefined}
            aria-describedby={cn(invalid.text && ids.textError, assigning && title && ids.title, send.error && ids.server) || undefined}
            className={cn('max-h-64 text-base md:text-[0.9375rem]', assigning && showFields ? 'min-h-16' : 'min-h-10 py-2')}
            onKeyDown={onKeyDown}
            onChange={(event) => {
              setText(event.target.value)
              if (invalid.text) setInvalid((current) => ({ ...current, text: false }))
            }}
          />
          <IconButton type="submit" icon={Send} label={assigning ? '맡기기' : '말하기'} disabled={send.isPending} />
        </div>
        {invalid.text ? (
          <FieldError id={ids.textError}>{assigning ? '맡길 일을 입력하세요.' : '보낼 메시지를 입력하세요.'}</FieldError>
        ) : null}
      </Field>

      {showFields ? (
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {global ? (
            <Field data-invalid={invalid.room || undefined} className="w-full gap-0 sm:w-56">
              <FieldLabel htmlFor={ids.room} className={LABEL}>
                채팅방
              </FieldLabel>
              <NativeSelect
                ref={roomSelectRef}
                id={ids.room}
                className="w-full"
                value={target}
                aria-invalid={invalid.room || undefined}
                aria-describedby={invalid.room ? ids.roomError : undefined}
                onChange={(event) => {
                  setTarget(event.target.value)
                  setInvalid((current) => ({ ...current, room: false }))
                }}
              >
                <NativeSelectOption value="" disabled>
                  맡길 방 고르기
                </NativeSelectOption>
                {rooms.map((room) => (
                  <NativeSelectOption key={room.id} value={room.id}>
                    {room.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {invalid.room ? <FieldError id={ids.roomError}>맡길 채팅방을 고르세요.</FieldError> : null}
            </Field>
          ) : null}
          <Field data-invalid={invalid.verify || undefined} className="w-full gap-0 sm:w-40">
            <FieldLabel htmlFor={ids.verify} className={LABEL}>
              검증 프로필
            </FieldLabel>
            <Input
              ref={verifyRef}
              id={ids.verify}
              value={verify}
              className="font-mono"
              aria-invalid={invalid.verify || undefined}
              aria-describedby={invalid.verify ? ids.verifyError : undefined}
              onChange={(event) => {
                setVerify(event.target.value)
                setInvalid((current) => ({ ...current, verify: false }))
              }}
            />
            {invalid.verify ? <FieldError id={ids.verifyError}>검증 프로필 이름을 입력하세요.</FieldError> : null}
          </Field>
        </div>
      ) : null}

      {assigning && title ? (
        <dl id={ids.title} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-[0.8125rem]">
          <dt className="text-muted-foreground">할 일 제목</dt>
          <dd className="min-w-0 truncate">{title}</dd>
        </dl>
      ) : null}

      {send.error ? (
        <p id={ids.server} role="alert" className="text-[0.8125rem] text-destructive">
          {send.error instanceof ApiError ? send.error.message : '보내지 못했습니다'}
        </p>
      ) : null}
    </form>
  )
}
