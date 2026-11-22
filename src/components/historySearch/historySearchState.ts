import { create } from 'zustand'

type SearchTarget = {
  sessionId: string
  messageId: string | null
}

type HistorySearchState = {
  open: boolean
  target: SearchTarget | null
  openSearch: () => void
  toggleSearch: () => void
  closeSearch: () => void
  focusResult: (target: SearchTarget) => void
  clearTarget: () => void
}

export const useHistorySearch = create<HistorySearchState>((set) => ({
  open: false,
  target: null,
  openSearch: () => set({ open: true, target: null }),
  toggleSearch: () => set((state) => (state.open ? { open: false } : { open: true, target: null })),
  closeSearch: () => set({ open: false }),
  focusResult: (target) => set({ target }),
  clearTarget: () => set({ target: null }),
}))

export const openHistorySearch = () => useHistorySearch.getState().openSearch()
