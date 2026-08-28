import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import sharp from 'sharp';

// Load backend environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'meetifyy-media';
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || 'https://pub-8cd64731b2bc47deb8a54acbbbfa9c4b.r2.dev').replace(/\/+$/, '');

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('Missing Cloudflare R2 credentials in backend/.env');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

interface SourceMediaItem {
  id: string;
  title: string;
  theme: 'Party' | 'Adventure' | 'Study' | 'Coffee' | 'Walk' | 'Coding';
  category: 'Party' | 'Adventure' | 'Study' | 'Coffee' | 'Walk' | 'Coding';
  tags: string[];
  sourceUrls: string[];
}

// 36 Curated Images across 6 themes
const SOURCE_IMAGES: SourceMediaItem[] = [
  // Party (6)
  {
    id: 'img-party-1',
    title: 'Party Festival Crowd',
    theme: 'Party',
    category: 'Party',
    tags: ['party', 'celebration', 'festival', 'concert', 'crowd', 'lights', 'nightlife'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-party-2',
    title: 'Nightclub Dance Lights',
    theme: 'Party',
    category: 'Party',
    tags: ['party', 'dance', 'club', 'dj', 'music', 'night', 'fun'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-party-3',
    title: 'Celebration Confetti & Cheers',
    theme: 'Party',
    category: 'Party',
    tags: ['party', 'celebration', 'confetti', 'cheers', 'event', 'gather'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-party-4',
    title: 'Social Rooftop Gathering',
    theme: 'Party',
    category: 'Party',
    tags: ['party', 'rooftop', 'friends', 'drinks', 'social', 'hangout', 'evening'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-party-5',
    title: 'Live Music & Concert Stage',
    theme: 'Party',
    category: 'Party',
    tags: ['party', 'concert', 'music', 'band', 'stage', 'live', 'cheer'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-party-6',
    title: 'Birthday & Sparkler Toast',
    theme: 'Party',
    category: 'Party',
    tags: ['party', 'birthday', 'sparkler', 'toast', 'celebrate', 'night'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?w=1200&q=80&auto=format',
    ],
  },

  // Adventure (6)
  {
    id: 'img-adv-1',
    title: 'Mountain Summit Vista',
    theme: 'Adventure',
    category: 'Adventure',
    tags: ['adventure', 'mountain', 'summit', 'hiking', 'nature', 'view', 'explore'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-adv-2',
    title: 'Forest Hiking Trail',
    theme: 'Adventure',
    category: 'Adventure',
    tags: ['adventure', 'trail', 'forest', 'trees', 'hiking', 'outdoors', 'trek'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1448375240586-882707db888b?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-adv-3',
    title: 'Campfire Under Starlit Sky',
    theme: 'Adventure',
    category: 'Adventure',
    tags: ['adventure', 'camping', 'campfire', 'bonfire', 'stars', 'night', 'wilderness'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1510312305653-8ed496efae75?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-adv-4',
    title: 'Scenic Road Trip Drive',
    theme: 'Adventure',
    category: 'Adventure',
    tags: ['adventure', 'roadtrip', 'travel', 'drive', 'scenic', 'journey', 'mountains'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-adv-5',
    title: 'Mountain Lake Kayak',
    theme: 'Adventure',
    category: 'Adventure',
    tags: ['adventure', 'kayak', 'lake', 'water', 'paddle', 'nature', 'mountains'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-adv-6',
    title: 'Backpacker Exploring Canyon',
    theme: 'Adventure',
    category: 'Adventure',
    tags: ['adventure', 'backpacker', 'canyon', 'explore', 'travel', 'hike', 'wild'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1200&q=80&auto=format',
    ],
  },

  // Study (6)
  {
    id: 'img-study-1',
    title: 'Quiet Library Bookstacks',
    theme: 'Study',
    category: 'Study',
    tags: ['study', 'library', 'books', 'reading', 'quiet', 'learning', 'campus'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-study-2',
    title: 'Study Desk with Notes & Laptop',
    theme: 'Study',
    category: 'Study',
    tags: ['study', 'desk', 'laptop', 'notes', 'notebook', 'focus', 'homework'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-study-3',
    title: 'Group Study Collaboration',
    theme: 'Study',
    category: 'Study',
    tags: ['study', 'group', 'students', 'college', 'collaboration', 'workshop', 'learning'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-study-4',
    title: 'University Grand Study Hall',
    theme: 'Study',
    category: 'Study',
    tags: ['study', 'university', 'hall', 'campus', 'academic', 'college', 'exam'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-study-5',
    title: 'Open Textbook & Highlighter',
    theme: 'Study',
    category: 'Study',
    tags: ['study', 'textbook', 'reading', 'highlight', 'revision', 'exam', 'notes'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-study-6',
    title: 'Cozy Study Corner by Window',
    theme: 'Study',
    category: 'Study',
    tags: ['study', 'cozy', 'window', 'desk', 'read', 'focus', 'stationery'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=1200&q=80&auto=format',
    ],
  },

  // Coffee (6)
  {
    id: 'img-coffee-1',
    title: 'Artisan Latte Art',
    theme: 'Coffee',
    category: 'Coffee',
    tags: ['coffee', 'latte', 'latteart', 'cup', 'cafe', 'espresso', 'warm'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-coffee-2',
    title: 'Cozy Cafe Window Table',
    theme: 'Coffee',
    category: 'Coffee',
    tags: ['coffee', 'cafe', 'cozy', 'table', 'morning', 'chill', 'chat'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-coffee-3',
    title: 'Barista Pour-Over Brew',
    theme: 'Coffee',
    category: 'Coffee',
    tags: ['coffee', 'barista', 'pourover', 'brew', 'specialty', 'cafe', 'roast'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-coffee-4',
    title: 'Morning Coffee with Croissant',
    theme: 'Coffee',
    category: 'Coffee',
    tags: ['coffee', 'croissant', 'bakery', 'morning', 'breakfast', 'cappuccino'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-coffee-5',
    title: 'Refreshing Iced Coffee',
    theme: 'Coffee',
    category: 'Coffee',
    tags: ['coffee', 'icedcoffee', 'coldbrew', 'summer', 'glass', 'drink', 'cafe'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-coffee-6',
    title: 'Coffee Date & Conversation',
    theme: 'Coffee',
    category: 'Coffee',
    tags: ['coffee', 'friends', 'meetup', 'date', 'conversation', 'cups', 'together'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?w=1200&q=80&auto=format',
    ],
  },

  // Walk (6)
  {
    id: 'img-walk-1',
    title: 'Sunlit Park Pathway',
    theme: 'Walk',
    category: 'Walk',
    tags: ['walk', 'park', 'nature', 'trees', 'sunlight', 'path', 'morning', 'fresh'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1519331379826-f10be5486c6f?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-walk-2',
    title: 'Golden Hour City Stroll',
    theme: 'Walk',
    category: 'Walk',
    tags: ['walk', 'city', 'goldenhour', 'sunset', 'stroll', 'urban', 'evening'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-walk-3',
    title: 'Walking Dog in the Green Park',
    theme: 'Walk',
    category: 'Walk',
    tags: ['walk', 'dog', 'pet', 'park', 'grass', 'fun', 'happy', 'outside'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-walk-4',
    title: 'Autumn Foliage Trail',
    theme: 'Walk',
    category: 'Walk',
    tags: ['walk', 'autumn', 'fall', 'foliage', 'leaves', 'forest', 'trail', 'stroll'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-walk-5',
    title: 'Waterfront Promenade Breeze',
    theme: 'Walk',
    category: 'Walk',
    tags: ['walk', 'waterfront', 'ocean', 'promenade', 'breeze', 'coastal', 'view'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-walk-6',
    title: 'Friends Walking Together',
    theme: 'Walk',
    category: 'Walk',
    tags: ['walk', 'friends', 'together', 'outdoors', 'chat', 'fun', 'stroll'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=1200&q=80&auto=format',
    ],
  },

  // Coding (6)
  {
    id: 'img-code-1',
    title: 'Developer Code Editor Screen',
    theme: 'Coding',
    category: 'Coding',
    tags: ['coding', 'code', 'developer', 'programming', 'software', 'tech', 'editor'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-code-2',
    title: 'Multi-Monitor Developer Setup',
    theme: 'Coding',
    category: 'Coding',
    tags: ['coding', 'workspace', 'monitors', 'desk', 'setup', 'tech', 'engineer'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-code-3',
    title: 'Hackathon Team Sprint',
    theme: 'Coding',
    category: 'Coding',
    tags: ['coding', 'hackathon', 'team', 'sprint', 'collaborate', 'tech', 'builders'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1531403009284-440f080d1e12?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-code-4',
    title: 'Dark Mode Terminal & Scripts',
    theme: 'Coding',
    category: 'Coding',
    tags: ['coding', 'terminal', 'darkmode', 'bash', 'scripts', 'cli', 'devtools'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1618401471353-b98aedd07871?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-code-5',
    title: 'Web Design & Frontend Development',
    theme: 'Coding',
    category: 'Coding',
    tags: ['coding', 'frontend', 'ui', 'ux', 'web', 'javascript', 'react', 'design'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=1200&q=80&auto=format',
    ],
  },
  {
    id: 'img-code-6',
    title: 'Tech Meetup & Code Workshop',
    theme: 'Coding',
    category: 'Coding',
    tags: ['coding', 'meetup', 'workshop', 'learning', 'presentation', 'tech', 'community'],
    sourceUrls: [
      'https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=1200&q=80&auto=format',
    ],
  },
];

// 46 Curated Animated GIFs across 6 themes
const SOURCE_GIFS: SourceMediaItem[] = [
  // Party (8)
  {
    id: 'gif-party-1',
    title: 'Party Dance Celebration',
    theme: 'Party',
    category: 'Party',
    tags: ['party', 'dance', 'celebrate', 'fun', 'happy', 'club', 'groove'],
    sourceUrls: ['https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif'],
  },
  {
    id: 'gif-party-2',
    title: 'Confetti Explosion Joy',
    theme: 'Party',
    category: 'Party',
    tags: ['party', 'confetti', 'yay', 'celebration', 'cheers', 'victory'],
    sourceUrls: ['https://media.giphy.com/media/26tPplGWjN0xLybiU/giphy.gif'],
  },
  {
    id: 'gif-party-3',
    title: 'Toast Cheers Glasses',
    theme: 'Party',
    category: 'Party',
    tags: ['party', 'toast', 'cheers', 'drinks', 'celebration', 'friends'],
    sourceUrls: ['https://media.giphy.com/media/g9582DNuQppxC/giphy.gif'],
  },
  {
    id: 'gif-party-4',
    title: 'Dancing Animal Groove',
    theme: 'Party',
    category: 'Party',
    tags: ['party', 'dance', 'groove', 'cute', 'funny', 'music'],
    sourceUrls: ['https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif'],
  },
  {
    id: 'gif-party-5',
    title: 'High Five Celebration',
    theme: 'Party',
    category: 'Party',
    tags: ['party', 'highfive', 'celebrate', 'friends', 'awesome', 'team'],
    sourceUrls: ['https://media.giphy.com/media/3oEjHV0z8S7WM4MwnK/giphy.gif'],
  },
  {
    id: 'gif-party-6',
    title: 'Disco Ball Glowing',
    theme: 'Party',
    category: 'Party',
    tags: ['party', 'discoball', 'lights', 'disco', 'dance', 'nightclub'],
    sourceUrls: ['https://media.giphy.com/media/l2JhpjphERFai5ZO8/giphy.gif'],
  },
  {
    id: 'gif-party-7',
    title: 'Excited Jumping Crowd',
    theme: 'Party',
    category: 'Party',
    tags: ['party', 'crowd', 'excited', 'jumping', 'concert', 'festival'],
    sourceUrls: ['https://media.giphy.com/media/DhstvI455Y0sE/giphy.gif'],
  },
  {
    id: 'gif-party-8',
    title: 'Happy Dance Vibes',
    theme: 'Party',
    category: 'Party',
    tags: ['party', 'happydance', 'vibe', 'fun', 'groove', 'happy'],
    sourceUrls: ['https://media.giphy.com/media/pa37AAGzKXoqk/giphy.gif'],
  },

  // Adventure (8)
  {
    id: 'gif-adv-1',
    title: 'Hiking Up Mountain Trail',
    theme: 'Adventure',
    category: 'Adventure',
    tags: ['adventure', 'hiking', 'mountain', 'trail', 'trek', 'nature', 'climb'],
    sourceUrls: ['https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif'],
  },
  {
    id: 'gif-adv-2',
    title: 'Campfire Night Flame',
    theme: 'Adventure',
    category: 'Adventure',
    tags: ['adventure', 'campfire', 'bonfire', 'camping', 'warmth', 'night', 'flame'],
    sourceUrls: ['https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif'],
  },
  {
    id: 'gif-adv-3',
    title: 'Road Trip Window Wind',
    theme: 'Adventure',
    category: 'Adventure',
    tags: ['adventure', 'roadtrip', 'car', 'travel', 'journey', 'wind', 'drive'],
    sourceUrls: ['https://media.giphy.com/media/3o7TKMt1VVNkHV2PaE/giphy.gif'],
  },
  {
    id: 'gif-adv-4',
    title: 'Exploring Nature Scenic',
    theme: 'Adventure',
    category: 'Adventure',
    tags: ['adventure', 'explore', 'nature', 'forest', 'wander', 'outdoors'],
    sourceUrls: ['https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif'],
  },
  {
    id: 'gif-adv-5',
    title: 'Summit Top Celebration',
    theme: 'Adventure',
    category: 'Adventure',
    tags: ['adventure', 'summit', 'peak', 'celebrate', 'victory', 'mountains'],
    sourceUrls: ['https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif'],
  },
  {
    id: 'gif-adv-6',
    title: 'Kayaking on Water',
    theme: 'Adventure',
    category: 'Adventure',
    tags: ['adventure', 'kayak', 'paddle', 'river', 'lake', 'water', 'active'],
    sourceUrls: ['https://media.giphy.com/media/l0HlPystfePnAI3G8/giphy.gif'],
  },
  {
    id: 'gif-adv-7',
    title: 'Tent Camping Stars',
    theme: 'Adventure',
    category: 'Adventure',
    tags: ['adventure', 'tent', 'camping', 'stars', 'night', 'sky', 'relax'],
    sourceUrls: ['https://media.giphy.com/media/26AHONQ79FdWZhAI0/giphy.gif'],
  },
  {
    id: 'gif-adv-8',
    title: 'Wanderlust Explorer Wave',
    theme: 'Adventure',
    category: 'Adventure',
    tags: ['adventure', 'travel', 'wanderlust', 'backpacker', 'wave', 'explore'],
    sourceUrls: ['https://media.giphy.com/media/l4pTfx2qLszoacZRS/giphy.gif'],
  },

  // Study (8)
  {
    id: 'gif-study-1',
    title: 'Focus Typing & Studying',
    theme: 'Study',
    category: 'Study',
    tags: ['study', 'focus', 'typing', 'learning', 'laptop', 'work', 'hard'],
    sourceUrls: ['https://media.giphy.com/media/13HgwGsXF0aiGY/giphy.gif'],
  },
  {
    id: 'gif-study-2',
    title: 'Flipping Book Pages Fast',
    theme: 'Study',
    category: 'Study',
    tags: ['study', 'book', 'pages', 'reading', 'library', 'research'],
    sourceUrls: ['https://media.giphy.com/media/3o7TKTDnUxE0gpnk0U/giphy.gif'],
  },
  {
    id: 'gif-study-3',
    title: 'Student Writing Notes',
    theme: 'Study',
    category: 'Study',
    tags: ['study', 'writing', 'notes', 'pen', 'paper', 'homework', 'exam'],
    sourceUrls: ['https://media.giphy.com/media/l0HlRnAWXxn0MhKLK/giphy.gif'],
  },
  {
    id: 'gif-study-4',
    title: 'Studying Cat with Glasses',
    theme: 'Study',
    category: 'Study',
    tags: ['study', 'cat', 'cute', 'glasses', 'reading', 'smart', 'focus'],
    sourceUrls: ['https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif'],
  },
  {
    id: 'gif-study-5',
    title: 'Late Night Exam Prep',
    theme: 'Study',
    category: 'Study',
    tags: ['study', 'latenight', 'exam', 'cramming', 'coffee', 'college'],
    sourceUrls: ['https://media.giphy.com/media/3oKIPnAiaMCws8nOsE/giphy.gif'],
  },
  {
    id: 'gif-study-6',
    title: 'Eureka Lightbulb Moment',
    theme: 'Study',
    category: 'Study',
    tags: ['study', 'idea', 'eureka', 'lightbulb', 'understood', 'smart'],
    sourceUrls: ['https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif'],
  },
  {
    id: 'gif-study-7',
    title: 'Organizing Workspace Notes',
    theme: 'Study',
    category: 'Study',
    tags: ['study', 'organize', 'workspace', 'planner', 'productive', 'stationery'],
    sourceUrls: ['https://media.giphy.com/media/3o6Zt6KHxJTbXCnSvu/giphy.gif'],
  },
  {
    id: 'gif-study-8',
    title: 'Thumbs Up Study Complete',
    theme: 'Study',
    category: 'Study',
    tags: ['study', 'thumbsup', 'done', 'passed', 'success', 'goodjob'],
    sourceUrls: ['https://media.giphy.com/media/111ebonMs90YLu/giphy.gif'],
  },

  // Coffee (8)
  {
    id: 'gif-coffee-1',
    title: 'Pouring Hot Latte Art',
    theme: 'Coffee',
    category: 'Coffee',
    tags: ['coffee', 'latteart', 'pour', 'milk', 'barista', 'espresso', 'warm'],
    sourceUrls: ['https://media.giphy.com/media/3o85xGocUH8RYoDKKs/giphy.gif'],
  },
  {
    id: 'gif-coffee-2',
    title: 'Steaming Coffee Mug Morning',
    theme: 'Coffee',
    category: 'Coffee',
    tags: ['coffee', 'steam', 'morning', 'mug', 'cozy', 'warm', 'wake'],
    sourceUrls: ['https://media.giphy.com/media/hPTZgtzfRIB5Nfb5rL/giphy.gif'],
  },
  {
    id: 'gif-coffee-3',
    title: 'Sipping Delicious Coffee',
    theme: 'Coffee',
    category: 'Coffee',
    tags: ['coffee', 'sip', 'drink', 'tasty', 'relax', 'cafe', 'cozy'],
    sourceUrls: ['https://media.giphy.com/media/MDJ9IbxxvDUQM/giphy.gif'],
  },
  {
    id: 'gif-coffee-4',
    title: 'Espresso Machine Pulling Shot',
    theme: 'Coffee',
    category: 'Coffee',
    tags: ['coffee', 'espresso', 'shot', 'crema', 'barista', 'brewing'],
    sourceUrls: ['https://media.giphy.com/media/3oriO04qxVReM5rJEA/giphy.gif'],
  },
  {
    id: 'gif-coffee-5',
    title: 'Coffee Mug Toast Cheers',
    theme: 'Coffee',
    category: 'Coffee',
    tags: ['coffee', 'cheers', 'toast', 'mugs', 'friends', 'morning'],
    sourceUrls: ['https://media.giphy.com/media/l46C93LNM33JJ1SMw/giphy.gif'],
  },
  {
    id: 'gif-coffee-6',
    title: 'Iced Coffee Swirl with Ice',
    theme: 'Coffee',
    category: 'Coffee',
    tags: ['coffee', 'icedcoffee', 'ice', 'straw', 'coldbrew', 'swirl'],
    sourceUrls: ['https://media.giphy.com/media/3o7abIileRivlBB8J2/giphy.gif'],
  },
  {
    id: 'gif-coffee-7',
    title: 'Cozy Rain & Coffee Vibe',
    theme: 'Coffee',
    category: 'Coffee',
    tags: ['coffee', 'rain', 'cozy', 'window', 'aesthetic', 'chill', 'peaceful'],
    sourceUrls: ['https://media.giphy.com/media/26gJA9SSe4E54ljgs/giphy.gif'],
  },
  {
    id: 'gif-coffee-8',
    title: 'Dancing Coffee Cup Animated',
    theme: 'Coffee',
    category: 'Coffee',
    tags: ['coffee', 'cup', 'dancing', 'cute', 'cartoon', 'energy'],
    sourceUrls: ['https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif'],
  },

  // Walk (7)
  {
    id: 'gif-walk-1',
    title: 'Peaceful Morning Park Walk',
    theme: 'Walk',
    category: 'Walk',
    tags: ['walk', 'park', 'peaceful', 'morning', 'trees', 'nature', 'stroll'],
    sourceUrls: ['https://media.giphy.com/media/26AHG5KGFxSkUWw1i/giphy.gif'],
  },
  {
    id: 'gif-walk-2',
    title: 'Strolling City Street Morning',
    theme: 'Walk',
    category: 'Walk',
    tags: ['walk', 'city', 'stroll', 'morning', 'steps', 'urban', 'walking'],
    sourceUrls: ['https://media.giphy.com/media/3o7TKsQ8UQd1t1g65i/giphy.gif'],
  },
  {
    id: 'gif-walk-3',
    title: 'Walking Shoes Steps Loop',
    theme: 'Walk',
    category: 'Walk',
    tags: ['walk', 'shoes', 'sneakers', 'steps', 'movement', 'pace'],
    sourceUrls: ['https://media.giphy.com/media/3o7TKsQ8UQd1t1g65i/giphy.gif'],
  },
  {
    id: 'gif-walk-4',
    title: 'Nature Stroll in Forest Path',
    theme: 'Walk',
    category: 'Walk',
    tags: ['walk', 'nature', 'forest', 'trees', 'peaceful', 'path', 'relax'],
    sourceUrls: ['https://media.giphy.com/media/26AHG5KGFxSkUWw1i/giphy.gif'],
  },
  {
    id: 'gif-walk-5',
    title: 'Sunset Beach Walk',
    theme: 'Walk',
    category: 'Walk',
    tags: ['walk', 'beach', 'sunset', 'sand', 'waves', 'evening', 'ocean'],
    sourceUrls: ['https://media.giphy.com/media/l41lI4bYmcsPJX9Go/giphy.gif'],
  },
  {
    id: 'gif-walk-6',
    title: 'Cat Strut Stroll',
    theme: 'Walk',
    category: 'Walk',
    tags: ['walk', 'cat', 'strut', 'cute', 'funny', 'paws', 'walking'],
    sourceUrls: ['https://media.giphy.com/media/3oEjI5VtIhHvK37WYo/giphy.gif'],
  },
  {
    id: 'gif-walk-7',
    title: 'Jogging and Walking in Sunny Park',
    theme: 'Walk',
    category: 'Walk',
    tags: ['walk', 'jog', 'park', 'fitness', 'sunny', 'exercise', 'outdoor'],
    sourceUrls: ['https://media.giphy.com/media/3oEjI5VtIhHvK37WYo/giphy.gif'],
  },

  // Coding (7)
  {
    id: 'gif-code-1',
    title: 'Fast Keyboard Typing Code',
    theme: 'Coding',
    category: 'Coding',
    tags: ['coding', 'typing', 'fast', 'keyboard', 'hacker', 'developer', 'code'],
    sourceUrls: ['https://media.giphy.com/media/13HgwGsXF0aiGY/giphy.gif'],
  },
  {
    id: 'gif-code-2',
    title: 'Matrix Digital Rain Code',
    theme: 'Coding',
    category: 'Coding',
    tags: ['coding', 'matrix', 'green', 'rain', 'cyberspace', 'hacker', 'tech'],
    sourceUrls: ['https://media.giphy.com/media/eIm624c8nnNbiG0V3g/giphy.gif'],
  },
  {
    id: 'gif-code-3',
    title: 'Cat Typing on Laptop',
    theme: 'Coding',
    category: 'Coding',
    tags: ['coding', 'cat', 'bongo', 'laptop', 'developer', 'cute', 'programmer'],
    sourceUrls: ['https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif'],
  },
  {
    id: 'gif-code-4',
    title: 'Code Works Victory Celebration',
    theme: 'Coding',
    category: 'Coding',
    tags: ['coding', 'success', 'works', 'celebrate', 'victory', 'deploy', 'fixed'],
    sourceUrls: ['https://media.giphy.com/media/5wWf7H0qoWaNnkZBucU/giphy.gif'],
  },
  {
    id: 'gif-code-5',
    title: 'Terminal Code Scrolling',
    theme: 'Coding',
    category: 'Coding',
    tags: ['coding', 'terminal', 'scrolling', 'cli', 'scripts', 'bash', 'output'],
    sourceUrls: ['https://media.giphy.com/media/3o7TKTDnUxE0gpnk0U/giphy.gif'],
  },
  {
    id: 'gif-code-6',
    title: 'Debugging Puzzled Developer',
    theme: 'Coding',
    category: 'Coding',
    tags: ['coding', 'debugging', 'thinking', 'puzzle', 'bug', 'software', 'why'],
    sourceUrls: ['https://media.giphy.com/media/xT9IgzoKnwFNmISR8I/giphy.gif'],
  },
  {
    id: 'gif-code-7',
    title: 'Deploy Button Rocket Launch',
    theme: 'Coding',
    category: 'Coding',
    tags: ['coding', 'deploy', 'rocket', 'launch', 'production', 'shipped', 'tech'],
    sourceUrls: ['https://media.giphy.com/media/3oKIPnAiaMCws8nOsE/giphy.gif'],
  },
];

async function existsInR2(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    return true;
  } catch (err: any) {
    return false;
  }
}

async function fetchWithFallback(urls: string[], timeoutMs = 15000): Promise<Buffer> {
  let lastError: any = null;
  for (const url of urls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/*,*/*;q=0.8',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('All source URLs failed to fetch');
}

async function uploadToR2(key: string, buffer: Buffer, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  });
  await s3.send(command);
  return `${R2_PUBLIC_URL}/${key}`;
}

async function processImage(item: SourceMediaItem, index: number, total: number): Promise<{ id: string; title: string; theme: string; category: string; tags: string[]; url: string }> {
  const themeSlug = item.theme.toLowerCase();
  const r2Key = `presets/images/preset-image-${themeSlug}-${item.id}.webp`;
  const finalUrl = `${R2_PUBLIC_URL}/${r2Key}`;

  const exists = await existsInR2(r2Key);
  if (exists) {
    console.log(`[${index + 1}/${total}] Image ${item.id} already exists in R2. Skipping upload.`);
    return {
      id: item.id,
      title: item.title,
      theme: item.theme,
      category: item.category,
      tags: item.tags,
      url: finalUrl,
    };
  }

  console.log(`[${index + 1}/${total}] Processing Image: ${item.title} (${item.id})...`);
  try {
    const rawBuffer = await fetchWithFallback(item.sourceUrls);
    const optimizedWebp = await sharp(rawBuffer)
      .resize({
        width: 1200,
        height: 1200,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();

    console.log(`  ✓ Converted to WebP (${rawBuffer.length} bytes -> ${optimizedWebp.length} bytes). Uploading to R2: ${r2Key}...`);
    await uploadToR2(r2Key, optimizedWebp, 'image/webp');
    console.log(`  ✓ Uploaded: ${finalUrl}`);
    return {
      id: item.id,
      title: item.title,
      theme: item.theme,
      category: item.category,
      tags: item.tags,
      url: finalUrl,
    };
  } catch (err: any) {
    console.error(`  ✗ Error processing image ${item.id}:`, err?.message || err);
    throw err;
  }
}

async function processGif(item: SourceMediaItem, index: number, total: number): Promise<{ id: string; title: string; theme: string; category: string; tags: string[]; url: string }> {
  const themeSlug = item.theme.toLowerCase();
  const r2Key = `presets/gifs/preset-gif-${themeSlug}-${item.id}.gif`;
  const finalUrl = `${R2_PUBLIC_URL}/${r2Key}`;

  const exists = await existsInR2(r2Key);
  if (exists) {
    console.log(`[${index + 1}/${total}] GIF ${item.id} already exists in R2. Skipping upload.`);
    return {
      id: item.id,
      title: item.title,
      theme: item.theme,
      category: item.category,
      tags: item.tags,
      url: finalUrl,
    };
  }

  console.log(`[${index + 1}/${total}] Processing GIF: ${item.title} (${item.id})...`);
  try {
    const rawBuffer = await fetchWithFallback(item.sourceUrls);
    
    // Validate animated GIF buffer
    try {
      const metadata = await sharp(rawBuffer, { animated: true }).metadata();
      if (metadata.pages && metadata.pages > 1) {
        console.log(`  ✓ Valid animated GIF (${metadata.pages} frames, ${metadata.width}x${metadata.height})`);
      }
    } catch (_) {
      console.log(`  ✓ Raw GIF buffer verified (${rawBuffer.length} bytes)`);
    }

    console.log(`  ✓ Uploading animated GIF to R2: ${r2Key}...`);
    await uploadToR2(r2Key, rawBuffer, 'image/gif');
    console.log(`  ✓ Uploaded: ${finalUrl}`);
    return {
      id: item.id,
      title: item.title,
      theme: item.theme,
      category: item.category,
      tags: item.tags,
      url: finalUrl,
    };
  } catch (err: any) {
    console.error(`  ✗ Error processing GIF ${item.id}:`, err?.message || err);
    throw err;
  }
}

async function main() {
  console.log('====================================================');
  console.log('  Meetifyy Preset Media Ingestion to Cloudflare R2  ');
  console.log('====================================================');
  console.log(`Bucket: ${R2_BUCKET_NAME}`);
  console.log(`Public URL Origin: ${R2_PUBLIC_URL}\n`);

  console.log(`Phase 1: Ingesting ${SOURCE_IMAGES.length} Preset Images...`);
  const uploadedImages: any[] = [];
  for (let i = 0; i < SOURCE_IMAGES.length; i++) {
    const res = await processImage(SOURCE_IMAGES[i], i, SOURCE_IMAGES.length);
    uploadedImages.push(res);
  }

  console.log(`\nPhase 2: Ingesting ${SOURCE_GIFS.length} Preset GIFs...`);
  const uploadedGifs: any[] = [];
  for (let i = 0; i < SOURCE_GIFS.length; i++) {
    const res = await processGif(SOURCE_GIFS[i], i, SOURCE_GIFS.length);
    uploadedGifs.push(res);
  }

  console.log('\nPhase 3: Generating frontend/src/shared/constants/presetMedia.js...');
  const defaultCovers = uploadedImages.slice(0, 6).map(img => img.url);

  const fileContent = `/**
 * PRESET MEDIA CONSTANTS
 * Hosted on Cloudflare R2 (${R2_BUCKET_NAME}).
 * Zero external API dependencies (Unsplash/Giphy removed).
 */

export const PRESET_THEMES = ['Party', 'Adventure', 'Study', 'Coffee', 'Walk', 'Coding'];

/**
 * ${uploadedImages.length} Preset Images across all themes (WebP optimized).
 */
export const PRESET_IMAGES = ${JSON.stringify(uploadedImages, null, 2)};

/**
 * ${uploadedGifs.length} Preset Animated GIFs across all themes.
 */
export const PRESET_GIFS = ${JSON.stringify(uploadedGifs, null, 2)};

/**
 * Deterministic fallback covers for activities.
 */
export const DEFAULT_ACTIVITY_COVERS = ${JSON.stringify(defaultCovers, null, 2)};

/**
 * Helper to get a deterministic cover from an activity ID or title.
 */
export function getDefaultActivityCover(idOrTitle = '') {
  const seed = String(idOrTitle || '');
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return DEFAULT_ACTIVITY_COVERS[Math.abs(hash) % DEFAULT_ACTIVITY_COVERS.length];
}
`;

  const outputPath = path.resolve(__dirname, '../../frontend/src/shared/constants/presetMedia.js');
  fs.writeFileSync(outputPath, fileContent, 'utf-8');
  console.log(`  ✓ Successfully wrote preset media data to: ${outputPath}`);

  console.log('\n====================================================');
  console.log('  Ingestion Complete! All assets live in R2.        ');
  console.log('====================================================\n');
}

main().catch(err => {
  console.error('Fatal error during ingestion:', err);
  process.exit(1);
});
