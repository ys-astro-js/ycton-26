import { createCn } from 'cn/config'

/**
 * index.css @theme의 글자 크기 이름(text-title, text-body, text-label)을 크기로 알려 줍니다.
 * 알려 주지 않으면 색 클래스로 오인해 text-muted-foreground 같은 색과 합칠 때 크기를 지웁니다.
 */
export const cn = createCn({
  extend: { classGroups: { 'font-size': [{ text: ['title', 'body', 'label'] }] } },
})
