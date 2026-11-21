/*
 * 대화 새 메시지 따라가기의 판단 로직입니다. 화면(DOM)을 모르는 순수 함수라 단위 테스트로 검증합니다.
 */

/** 바닥에서 이만큼(px) 안이면 "바닥 근처"로 봅니다. */
export const NEAR_BOTTOM_PX = 120

export type ScrollMetrics = { scrollTop: number; clientHeight: number; scrollHeight: number }

export function isNearBottom({ scrollTop, clientHeight, scrollHeight }: ScrollMetrics, threshold = NEAR_BOTTOM_PX) {
  return scrollHeight - (scrollTop + clientHeight) <= threshold
}

/**
 * 새 메시지가 생겼을 때 할 일.
 * 내가 보낸 메시지이거나 이미 바닥 근처면 따라가고, 이전 메시지를 보는 중이면 알리기만 합니다.
 */
export function onNewMessage({ nearBottom, fromHuman }: { nearBottom: boolean; fromHuman: boolean }): 'follow' | 'notify' {
  return nearBottom || fromHuman ? 'follow' : 'notify'
}

/** 움직임 줄이기를 켠 사람에게는 부드러운 스크롤 대신 바로 이동합니다. */
export function scrollBehaviorFor(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? 'auto' : 'smooth'
}
