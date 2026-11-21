import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isNearBottom, onNewMessage, scrollBehaviorFor } from './follow-latest.ts'

test('바닥에 있거나 임계값 안이면 바닥 근처입니다', () => {
  assert.equal(isNearBottom({ scrollTop: 900, clientHeight: 100, scrollHeight: 1000 }), true)
  assert.equal(isNearBottom({ scrollTop: 800, clientHeight: 100, scrollHeight: 1000 }), true)
  assert.equal(isNearBottom({ scrollTop: 700, clientHeight: 100, scrollHeight: 1000 }), false)
})

test('임계값을 바꿀 수 있습니다', () => {
  assert.equal(isNearBottom({ scrollTop: 700, clientHeight: 100, scrollHeight: 1000 }, 200), true)
})

test('바닥 근처면 새 메시지를 따라갑니다', () => {
  assert.equal(onNewMessage({ nearBottom: true, fromHuman: false }), 'follow')
})

test('이전 메시지를 보는 중이면 알리기만 합니다', () => {
  assert.equal(onNewMessage({ nearBottom: false, fromHuman: false }), 'notify')
})

test('내가 보낸 메시지는 위에 있어도 따라갑니다', () => {
  assert.equal(onNewMessage({ nearBottom: false, fromHuman: true }), 'follow')
})

test('움직임 줄이기면 바로 이동합니다', () => {
  assert.equal(scrollBehaviorFor(true), 'auto')
  assert.equal(scrollBehaviorFor(false), 'smooth')
})
