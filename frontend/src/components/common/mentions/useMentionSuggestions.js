import { useState, useEffect, useMemo, useRef } from 'react';
import { useData } from '../../../context/DataContext';

export function useMentionSuggestions({ query = '', communityId = null, maxResults = 15 }) {
  const { users = {}, currentUser, conversations = [], communities = {} } = useData();
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef(new Map());

  // Convert users object to array
  const allUsers = useMemo(() => {
    return Object.values(users).filter(Boolean);
  }, [users]);

  // Derive community members list if inside a community
  const communityMemberUsernames = useMemo(() => {
    if (!communityId) return new Set();
    const commList = Array.isArray(communities) ? communities : Object.values(communities || {});
    const comm = commList.find(c => String(c.id) === String(communityId) || c.name === communityId);
    if (!comm) return new Set();
    const commName = comm.name;
    const members = new Set();
    allUsers.forEach(u => {
      if (u.communities && u.communities.includes(commName)) {
        members.add(u.username);
      }
    });
    return members;
  }, [communityId, communities, allUsers]);

  // Derive recent chat participants
  const recentChatUsernames = useMemo(() => {
    const set = new Set();
    if (!Array.isArray(conversations)) return set;
    conversations.slice(0, 10).forEach(c => {
      if (Array.isArray(c.participants)) {
        c.participants.forEach(p => {
          if (typeof p === 'string' && p !== currentUser?.username) set.add(p);
          else if (p && p.username && p.username !== currentUser?.username) set.add(p.username);
        });
      }
    });
    return set;
  }, [conversations, currentUser]);

  useEffect(() => {
    const cleanQuery = query.trim().toLowerCase();
    const cacheKey = `${cleanQuery}|${communityId || ''}`;

    if (cacheRef.current.has(cacheKey)) {
      setSuggestions(cacheRef.current.get(cacheKey));
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(() => {
      const myFollowing = new Set(currentUser?.followingList || []);
      const myFollowers = new Set(currentUser?.followersList || []);

      const scored = [];

      for (const u of allUsers) {
        // We allow tagging anyone, but check match
        const uname = (u.username || '').toLowerCase();
        const dname = (u.displayName || u.name || '').toLowerCase();

        if (cleanQuery && !uname.includes(cleanQuery) && !dname.includes(cleanQuery)) {
          continue;
        }

        let score = 0;

        // Prefix match gets a significant boost
        if (cleanQuery && (uname.startsWith(cleanQuery) || dname.startsWith(cleanQuery))) {
          score += 500;
        }

        // 1. Friends / Connections
        const isFollowing = myFollowing.has(u.username);
        const isFollower = myFollowers.has(u.username);
        if (isFollowing && isFollower) {
          score += 10000; // Mutual
        } else if (isFollowing || isFollower) {
          score += 7000;
        }

        // 2. Recent conversations
        if (recentChatUsernames.has(u.username)) {
          score += 4000;
        }

        // 3. Community members
        if (communityMemberUsernames.has(u.username)) {
          score += 2000;
        }

        // Self slight penalty when sorting generic lists so connections appear above yourself
        if (u.username === currentUser?.username) {
          score -= 500;
        }

        // Calculate mutual friends count (optional badge info)
        let mutualCount = 0;
        if (u.followersList && currentUser?.followingList) {
          const uFollowers = new Set(u.followersList);
          currentUser.followingList.forEach(f => {
            if (uFollowers.has(f)) mutualCount++;
          });
        }

        scored.push({
          user: {
            id: u.id || u.username,
            username: u.username,
            displayName: u.displayName || u.name || u.username,
            avatar: u.avatar || u.avatarUrl,
            verified: u.verified || false,
            mutualCount
          },
          score
        });
      }

      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.user.displayName.localeCompare(b.user.displayName);
      });

      const results = scored.slice(0, maxResults).map(item => item.user);
      cacheRef.current.set(cacheKey, results);
      setSuggestions(results);
      setLoading(false);
    }, 150); // Debounce 150ms

    return () => clearTimeout(timer);
  }, [query, communityId, maxResults, allUsers, currentUser, recentChatUsernames, communityMemberUsernames]);

  return { suggestions, loading };
}
