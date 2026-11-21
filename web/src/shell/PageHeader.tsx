import type { ReactNode } from 'react'

/**
 * 아침 리뷰와 채팅방이 같이 쓰는 화면 머리.
 * 높이를 --page-header-height로 맞춰 두 화면의 제목이 같은 자리에 서고, 스크롤해도 위에 붙어 있습니다.
 * 넓은 화면에서는 레일과의 간격(gap-8)까지 덮어, 레일의 워드마크 칸과 한 띠로 이어집니다.
 */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex min-h-(--page-header-height) flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b bg-background py-3 lg:-ms-8 lg:flex-nowrap lg:ps-8">
      <h1 title={title} className="min-w-0 text-[1.75rem] leading-tight font-bold tracking-tight break-words text-balance lg:truncate">
        {title}
      </h1>
      {children ? <div className="flex shrink-0 flex-wrap items-center gap-x-8 gap-y-3">{children}</div> : null}
    </header>
  )
}
