import { create } from 'zustand';

/**
 * uiStore — transient UI state that shouldn't live in DataContext.
 * Rule: if it's not persisted to localStorage and doesn't come from
 * the API, it belongs here.
 */
const useUIStore = create((set) => ({
  searchQuery:    '',
  setSearchQuery: (q) => set({ searchQuery: q }),

  isSidebarOpen:    false,
  setSidebarOpen:   (open) => set({ isSidebarOpen: open }),
}));

export default useUIStore;
