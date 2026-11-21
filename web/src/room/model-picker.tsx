import { useId, useState, type ReactNode } from 'react'

import type { ModelProvider } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface ModelChoice {
  provider: string
  model: string
  effort: string
}

/** 고른 값을 한 줄로 씁니다. 제공자 이름, 모델, 추론 수준 순서입니다. */
export function describeChoice(choice: ModelChoice, providers: ModelProvider[]) {
  const provider = providers.find((candidate) => candidate.id === choice.provider)
  return [provider?.label ?? choice.provider, choice.model, choice.effort].filter(Boolean).join(' · ')
}

/**
 * 모델 제공자, 모델, 추론 수준을 왼쪽에서 오른쪽으로 한 열씩 고릅니다.
 * 앞 열을 고르면 다음 열이 열리고, 마지막 열을 고르면 선택이 끝나 닫힙니다.
 */
export function ModelPicker({
  id,
  providers,
  value,
  invalid,
  describedBy,
  disabled,
  onChange,
}: {
  id: string
  providers: ModelProvider[]
  value: ModelChoice | null
  invalid?: boolean
  describedBy?: string
  disabled?: boolean
  onChange: (choice: ModelChoice) => void
}) {
  const [open, setOpen] = useState(false)
  const [providerId, setProviderId] = useState(value?.provider ?? '')
  const [model, setModel] = useState(value?.model ?? '')
  const provider = providers.find((candidate) => candidate.id === providerId)

  const finish = (choice: ModelChoice) => {
    onChange(choice)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // 다시 열면 지금 고른 값에서 시작합니다
        if (next) {
          setProviderId(value?.provider ?? '')
          setModel(value?.model ?? '')
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn(
              'h-10 w-full justify-start px-3 text-body font-normal tracking-normal normal-case',
              !value && 'text-muted-foreground',
            )}
          />
        }
      >
        <span className="min-w-0 truncate">{value ? describeChoice(value, providers) : '모델 선택'}</span>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-auto flex-row gap-0 p-0">
        <Column title="제공자">
          {providers.map((candidate) => (
            <Option
              key={candidate.id}
              selected={candidate.id === providerId}
              onSelect={() => {
                setProviderId(candidate.id)
                setModel('')
              }}
            >
              {candidate.label}
            </Option>
          ))}
        </Column>
        {provider ? (
          <Column title="모델">
            {provider.models.map((candidate) => (
              <Option
                key={candidate}
                mono
                selected={candidate === model}
                onSelect={() => {
                  if (provider.efforts.length === 0) finish({ provider: provider.id, model: candidate, effort: '' })
                  else setModel(candidate)
                }}
              >
                {candidate}
              </Option>
            ))}
          </Column>
        ) : null}
        {provider && model && provider.efforts.length > 0 ? (
          <Column title="추론 수준">
            {provider.efforts.map((candidate) => (
              <Option
                key={candidate}
                selected={value?.provider === provider.id && value.model === model && value.effort === candidate}
                onSelect={() => finish({ provider: provider.id, model, effort: candidate })}
              >
                {candidate}
              </Option>
            ))}
          </Column>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <div role="group" aria-labelledby={headingId} className="grid w-44 content-start gap-0.5 border-e p-1.5 last:border-e-0">
      <p id={headingId} className="px-2 pt-1 pb-1.5 text-label font-semibold text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  )
}

function Option({
  selected,
  mono,
  onSelect,
  children,
}: {
  selected: boolean
  mono?: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'h-9 w-full justify-start px-2 text-body font-normal tracking-normal normal-case',
        mono && 'font-mono text-label',
        selected && 'bg-muted font-semibold',
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
    </Button>
  )
}
