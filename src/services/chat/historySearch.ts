import { getVisibleMessages } from './branches.js'
import type { AssistantMessage, Session } from './types.js'

/** 单次搜索最多展示的结果数，避免一次渲染过多历史消息。 */
const RESULT_LIMIT = 100
/** 同一会话最多返回的消息命中数，保证结果仍能覆盖多个会话。 */
const SESSION_MESSAGE_LIMIT = 5
const SNIPPET_BEFORE = 54
const SNIPPET_AFTER = 96

export type ChatHistorySearchResult = {
  sessionId: string
  /** 仅标题命中时为 null */
  messageId: string | null
  title: string
  snippet: string
  role: 'user' | 'assistant' | null
  createdAt: number
}

const compactText = (value: string) => value.replace(/\s+/g, ' ').trim()

const replyText = (message: AssistantMessage) =>
  message.blocks
    .flatMap((block) =>
      block.type === 'text' && !block.isTemplate && block.text ? [block.text] : []
    )
    .join('\n')

const messageText = (message: Session['messages'][number]) =>
  message.role === 'user' ? message.content : replyText(message)

const makeSnippet = (text: string, needle: string) => {
  const compact = compactText(text)
  const index = compact.toLocaleLowerCase().indexOf(needle)
  if (index < 0) {
    return compact.slice(0, SNIPPET_BEFORE + SNIPPET_AFTER)
  }
  const start = Math.max(0, index - SNIPPET_BEFORE)
  const end = Math.min(compact.length, index + needle.length + SNIPPET_AFTER)
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`
}

/**
 * 在本地会话当前可见分支中搜索标题、提问和回答正文。
 * 标题与正文同时命中时优先保留正文位置；只有标题命中时才生成标题结果。
 */
export const searchChatHistory = (
  sessions: Session[],
  query: string
): ChatHistorySearchResult[] => {
  const trimmed = query.trim()
  if (!trimmed) {
    return []
  }
  const needle = trimmed.toLocaleLowerCase()
  const results: ChatHistorySearchResult[] = []
  const ordered = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

  for (const session of ordered) {
    let messageMatches = 0
    const titleMatches = session.title.toLocaleLowerCase().includes(needle)

    for (const message of getVisibleMessages(session)) {
      const text = messageText(message)
      if (!text.toLocaleLowerCase().includes(needle)) {
        continue
      }
      results.push({
        sessionId: session.id,
        messageId: message.id,
        title: session.title,
        snippet: makeSnippet(text, needle),
        role: message.role,
        createdAt: message.createdAt,
      })
      messageMatches += 1
      if (messageMatches >= SESSION_MESSAGE_LIMIT || results.length >= RESULT_LIMIT) {
        break
      }
    }

    if (titleMatches && messageMatches === 0 && results.length < RESULT_LIMIT) {
      results.push({
        sessionId: session.id,
        messageId: null,
        title: session.title,
        snippet: '',
        role: null,
        createdAt: session.updatedAt,
      })
    }
    if (results.length >= RESULT_LIMIT) {
      break
    }
  }

  return results
}
