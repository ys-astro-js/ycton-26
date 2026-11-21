import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus, Send } from 'lucide-react'
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

import { api, ApiError } from '@/api/client'
import { IconButton } from '@/components/icon-button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { ROOMS_KEY, roomKey, splitRequest, useRooms } from '../room/data.ts'

/**
 * 아침 리뷰와 프로젝트가 같이 쓰는 입력.
 * - 아침 리뷰: 프로젝트를 골라 할 일을 추가합니다(POST /api/rooms/{id}/tasks).
 * - 프로젝트: 메시지만 보냅니다(POST /api/rooms/{id}/messages). 그 프로젝트의 할 일은 할 일 목록에서 추가합니다.
 */
export function Composer({ roomId }: { roomId?: number }) {
  const global = roomId === undefined
  const { data: rooms = [] } = useRooms()
  const navigate = useNavigate()
  const client = useQueryClient()

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

  const assigning = global

  const send = useMutation({
    mutationFn: async ({ room, body, asTask }: { room: number; body: string; asTask: boolean }) => {
      if (!asTask) {
        await api.postMessage(room, body)
        return undefined
      }
      // 검증 프로필은 보내지 않습니다. 서버의 Jev가 담당과 함께 고릅니다.
      const { title: taskTitle, detail } = splitRequest(body)
      return api.createTask(room, { title: taskTitle, detail })
    },
    onSuccess: async (task, { room }) => {
      setText('')
      await Promise.all([
        client.invalidateQueries({ queryKey: roomKey(room) }),
        client.invalidateQueries({ queryKey: ROOMS_KEY }),
        client.invalidateQueries({ queryKey: ['overnight-report'] }),
      ])
      if (!task) return
      navigate({ to: '/rooms/$roomId', params: { roomId: String(room) }, search: { focus: task.id } })
    },
  })

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const room = roomId ?? Number(target)
    const next = { room: !room, text: !text.trim() }
    setInvalid(next)
    if (next.room) return roomSelectRef.current?.focus()
    if (next.text) return textRef.current?.focus()
    if (send.isPending) return
    send.mutate({ room, body: text.trim(), asTask: assigning })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event)
  }

  return (
    <form noValidate onSubmit={submit} className="grid gap-3">
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

        <IconButton type="submit" icon={assigning ? Plus : Send} label={assigning ? '할 일 추가' : '보내기'}
          disabled={send.isPending} />
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
