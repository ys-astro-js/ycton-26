import type { LucideIcon } from 'lucide-react'
import type { ComponentProps } from 'react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type IconButtonProps = Omit<ComponentProps<typeof Button>, 'children' | 'size'> & {
  /** 접근성 이름이자 툴팁 문구. 동작을 동사로 씁니다. */
  label: string
  icon: LucideIcon
  size?: 'icon' | 'icon-sm' | 'icon-xs' | 'icon-lg'
}

/**
 * 아이콘만으로 뜻이 통하는 동작의 버튼입니다.
 * 요청이 도는 동안 disabled가 되어도 포커스를 잃지 않도록 기본으로 focusableWhenDisabled를 켭니다.
 * 버튼은 아이콘 전용 또는 글자 전용 중 하나만 씁니다. 아이콘과 글자를 함께 넣지 않습니다.
 */
export function IconButton({
  label,
  icon: Icon,
  size = 'icon-sm',
  focusableWhenDisabled = true,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size={size}
            aria-label={label}
            focusableWhenDisabled={focusableWhenDisabled}
            {...props}
          >
            <Icon aria-hidden="true" strokeWidth={1.75} />
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
