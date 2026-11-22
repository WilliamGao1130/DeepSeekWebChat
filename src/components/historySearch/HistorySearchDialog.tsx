import clsx from 'clsx'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import * as db from '../../services/chat/db.js'
import {
  searchChatHistory,
  type ChatHistorySearchResult,
} from '../../services/chat/historySearch.js'
import { selectSession } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
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

/** Cmd/Ctrl+K 聊天记录搜索：全量读取本地会话，支持键盘选择和消息定位。 */
export const HistorySearchDialog = () => {
  const t = useTranslate()
  const titleId = useId()
  const open = useHistorySearch((state) => state.open)
  const closeSearch = useHistorySearch((state) => state.closeSearch)
  const focusResult = useHistorySearch((state) => state.focusResult)
  const inputRef = useRef<HTMLInputElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const [query, setQuery] = useState('')
  const [sessions, setSessions] = useState<Session[]>([])
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('idle')
  const [results, setResults] = useState<ChatHistorySearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  useEffect(() => {
    if (!open) {
      return
    }
    previousFocusRef.current = document.activeElement as HTMLElement | null
    setQuery('')
    setResults([])
    setActiveIndex(-1)
    setLoadStatus('loading')
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    let current = true
    void db
      .loadAllSessions()
      .then((stored) => {
        if (current) {
          setSessions(stored)
          setLoadStatus('ready')
        }
      })
      .catch((error: unknown) => {
        db.reportStorageError('search local sessions')(error)
        if (current) {
          setLoadStatus('error')
        }
      })
    return () => {
      current = false
      cancelAnimationFrame(frame)
      previousFocusRef.current?.focus({ preventScroll: true })
    }
  }, [open])

  useEffect(() => {
    if (!open || loadStatus !== 'ready') {
      return
    }
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setSearching(false)
      setActiveIndex(-1)
      return
    }
    setSearching(true)
    const timer = window.setTimeout(() => {
      const next = searchChatHistory(sessions, trimmed)
      setResults(next)
      setActiveIndex(next.length > 0 ? 0 : -1)
      setSearching(false)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [loadStatus, open, query, sessions])

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
  const error = loadStatus === 'error'

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
          id={`${titleId}-results`}
          className={styles.results}
          role="listbox"
          aria-label={t('historySearchListAriaLabel')}
          aria-busy={loadStatus === 'loading' || searching}
        >
          {!hasQuery ? (
            <div className={styles.state}>{t('historySearchEmptyHint')}</div>
          ) : loadStatus === 'loading' || searching ? (
            <div className={styles.state}>
              <span className={styles.spinner} aria-hidden />
              {t('historySearching')}
            </div>
          ) : error ? (
            <div className={styles.state}>{t('historySearchFailed')}</div>
          ) : results.length === 0 ? (
            <div className={styles.state}>{t('historySearchNoResult')}</div>
          ) : (
            results.map((result, index) => {
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
            })
          )}
        </div>

        <div className={styles.footer}>{t('historySearchKeyboardHint')}</div>
      </div>
    </div>,
    document.body
  )
}
