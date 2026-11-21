import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** 내용 높이를 재서 펼치고 접습니다. 측정 ref는 안쪽 래퍼에 둡니다. */
export function Collapse({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  const [animate, setAnimate] = useState(false)

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    setHeight(inner.offsetHeight)
    const observer = new ResizeObserver(([entry]) => setHeight(entry.borderBoxSize[0]?.blockSize ?? inner.offsetHeight))
    observer.observe(inner)
    // 첫 렌더의 기본 상태는 애니메이션 없이 그립니다
    const frame = requestAnimationFrame(() => setAnimate(true))
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div
      id={id}
      className="collapse"
      data-open={open}
      data-animate={animate}
      style={{ height: open ? (height ?? 'auto') : 0 }}
      inert={!open}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  )
}
