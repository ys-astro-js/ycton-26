import { useCallback, useEffect, useRef, useState } from 'react'

import type { Message } from '@/api/client'

import { isNearBottom, onNewMessage, scrollBehaviorFor } from './follow-latest.ts'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function pageMetrics() {
  const root = document.documentElement
  return { scrollTop: window.scrollY, clientHeight: window.innerHeight, scrollHeight: root.scrollHeight }
}

/**
 * 대화가 바닥 근처일 때만 새 메시지를 따라갑니다. 위로 올라가 있으면 따라가지 않고 `unread`로 알립니다.
 * 내가 보낸 메시지는 위치와 상관없이 따라갑니다. 방을 옮기면 기준을 새로 잡습니다.
 */
export function useFollowLatest(roomId: number, messages: readonly Message[] | undefined) {
  const [nearBottom, setNearBottom] = useState(true)
  const [unread, setUnread] = useState(false)
  const nearBottomRef = useRef(true)
  const seen = useRef<{ roomId: number; id: number | null } | null>(null)

  useEffect(() => {
    const update = () => {
      const near = isNearBottom(pageMetrics())
      nearBottomRef.current = near
      setNearBottom(near)
      if (near) setUnread(false)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [roomId])

  const scrollToLatest = useCallback(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: scrollBehaviorFor(reducedMotion()) })
  }, [])

  const latest = messages && messages.length > 0 ? messages[messages.length - 1] : undefined
  const latestId = latest?.id ?? null
  const fromHuman = latest?.author === 'human'
  const loaded = messages !== undefined
  useEffect(() => {
    if (!loaded) return
    const previous = seen.current
    seen.current = { roomId, id: latestId }
    // 첫 로드와 방 전환은 페이지가 따로 맨 아래·초점으로 맞춥니다
    if (previous === null || previous.roomId !== roomId || latestId === null || latestId === previous.id) return
    if (onNewMessage({ nearBottom: nearBottomRef.current, fromHuman }) === 'follow') scrollToLatest()
    else setUnread(true)
  }, [roomId, loaded, latestId, fromHuman, scrollToLatest])

  /** 누르면 최신으로 가고, 사라질 버튼 대신 대화 목록으로 포커스를 옮겨 키보드 위치를 잃지 않게 합니다. */
  const jumpToLatest = useCallback(() => {
    scrollToLatest()
    setUnread(false)
    document.querySelector<HTMLElement>('ol[aria-label="대화"]')?.focus({ preventScroll: true })
  }, [scrollToLatest])

  return { showJump: !nearBottom, unread, jumpToLatest }
}
