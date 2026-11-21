import type { ReactNode } from 'react'

/**
 * 아침 리뷰와 채팅방이 같이 쓰는 화면 머리.
 * 높이를 --page-header-height로 맞춰 두 화면의 제목이 같은 자리에 서고, 스크롤해도 위에 붙어 있습니다.
 */
export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex min-h-(--page-header-height) flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b bg-background py-3">
      <h1 className="min-w-0 text-[1.75rem] leading-tight font-bold tracking-tight break-words text-balance">{title}</h1>
      {children ? <div className="flex flex-wrap items-center gap-x-8 gap-y-3">{children}</div> : null}
    </header>
  )
}
