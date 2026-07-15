export const MATCH_ACTIVITIES = [
  { id: 'study', label: 'Study', emoji: '📚', category: 'indoor' },
  { id: 'coding', label: 'Coding', emoji: '💻', category: 'indoor' },
  { id: 'sports', label: 'Sports', emoji: '🏸', category: 'outdoor' },
  { id: 'coffee', label: 'Coffee', emoji: '☕', category: 'indoor' },
  { id: 'food', label: 'Food', emoji: '🍽', category: 'indoor' },
  { id: 'gaming', label: 'Gaming', emoji: '🎮', category: 'indoor' },
  { id: 'walk', label: 'Walk', emoji: '🚶', category: 'outdoor' },
  { id: 'movie', label: 'Movie', emoji: '🎬', category: 'indoor' },
  { id: 'event', label: 'Event', emoji: '🎉', category: 'indoor' },
  { id: 'chat', label: 'Chat', emoji: '💬', category: 'indoor' },
  { id: 'library', label: 'Library', emoji: '📖', category: 'indoor' },
  { id: 'other', label: 'Other', emoji: '✨', category: 'indoor' }
];

export const CAMPUS_AREAS = [
  { id: 'library', label: 'Library' },
  { id: 'cafeteria', label: 'Cafeteria' },
  { id: 'hostel', label: 'Hostel' },
  { id: 'academic_block', label: 'Academic Block' },
  { id: 'sports_complex', label: 'Sports Complex' },
  { id: 'main_gate', label: 'Main Gate' },
  { id: 'other', label: 'Other' }
];

export const ACTIVITY_DETAILS_CONFIG = {
  study: { label: 'Subject', placeholder: 'e.g., Physics, Calculus' },
  sports: { label: 'Which sport?', placeholder: 'e.g., Badminton, Football' },
  coding: { label: 'Tech stack / Hackathon?', placeholder: 'e.g., React, Python' },
  food: { label: 'Which cafeteria?', placeholder: 'e.g., Central Food Court' },
  coffee: { label: 'Which coffee shop?', placeholder: 'e.g., Starbucks, Local Cafe' },
  library: { label: 'Library name / Floor', placeholder: 'e.g., Central Library, 2nd Floor' }
};

export const ACCEPT_TIMERS = {
  indoor: 30,    // seconds
  outdoor: 60,   // seconds
  today: 90      // seconds for 'today' time preference
};
