import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { postsApi } from '../api/apiClient';

export const useSavedPostsStore = create(
  persist(
    (set, get) => ({
      savedPosts: [],
      toggleSavePost: async (id) => {
        const current = get().savedPosts;
        if (current.includes(id)) {
          // Optimistic update
          set({ savedPosts: current.filter((x) => x !== id) });
          try {
            await postsApi.unbookmarkPost(id);
          } catch (err) {
            // Rollback on failure
            set({ savedPosts: [...get().savedPosts, id] });
            console.error('Failed to unbookmark post', err);
          }
        } else {
          // Optimistic update
          set({ savedPosts: [...current, id] });
          try {
            await postsApi.bookmarkPost(id);
          } catch (err) {
            // Rollback on failure
            set({ savedPosts: get().savedPosts.filter((x) => x !== id) });
            console.error('Failed to bookmark post', err);
          }
        }
      },
      hydrateFromServer: (ids) => {
        set({ savedPosts: ids });
      },
      isSaved: (id) => get().savedPosts.includes(id),
      clearAll: () => {
        set({ savedPosts: [] });
      },
    }),
    {
      name: 'saved-posts-storage',
    }
  )
);
