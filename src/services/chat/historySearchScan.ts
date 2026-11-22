import * as db from './db.js'
import { searchSessionHistory, type ChatHistorySearchResult } from './historySearch.js'
import type { SessionSummary } from './types.js'

/** 每批并发读取的会话数；既保持速度，也避免一次占满 IndexedDB 事务队列。 */
const SESSION_BATCH_SIZE = 4
/** 单页默认结果数；滚动到接近底部后再继续扫描下一批会话。 */
export const SEARCH_RESULT_PAGE_SIZE = 20
/** 单页最多检查的会话数，防止大量无匹配会话长期阻塞。 */
const SESSION_SCAN_PAGE_SIZE = 60

export type HistorySearchPage = {
  nextIndex: number
  done: boolean
  resultCount: number
}

type SearchHistoryPageInput = {
  summaries: SessionSummary[]
  query: string
  startIndex: number
  signal: AbortSignal
  onBatch: (results: ChatHistorySearchResult[]) => void
  resultLimit?: number
  sessionLimit?: number
}

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * 按 updatedAt 从近到远逐批读取会话并即时回传命中结果。
 * 达到结果页大小或本次扫描会话上限后暂停，保留 nextIndex 供滚动加载继续。
 */
export const scanHistoryPage = async ({
  summaries,
  query,
  startIndex,
  signal,
  onBatch,
  resultLimit = SEARCH_RESULT_PAGE_SIZE,
  sessionLimit = SESSION_SCAN_PAGE_SIZE,
}: SearchHistoryPageInput): Promise<HistorySearchPage> => {
  let index = startIndex
  let scanned = 0
  let resultCount = 0

  while (
    index < summaries.length &&
    !signal.aborted &&
    resultCount < resultLimit &&
    scanned < sessionLimit
  ) {
    const currentSummaries = summaries.slice(
      index,
      Math.min(index + SESSION_BATCH_SIZE, index + sessionLimit - scanned)
    )
    const sessions = await Promise.all(
      currentSummaries.map((summary) => db.loadSession(summary.id))
    )
    if (signal.aborted) {
      break
    }

    for (const session of sessions) {
      if (session) {
        const remaining = resultLimit - resultCount
        const matched = searchSessionHistory(session, query).slice(0, remaining)
        if (matched.length > 0) {
          resultCount += matched.length
          onBatch(matched)
        }
      }
      index += 1
      scanned += 1
      if (resultCount >= resultLimit) {
        break
      }
    }
    await yieldToBrowser()
  }

  return {
    nextIndex: index,
    done: index >= summaries.length,
    resultCount,
  }
}
