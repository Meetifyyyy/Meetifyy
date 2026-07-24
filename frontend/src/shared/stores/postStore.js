import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

/**
 * postStore — owns post-level user preferences (e.g. saved posts).
 *
 * Selector rule — always subscribe with a selector, never destructure:
 *   ✅  const savedPosts = usePostStore(state => state.savedPosts)
 *   ❌  const { savedPosts } = usePostStore()
 */
const usePostStore = create(
  persist(
    immer((set) => ({
      savedPosts: [],
      toggleSavePost: (postId) => set((state) => {
        const idx = state.savedPosts.indexOf(postId);
        if (idx === -1) {
          state.savedPosts.push(postId);
        } else {
          state.savedPosts.splice(idx, 1);
        }
      }),

      clearAll: () => set((state) => {
        state.savedPosts = [];
      }),
    })),
    {
      name: 'meetifyy-post-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        savedPosts: state.savedPosts,
      }),
    }
  )
);

export default usePostStore;
