import { useEffect } from 'react'

/**
 * 좁은 화면의 화면 제목. 레일이 없으니 지금 어느 화면인지 여기서 보이고, 스크롤해도 위에 붙어 있습니다.
 * 넓은 화면에서는 레일이 이미 현재 화면을 표시하므로 스크린 리더용 제목으로만 남깁니다.
 * 화면의 조작은 여기 두지 않고 그 조작이 다루는 내용 옆에 둡니다.
 */
export function PageHeader({ title }: { title: string }) {
  // 탭과 방문 기록에서 화면을 구분하도록 브라우저 제목도 같은 제목으로 맞춥니다
  useEffect(() => {
    document.title = `${title} – afk`
  }, [title])

  return (
    <header className="sticky top-0 z-20 flex min-h-(--page-header-height) items-center border-b bg-background py-3 lg:sr-only">
      <h1 className="min-w-0 text-title leading-tight font-bold tracking-tight break-words text-balance">{title}</h1>
    </header>
  )
}
