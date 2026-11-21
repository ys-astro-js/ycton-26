import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const CLAMP = { 1: 'line-clamp-1', 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4' } as const

/**
 * 긴 글을 몇 줄까지만 보여 주고, 넘칠 때만 글자 버튼으로 전체를 펼칩니다.
 * 넘치지 않으면 버튼을 두지 않아 짧은 글의 자리는 그대로입니다.
 */
export function Clamp({ lines, className, children }: { lines: keyof typeof CLAMP; className?: string; children: ReactNode }) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element || open) return
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [open])

  return (
    <div className="grid min-w-0 justify-items-start gap-1">
      <div ref={ref} id={id} className={cn('w-full min-w-0', !open && CLAMP[lines], className)}>
        {children}
      </div>
      {overflows || open ? (
        <Button
          variant="link"
          size="xs"
          aria-expanded={open}
          aria-controls={id}
          className="h-6 px-0 text-label font-normal tracking-normal text-muted-foreground normal-case hover:text-foreground"
          onClick={() => setOpen((current) => !current)}
        >
          {open ? '접기' : '펼치기'}
        </Button>
      ) : null}
    </div>
  )
}
