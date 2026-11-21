import type { ComponentProps } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

/*
 * 말풍선 본문. 에이전트는 마크다운(인라인 코드, 굵게, 목록, 코드 블록, 표)으로 쓰므로 그대로 렌더링합니다.
 * 줄바꿈 하나도 줄바꿈으로 둡니다(remark-breaks). 원시 HTML은 렌더링하지 않습니다(react-markdown 기본값).
 * 색은 말풍선 글자색(currentColor)에서 섞어, 사람의 테두리 말풍선과 에이전트의 회색 말풍선 모두에서 읽힙니다.
 */

const MENTION = /(@[^\s@]+)/

/** 본문에서 부른 이름들. 코드 안의 @는 멘션이 아니므로 코드 블록과 인라인 코드를 먼저 지웁니다. */
export function mentionsIn(text: string) {
  const prose = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ')
  return prose
    .split(MENTION)
    .filter((part) => part.length > 1 && part.startsWith('@'))
    .map((part) => part.slice(1))
}

interface MdastNode {
  type: string
  value?: string
  children?: MdastNode[]
  data?: Record<string, unknown>
}

/**
 * 글자 속 @이름을 굵은 span으로 나눕니다. 코드 안의 @(예: @base-ui/react)는 글자 노드가 아니라 건드리지 않습니다.
 * attention이 참인 이름은 사람이 답할 호출이라 attention 글자색을 씁니다(DESIGN.md Two Meanings Rule).
 */
function remarkMentions({ attention }: { attention: (name: string) => boolean }) {
  const split = (node: MdastNode): MdastNode[] => {
    if (node.type !== 'text' || !node.value?.includes('@')) {
      if (node.children) node.children = node.children.flatMap(split)
      return [node]
    }
    return node.value
      .split(MENTION)
      .filter(Boolean)
      .map((part) =>
        part.length > 1 && part.startsWith('@')
          ? {
              type: 'mention',
              data: {
                hName: 'span',
                hProperties: { className: attention(part.slice(1)) ? 'font-semibold text-attention-foreground' : 'font-semibold' },
              },
              children: [{ type: 'text', value: part }],
            }
          : { type: 'text', value: part },
      )
  }
  return (tree: MdastNode) => {
    split(tree)
  }
}

const components: Components = {
  p: ({ node: _, ...props }) => <p {...props} />,
  // 제목도 본문 크기를 넘지 않게 굵은 문단으로 둡니다(Fixed Scale Rule)
  h1: ({ node: _, ...props }) => <p className="font-semibold" {...props} />,
  h2: ({ node: _, ...props }) => <p className="font-semibold" {...props} />,
  h3: ({ node: _, ...props }) => <p className="font-semibold" {...props} />,
  h4: ({ node: _, ...props }) => <p className="font-semibold" {...props} />,
  ul: ({ node: _, ...props }) => <ul className="list-disc space-y-1 ps-5" {...props} />,
  ol: ({ node: _, ...props }) => <ol className="list-decimal space-y-1 ps-5" {...props} />,
  a: ({ node: _, ...props }) => <a className="underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />,
  blockquote: ({ node: _, ...props }) => <blockquote className="border-s-2 border-current/30 ps-3" {...props} />,
  pre: ({ node: _, ...props }) => (
    <pre
      className="overflow-x-auto border border-current/15 p-3 font-mono text-label leading-relaxed [&_code]:bg-transparent [&_code]:p-0"
      {...props}
    />
  ),
  code: ({ node: _, ...props }) => <code className="bg-current/10 px-1 py-px font-mono text-label" {...props} />,
  table: ({ node: _, ...props }) => (
    <div className="overflow-x-auto">
      <table className="border-collapse text-label" {...props} />
    </div>
  ),
  th: ({ node: _, ...props }) => <th className="border border-current/15 px-2 py-1 text-start font-semibold" {...props} />,
  td: ({ node: _, ...props }) => <td className="border border-current/15 px-2 py-1 align-top" {...props} />,
  hr: ({ node: _, ...props }) => <hr className="border-current/15" {...props} />,
}

export function MessageBody({
  text,
  attention,
  ...props
}: { text: string; attention: (name: string) => boolean } & Omit<ComponentProps<'div'>, 'children'>) {
  return (
    <div className="space-y-2" {...props}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks, [remarkMentions, { attention }]]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
