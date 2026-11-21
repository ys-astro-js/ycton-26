import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ListTodo, MessageSquare, Plus, Send, type LucideIcon } from 'lucide-react'
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

import { api, ApiError } from '@/api/client'
import { IconButton } from '@/components/icon-button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { ROOMS_KEY, roomKey, splitRequest, useRooms } from '../room/data.ts'

type Intent = 'say' | 'assign'

/** 버튼 규칙(아이콘 또는 글자 하나만)에 따라 입력 종류도 아이콘 토글로 두고, 이름은 aria-label과 툴팁이 전합니다 */
const INTENTS: { value: Intent; icon: LucideIcon; label: string }[] = [
  { value: 'say', icon: MessageSquare, label: '메시지 보내기' },
  { value: 'assign', icon: ListTodo, label: '할 일 추가하기' },
]

/**
 * 할 일마다 서버에 등록된 검증 프로필 이름을 보내야 합니다.
 * 사람이 고를 일이 아니고 목록을 주는 API도 없어, runtime.example.toml의 [verify.unit]을 늘 씁니다.
 */
const VERIFY_PROFILE = 'unit'

/**
 * 메시지를 보내거나 할 일을 추가하는 입력. 아침 리뷰(프로젝트를 고름)와 프로젝트(그 방의 입력창)이 같이 씁니다.
 * - 메시지: POST /api/rooms/{id}/messages. 에이전트가 대화로 답합니다.
 * - 할 일: POST /api/rooms/{id}/tasks. 에이전트는 할 일을 만들 수 없으므로 실제 작업은 이 경로로만 시작됩니다.
 */
export function Composer({ roomId, onAssigned }: { roomId?: number; onAssigned?: (taskId: number) => void }) {
  const global = roomId === undefined
  const { data: rooms = [] } = useRooms()
  const navigate = useNavigate()
  const client = useQueryClient()

  const [intent, setIntent] = useState<Intent>(global ? 'assign' : 'say')
  const [target, setTarget] = useState(roomId !== undefined ? String(roomId) : '')
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState<{ room?: boolean; text?: boolean }>({})

  const textRef = useRef<HTMLTextAreaElement>(null)
  const roomSelectRef = useRef<HTMLSelectElement>(null)
  const ids = {
    room: useId(),
    text: useId(),
    textError: useId(),
    roomError: useId(),
    server: useId(),
  }

  const assigning = intent === 'assign'

  const send = useMutation({
    mutationFn: async ({ room, body, asTask }: { room: number; body: string; asTask: boolean }) => {
      if (!asTask) {
        await api.postMessage(room, body)
        return undefined
      }
      const { title: taskTitle, detail } = splitRequest(body)
      return api.createTask(room, { title: taskTitle, detail, scope: '', verify: VERIFY_PROFILE })
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
    const next = { room: !room, text: !text.trim() }
    setInvalid(next)
    if (next.room) return roomSelectRef.current?.focus()
    if (next.text) return textRef.current?.focus()
    send.mutate({ room, body: text.trim(), asTask: assigning })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
  }

  return (
    <form noValidate onSubmit={submit} className="grid gap-3">
      {global ? null : (
        <ToggleGroup
          aria-label="입력 종류"
          spacing={0}
          variant="outline"
          size="sm"
          value={[intent]}
          onValueChange={(value) => {
            if (value[0] === 'say' || value[0] === 'assign') setIntent(value[0])
          }}
        >
          {INTENTS.map(({ value, icon: Icon, label }) => (
            <Tooltip key={value}>
              <TooltipTrigger
                render={
                  <ToggleGroupItem value={value} aria-label={label} className="size-8 px-0!">
                    <Icon aria-hidden="true" strokeWidth={1.75} className="size-4" />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
      )}

      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <Field data-invalid={invalid.text || undefined} className="min-w-0 flex-1 basis-48 gap-0">
          <FieldLabel htmlFor={ids.text} className="sr-only">
            {assigning ? '할 일' : '메시지'}
          </FieldLabel>
          <Textarea
            ref={textRef}
            id={ids.text}
            rows={1}
            value={text}
            placeholder={assigning ? '할 일' : '메시지'}
            aria-invalid={invalid.text || undefined}
            aria-describedby={cn(invalid.text && ids.textError, send.error && ids.server) || undefined}
            className="max-h-64 min-h-10 py-2 text-base md:text-body"
            onKeyDown={onKeyDown}
            onChange={(event) => {
              setText(event.target.value)
              if (invalid.text) setInvalid((current) => ({ ...current, text: false }))
            }}
          />
        </Field>

        {global ? (
          <Field data-invalid={invalid.room || undefined} className="min-w-0 flex-1 basis-40 gap-0 sm:w-44 sm:flex-none sm:basis-auto">
            <FieldLabel htmlFor={ids.room} className="sr-only">
              프로젝트
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
                프로젝트 선택
              </NativeSelectOption>
              {rooms.map((room) => (
                <NativeSelectOption key={room.id} value={room.id}>
                  {room.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        <IconButton type="submit" icon={assigning ? Plus : Send} label={assigning ? '할 일 추가' : '보내기'} disabled={send.isPending} />
      </div>

      {invalid.room ? <FieldError id={ids.roomError}>프로젝트를 선택하세요.</FieldError> : null}
      {invalid.text ? (
        <FieldError id={ids.textError}>{assigning ? '할 일을 입력하세요.' : '메시지를 입력하세요.'}</FieldError>
      ) : null}


      {send.error ? (
        <p id={ids.server} role="alert" className="text-label text-destructive">
          {send.error instanceof ApiError ? send.error.message : '보내지 못했습니다'}. 잠시 후 다시 시도하세요.
        </p>
      ) : null}
    </form>
  )
}
