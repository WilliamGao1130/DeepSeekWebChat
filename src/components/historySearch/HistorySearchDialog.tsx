import clsx from 'clsx'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import * as db from '../../services/chat/db.js'
import type { ChatHistorySearchResult } from '../../services/chat/historySearch.js'
import { scanHistoryPage } from '../../services/chat/historySearchScan.js'
import { selectSession } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { formatDate } from '../../utils/format.js'
import { IconCloseOutline16, IconSearchOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import styles from './HistorySearchDialog.module.css'
import { useHistorySearch } from './historySearchState.js'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

const HighlightedText = ({ text, query }: { text: string; query: string }) => {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) {
    return text
  }
  const lower = text.toLocaleLowerCase()
  const parts: React.ReactNode[] = []
  let offset = 0
  for (let index = lower.indexOf(needle); index >= 0; index = lower.indexOf(needle, offset)) {
    if (index > offset) {
      parts.push(text.slice(offset, index))
    }
    const end = index + needle.length
    parts.push(<mark key={`${index}:${end}`}>{text.slice(index, end)}</mark>)
    offset = end
  }
  if (offset === 0) {
    return text
  }
  if (offset < text.length) {
    parts.push(text.slice(offset))
  }
  return parts
}

/**
 * Cmd/Ctrl+K 聊天记录搜索。
 * 元数据按最近更新时间排序，正文逐批读取；结果边扫描边显示，滚动接近底部时继续。
 */
export const HistorySearchDialog = () => {
  const t = useTranslate()
  const titleId = useId()
  const open = useHistorySearch((state) => state.open)
  const closeSearch = useHistorySearch((state) => state.closeSearch)
  const focusResult = useHistorySearch((state) => state.focusResult)
  const inputRef = useRef<HTMLInputElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const summariesRef = useRef<SessionSummary[]>([])
  const nextIndexRef = useRef(0)
  const generationRef = useRef(0)
  const metadataReadyRef = useRef(false)
  const activeScanRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [query, setQuery] = useState('')
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle')
  const [searchError, setSearchError] = useState(false)
  const [results, setResults] = useState<ChatHistorySearchResult[]>([])
  const [scanning, setScanning] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  useEffect(() => {
    if (!open) {
      return
    }
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const generation = ++generationRef.current
    metadataReadyRef.current = false
    abortRef.current?.abort()
    activeScanRef.current = null
    summariesRef.current = []
    nextIndexRef.current = 0
    setQuery('')
    setResults([])
    setActiveIndex(-1)
    setScanning(false)
    setHasMore(false)
    setSearchError(false)
    setLoadStatus('loading')
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    void db
      .loadSessionSummaries()
      .then((summaries) => {
        if (generation === generationRef.current) {
          summariesRef.current = [...summaries].sort((a, b) => b.updatedAt - a.updatedAt)
          metadataReadyRef.current = true
          setLoadStatus('ready')
        }
      })
      .catch((error: unknown) => {
        db.reportStorageError('search local sessions')(error)
        if (generation === generationRef.current) {
          metadataReadyRef.current = false
          setLoadStatus('error')
        }
      })
    return () => {
      generationRef.current += 1
      metadataReadyRef.current = false
      cancelAnimationFrame(frame)
      abortRef.current?.abort()
      previousFocusRef.current?.focus({ preventScroll: true })
    }
  }, [open])

  const scan = useCallback(
    async (generation: number, searchQuery: string, startIndex: number, signal: AbortSignal) => {
      if (signal.aborted || activeScanRef.current === generation) {
        return
      }
      activeScanRef.current = generation
      if (generation === generationRef.current) {
        setScanning(true)
      }
      try {
        const page = await scanHistoryPage({
          summaries: summariesRef.current,
          query: searchQuery,
          startIndex,
          signal,
          onBatch: (batch) => {
            if (generation !== generationRef.current || signal.aborted) {
              return
            }
            setResults((current) => [...current, ...batch])
            setActiveIndex((index) => (index < 0 ? 0 : index))
          },
        })
        if (generation === generationRef.current && !signal.aborted) {
          nextIndexRef.current = page.nextIndex
          setHasMore(!page.done)
        }
      } catch (error) {
        if (generation === generationRef.current && !signal.aborted) {
          db.reportStorageError('search chat history')(error)
          setSearchError(true)
          setHasMore(false)
        }
      } finally {
        if (activeScanRef.current === generation) {
          activeScanRef.current = null
        }
        if (generation === generationRef.current) {
          setScanning(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    if (!open || loadStatus !== 'ready' || !metadataReadyRef.current) {
      return
    }
    const generation = ++generationRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const trimmed = query.trim()
    nextIndexRef.current = 0
    setResults([])
    setActiveIndex(-1)
    setHasMore(false)
    setSearchError(false)

    if (!trimmed) {
      setScanning(false)
      return () => controller.abort()
    }

    setScanning(true)
    const timer = window.setTimeout(() => {
      void scan(generation, trimmed, 0, controller.signal)
    }, 120)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [loadStatus, open, query, scan])

  // 结果列表距离底部约一页时提前启动下一次会话扫描，避免用户滚到底后才等待。
  useEffect(() => {
    if (!open || !hasMore || scanning || searchError) {
      return
    }
    const root = resultsRef.current
    const sentinel = sentinelRef.current
    const signal = abortRef.current?.signal
    if (!root || !sentinel || !signal) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void scan(generationRef.current, query.trim(), nextIndexRef.current, signal)
        }
      },
      { root, rootMargin: '200px 0px', threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, open, query, scan, scanning, searchError])

  useEffect(() => {
    if (!open || activeIndex < 0) {
      return
    }
    document
      .getElementById(`${titleId}-result-${activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open, titleId])

  if (!open) {
    return null
  }

  const choose = (result: ChatHistorySearchResult) => {
    focusResult({ sessionId: result.sessionId, messageId: result.messageId })
    closeSearch()
    selectSession(result.sessionId)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSearch()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (results.length > 0) {
        setActiveIndex((index) => (index + 1) % results.length)
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (results.length > 0) {
        setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1))
      }
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      const result = results[activeIndex]
      if (result) {
        choose(result)
      }
    }
  }

  const hasQuery = query.trim().length > 0
  const initialLoading = loadStatus === 'loading' || (scanning && results.length === 0)
  const failed = loadStatus === 'error' || searchError

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(event) => event.target === event.currentTarget && closeSearch()}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('historySearchTriggerButton')}
      >
        <div className={styles.header}>
          <span className={styles.searchIcon} aria-hidden>
            <IconSearchOutline16 />
          </span>
          <input
            ref={inputRef}
            id={titleId}
            className={styles.input}
            value={query}
            placeholder={t('historySearchPlaceholder')}
            aria-label={t('historySearchPlaceholder')}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded
            aria-haspopup="listbox"
            aria-controls={`${titleId}-results`}
            aria-activedescendant={
              activeIndex >= 0 ? `${titleId}-result-${activeIndex}` : undefined
            }
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <IconButton icon={<IconCloseOutline16 />} aria-label={t('close')} onClick={closeSearch} />
        </div>

        <div
          ref={resultsRef}
          id={`${titleId}-results`}
          className={styles.results}
          role="listbox"
          aria-label={t('historySearchListAriaLabel')}
          aria-busy={initialLoading || scanning}
        >
          {!hasQuery ? (
            <div className={styles.state}>{t('historySearchEmptyHint')}</div>
          ) : initialLoading ? (
            <div className={styles.state}>
              <span className={styles.spinner} aria-hidden />
              {t('historySearching')}
            </div>
          ) : failed ? (
            <div className={styles.state}>{t('historySearchFailed')}</div>
          ) : (
            <>
              {results.map((result, index) => {
                const title = result.title || t('untitledChat')
                const date = formatDate(result.createdAt, '/')
                const role = result.role
                  ? t(result.role === 'user' ? 'historySearchUser' : 'historySearchAssistant')
                  : t('historySearchTitleMatch')
                return (
                  <button
                    id={`${titleId}-result-${index}`}
                    key={`${result.sessionId}:${result.messageId ?? 'title'}:${index}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === activeIndex}
                    className={clsx(styles.result, index === activeIndex && styles.active)}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(result)}
                  >
                    <span className={styles.resultTop}>
                      <span className={styles.resultTitle}>
                        <HighlightedText text={title} query={query} />
                      </span>
                      {date ? <span className={styles.date}>{date}</span> : null}
                    </span>
                    <span className={styles.resultMeta}>{role}</span>
                    {result.snippet ? (
                      <span className={styles.snippet}>
                        <HighlightedText text={result.snippet} query={query} />
                      </span>
                    ) : null}
                  </button>
                )
              })}
              {scanning && results.length > 0 ? (
                <div className={styles.progress}>
                  <span className={styles.spinner} aria-hidden />
                  {t('historySearchLoadEarlier')}
                </div>
              ) : hasMore ? (
                <div ref={sentinelRef} className={styles.loadMore}>
                  {t('historySearchLoadEarlier')}
                </div>
              ) : results.length === 0 ? (
                <div className={styles.state}>{t('historySearchNoResult')}</div>
              ) : null}
            </>
          )}
        </div>

        <div className={styles.footer}>{t('historySearchKeyboardHint')}</div>
      </div>
    </div>,
    document.body
  )
}
