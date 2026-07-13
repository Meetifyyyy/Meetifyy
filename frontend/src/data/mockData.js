export const initialUsers = {
  alicechen: {
    id: 'u1',
    username: 'alicechen',
    displayName: 'Alice Chen',
    avatar: 'A',
    avatarUrl: null,
    bio: 'Building cool stuff & meeting awesome people. I love experimenting with new technologies, creating unique user experiences, and exploring the unknown.',
    location: 'New York, NY',
    role: 'Full-stack Developer',
    email: 'alicechen@meetifyy.app',
    followingList: ['marcusrivera', 'priyasharma', 'sammydoe'],
    followersList: ['marcusrivera', 'priyasharma', 'sammydoe', 'alexq', 'chrisb', 'johnsonw', 'sarahj', 'student'],
    followers: 8401,
    following: 161,
    communities: ['Startup Hub', 'Hackathon Heroes', 'GLA University'],
    course: 'B.Tech CS',
    year: '4th Year',
    collegeId: 'gla',
    verified: true,
    interests: ['AI', 'Startups', 'Product Design', 'Web Development', 'Hackathons', 'Open Source'],
    skills: ['React', 'Node.js', 'Figma', 'Python', 'Machine Learning', 'TypeScript', 'Next.js'],
    projects: [
      {
        id: 'proj_1',
        title: 'Meetifyy',
        description: 'Social platform connecting college students through shared interests, communities, and events.',
        technologies: ['React', 'Node.js', 'MongoDB', 'WebSocket'],
        image: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=600&h=400&fit=crop',
        link: '#',
        type: 'Project'
      },
      {
        id: 'proj_2',
        title: 'AI Study Buddy',
        description: 'An AI-powered study assistant built during a 48-hour hackathon using Whisper + GPT-4o.',
        technologies: ['Python', 'OpenAI', 'React Native', 'FastAPI'],
        image: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600&h=400&fit=crop',
        link: '#',
        type: 'Hackathon Project'
      }
    ],
    achievements: [
      { id: 'ach_1', title: 'Best Hackathon Project', description: 'Won first place at HackMIT 2025', icon: '🏆', date: 'Mar 2025' },
      { id: 'ach_2', title: '100 Days of Code', description: 'Completed 100 consecutive days of coding', icon: '💻', date: 'Jan 2025' },
      { id: 'ach_3', title: 'Top Contributor', description: 'Most active member in Startup Hub community', icon: '⭐', date: 'Dec 2024' }
    ],
    activityLog: [
      { type: 'post', text: 'Built a project at Hackathon Heroes', icon: '🚀', time: '2 hours ago', link: '#' },
      { type: 'post', text: 'Posted in AI/ML Enthusiasts', icon: '🤖', time: '5 hours ago', link: '#' },
      { type: 'join', text: 'Joined Startup Hub', icon: '🎉', time: '3 days ago', link: '/communities/startup' },
      { type: 'achievement', text: 'Won a design challenge', icon: '🏆', time: '1 week ago', link: '#' },
      { type: 'milestone', text: 'Reached 8K followers', icon: '🌟', time: '2 weeks ago', link: '#' },
      { type: 'event', text: 'Attended Tech Fest 2026', icon: '📅', time: '3 weeks ago', link: '#' },
      { type: 'discussion', text: 'Started discussion in GLA University', icon: '💬', time: '1 month ago', link: '#' }
    ],
    socialLinks: {
      github: 'https://github.com/alicechen',
      linkedin: 'https://linkedin.com/in/alicechen',
      twitter: 'https://twitter.com/alicechen',
      website: 'https://alicechen.dev'
    },
    communitiesJoined: 5,
    eventsAttended: 12,
    connectionsMade: 48,
    projectsShared: 7,
    postsThisMonth: 12,
    profileVisitsThisWeek: 47,
    newConnectionsThisWeek: 3,
    recentlyActive: true,
    memberSince: 'Aug 2023'
  },
  marcusrivera: {
    id: 'u2',
    username: 'marcusrivera',
    displayName: 'Marcus Rivera',
    avatar: 'M',
    avatarUrl: null,
    bio: 'Product Designer focused on mental wellness and accessible UX. Always looking for new challenges.',
    location: 'San Francisco, CA',
    role: 'UI/UX Designer',
    email: 'marcus@meetifyy.app',
    followingList: ['alicechen', 'chrisb', 'priyasharma'],
    followersList: ['alicechen', 'priyasharma', 'alexq', 'chrisb', 'sarahj', 'student'],
    followers: 5230,
    following: 340,
    communities: ['Design Buddies', 'IIT Delhi', 'Startup Hub'],
    course: 'B.Tech IT',
    year: '3rd Year',
    collegeId: 'iitdelhi',
    verified: false,
    interests: ['UI/UX Design', 'Mental Health Tech', 'Accessibility', 'Design Systems', 'Branding'],
    skills: ['Figma', 'Adobe XD', 'Prototyping', 'User Research', 'CSS/SCSS', 'Design Tokens'],
    projects: [
      {
        id: 'proj_3',
        title: 'MindWell App',
        description: 'Mental wellness app focused on accessible UX and inclusive design principles.',
        technologies: ['Figma', 'React Native', 'TypeScript'],
        image: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=600&h=400&fit=crop',
        link: '#',
        type: 'Project'
      }
    ],
    achievements: [
      { id: 'ach_4', title: 'Design System Award', description: 'Recognized for building a comprehensive design system', icon: '🎨', date: 'Feb 2025' }
    ],
    activityLog: [
      { type: 'post', text: 'Shared a UX research case study', icon: '📝', time: '1 day ago', link: '#' },
      { type: 'join', text: 'Joined Design Buddies', icon: '🎉', time: '1 week ago', link: '/communities/design' },
      { type: 'event', text: 'Attended UX Summit 2026', icon: '📅', time: '2 weeks ago', link: '#' }
    ],
    socialLinks: {
      linkedin: 'https://linkedin.com/in/marcusrivera',
      website: 'https://marcusrivera.design'
    },
    communitiesJoined: 3,
    eventsAttended: 8,
    connectionsMade: 24,
    projectsShared: 3,
    postsThisMonth: 5,
    profileVisitsThisWeek: 32,
    newConnectionsThisWeek: 1,
    recentlyActive: true,
    memberSince: 'Oct 2023'
  },
  priyasharma: {
    id: 'u3',
    username: 'priyasharma',
    displayName: 'Priya Sharma',
    avatar: 'P',
    avatarUrl: null,
    bio: 'Self-taught ML Engineer. Passionate about democratizing AI education.',
    location: 'Remote',
    role: 'ML Engineer',
    email: 'priya@meetifyy.app',
    followingList: ['alicechen', 'marcusrivera', 'sammydoe'],
    followersList: ['alicechen', 'marcusrivera', 'sammydoe', 'johnsonw', 'student'],
    followers: 12500,
    following: 50,
    communities: ['AI/ML Enthusiasts', 'GLA University', 'Hackathon Heroes'],
    course: 'BCA',
    year: '2nd Year',
    collegeId: 'gla',
    verified: true,
    interests: ['Machine Learning', 'AI Education', 'Open Source', 'NLP', 'Deep Learning'],
    skills: ['Python', 'TensorFlow', 'PyTorch', 'Scikit-learn', 'Hugging Face', 'SQL'],
    projects: [
      {
        id: 'proj_4',
        title: 'EduAI Platform',
        description: 'Democratizing AI education through interactive tutorials and hands-on projects.',
        technologies: ['Python', 'Streamlit', 'Hugging Face', 'Docker'],
        image: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=600&h=400&fit=crop',
        link: '#',
        type: 'Project'
      }
    ],
    achievements: [
      { id: 'ach_5', title: 'AI Educator Award', description: 'Recognized for contributions to AI education', icon: '🎓', date: 'Jan 2025' },
      { id: 'ach_6', title: 'Paper Published', description: 'Co-authored a paper on accessible ML education', icon: '📄', date: 'Nov 2024' }
    ],
    activityLog: [
      { type: 'post', text: 'Shared ML learning resources', icon: '🤖', time: '3 hours ago', link: '#' },
      { type: 'milestone', text: 'Reached 12.5K followers', icon: '🌟', time: '1 week ago', link: '#' },
      { type: 'discussion', text: 'Started AI study group', icon: '💬', time: '2 weeks ago', link: '#' }
    ],
    socialLinks: {
      github: 'https://github.com/priyasharma',
      twitter: 'https://twitter.com/priyasharma'
    },
    communitiesJoined: 4,
    eventsAttended: 15,
    connectionsMade: 89,
    projectsShared: 5,
    postsThisMonth: 18,
    profileVisitsThisWeek: 89,
    newConnectionsThisWeek: 7,
    recentlyActive: true,
    memberSince: 'Jan 2024'
  },
  sammydoe: {
    id: 'u4',
    username: 'sammydoe',
    displayName: 'Sammy Doe',
    avatar: 'S',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?fit=crop&w=150&h=150',
    bio: 'Frontend enthusiast. Glassmorphism is the future.',
    location: 'London, UK',
    role: 'Frontend Dev',
    email: 'sammy@meetifyy.app',
    followingList: ['alicechen', 'priyasharma', 'alexq', 'johnsonw'],
    followersList: ['alicechen', 'priyasharma', 'johnsonw'],
    followers: 1200,
    following: 400,
    communities: ['Design Buddies', 'IIT Delhi', 'Gaming & E-Sports'],
    course: 'MCA',
    year: '1st Year',
    collegeId: 'iitdelhi',
    verified: false,
    interests: ['Frontend', 'CSS Art', 'WebGL', 'Three.js', 'UI Animation'],
    skills: ['React', 'Three.js', 'CSS/SASS', 'JavaScript', 'WebGL', 'GSAP'],
    projects: [],
    achievements: [],
    activityLog: [
      { type: 'post', text: 'Deployed portfolio with Three.js', icon: '🌍', time: '2 days ago', link: '#' }
    ],
    socialLinks: {
      github: 'https://github.com/sammydoe',
      website: 'https://sammydoe.dev'
    },
    communitiesJoined: 3,
    eventsAttended: 2,
    connectionsMade: 15,
    projectsShared: 1,
    postsThisMonth: 3,
    profileVisitsThisWeek: 12,
    newConnectionsThisWeek: 0,
    recentlyActive: false,
    memberSince: 'Mar 2024'
  },
  alexq: {
    id: 'u5',
    username: 'alexq',
    displayName: 'Alex Q.',
    avatar: 'A',
    avatarUrl: null,
    bio: 'Hardware engineer turning software. Building IoT projects and exploring Rust for embedded systems.',
    location: 'Austin, TX',
    role: 'Software Engineer',
    email: 'alexq@meetifyy.app',
    followingList: ['alicechen', 'marcusrivera', 'sarahj'],
    followersList: ['sammydoe', 'sarahj'],
    followers: 890,
    following: 120,
    communities: ['GLA University', 'AI/ML Enthusiasts'],
    course: 'B.Tech ME',
    year: '4th Year',
    collegeId: 'gla',
    verified: false,
    interests: ['Embedded Systems', 'IoT', 'Rust', 'AI'],
    skills: ['C++', 'Rust', 'Python', 'Arduino', 'Embedded Linux'],
    projects: [
      {
        id: 'proj_alex_1',
        title: 'SmartHome Controller',
        description: 'A Rust-based embedded controller for home automation, running on Raspberry Pi.',
        technologies: ['Rust', 'MQTT', 'Raspberry Pi', 'React'],
        image: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&h=400&fit=crop',
        link: '#',
        type: 'Project'
      }
    ],
    achievements: [
      { id: 'ach_alex_1', title: 'Open Source Contributor', description: 'Merged 10 PRs into embedded Rust projects', icon: '🦀', date: 'Apr 2025' }
    ],
    activityLog: [
      { type: 'post', text: 'Posted about Rust & ML integration', icon: '🦀', time: '2 days ago', link: '#' },
      { type: 'join', text: 'Joined AI/ML Enthusiasts', icon: '🎉', time: '2 months ago', link: '/communities/aiml' }
    ],
    socialLinks: {},
    communitiesJoined: 2,
    eventsAttended: 4,
    connectionsMade: 8,
    projectsShared: 0,
    postsThisMonth: 1,
    profileVisitsThisWeek: 5,
    newConnectionsThisWeek: 0,
    recentlyActive: false,
    memberSince: 'Jun 2024'
  },
  chrisb: {
    id: 'u6',
    username: 'chrisb',
    displayName: 'Chris B.',
    avatar: 'C',
    avatarUrl: null,
    bio: 'Design system advocate & PM. Building bridges between design and engineering teams.',
    location: 'Toronto, CA',
    role: 'Product Manager',
    email: 'chrisb@meetifyy.app',
    followingList: ['marcusrivera', 'alicechen'],
    followersList: ['marcusrivera'],
    followers: 3400,
    following: 200,
    communities: ['Design Buddies', 'IIT Delhi', 'Startup Hub'],
    course: 'BBA',
    year: '3rd Year',
    collegeId: 'iitdelhi',
    verified: false,
    interests: ['Product Management', 'Design Systems', 'Agile', 'User Research'],
    skills: ['Jira', 'Figma', 'Analytics', 'A/B Testing', 'Roadmapping'],
    projects: [
      {
        id: 'proj_chris_1',
        title: 'DesignOps Playbook',
        description: 'An open-source guide for scaling design systems across large product teams.',
        technologies: ['Figma', 'Notion', 'Storybook'],
        image: 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=600&h=400&fit=crop',
        link: '#',
        type: 'Resource'
      }
    ],
    achievements: [
      { id: 'ach_chris_1', title: 'Product Lead', description: 'Led product launch for a 0-to-1 SaaS tool with 500 beta users', icon: '🚀', date: 'May 2025' }
    ],
    activityLog: [
      { type: 'post', text: 'Shared DesignOps playbook', icon: '📋', time: '1 week ago', link: '#' },
      { type: 'join', text: 'Joined Design Buddies', icon: '🎉', time: '3 months ago', link: '/communities/design' }
    ],
    socialLinks: {
      linkedin: 'https://linkedin.com/in/chrisb'
    },
    communitiesJoined: 3,
    eventsAttended: 6,
    connectionsMade: 32,
    projectsShared: 0,
    postsThisMonth: 2,
    profileVisitsThisWeek: 18,
    newConnectionsThisWeek: 1,
    recentlyActive: false,
    memberSince: 'Apr 2024'
  },
  johnsonw: {
    id: 'u7',
    username: 'johnsonw',
    displayName: 'Johnson Wood',
    avatar: 'J',
    bio: 'Tech enthusiast & gamer. Exploring web3 and game dev.',
    location: 'Seattle, WA',
    role: 'Game Developer',
    email: 'johnson@meetifyy.app',
    followingList: ['alicechen', 'priyasharma', 'sammydoe'],
    followersList: ['sammydoe', 'sarahj'],
    followers: 1450,
    following: 210,
    communities: ['Hackathon Heroes', 'Gaming & E-Sports', 'GLA University'],
    course: 'B.Sc Gaming',
    year: '2nd Year',
    collegeId: 'gla',
    verified: false,
    interests: ['Game Development', 'Web3', 'Unity', 'Unreal Engine', 'Pixel Art'],
    skills: ['Unity', 'C#', 'Blender', 'Unreal Engine', 'Solidity'],
    projects: [
      {
        id: 'proj_5',
        title: 'Pixel Quest',
        description: 'A 2D platformer built in Unity with procedurally generated levels.',
        technologies: ['Unity', 'C#', 'Aseprite'],
        image: 'https://images.unsplash.com/photo-1551103782-8ab07afd45c1?w=600&h=400&fit=crop',
        link: '#',
        type: 'Game'
      }
    ],
    achievements: [
      { id: 'ach_7', title: 'Game Jam Winner', description: 'Won Global Game Jam 2025', icon: '🎮', date: 'Jan 2025' }
    ],
    activityLog: [
      { type: 'post', text: 'Looking for 3D artist for game jam', icon: '🎮', time: '3 days ago', link: '#' }
    ],
    socialLinks: {
      github: 'https://github.com/johnsonw',
      website: 'https://johnsonw.dev'
    },
    communitiesJoined: 3,
    eventsAttended: 7,
    connectionsMade: 22,
    projectsShared: 2,
    postsThisMonth: 4,
    profileVisitsThisWeek: 15,
    newConnectionsThisWeek: 2,
    recentlyActive: true,
    memberSince: 'May 2024'
  },
  sarahj: {
    id: 'u8',
    username: 'sarahj',
    displayName: 'Sarah Jones',
    avatar: 'S',
    avatarUrl: null,
    bio: 'Backend wizard. Rust ace. Contributor to open-source distributed systems projects.',
    location: 'Berlin, DE',
    role: 'Backend Engineer',
    email: 'sarahj@meetifyy.app',
    followingList: ['alicechen', 'marcusrivera', 'johnsonw', 'alexq'],
    followersList: ['alexq', 'johnsonw'],
    followers: 4300,
    following: 120,
    communities: ['Startup Hub', 'IIT Delhi', 'Hackathon Heroes'],
    course: 'M.Tech CSE',
    year: '2nd Year',
    collegeId: 'iitdelhi',
    verified: false,
    interests: ['Backend', 'Rust', 'Systems Programming', 'Distributed Systems'],
    skills: ['Rust', 'Go', 'PostgreSQL', 'Redis', 'Docker', 'Kubernetes'],
    projects: [
      {
        id: 'proj_sarah_1',
        title: 'RustDB',
        description: 'A lightweight key-value store written in Rust, inspired by Redis.',
        technologies: ['Rust', 'Tokio', 'RESP Protocol'],
        image: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=600&h=400&fit=crop',
        link: '#',
        type: 'Open Source'
      }
    ],
    achievements: [
      { id: 'ach_sarah_1', title: 'Distributed Systems Award', description: 'Contributed a critical fix to a major open-source project', icon: '🔧', date: 'Mar 2025' }
    ],
    activityLog: [
      { type: 'post', text: 'Shared Rust library for ML inference', icon: '🦀', time: '4 hours ago', link: '#' },
      { type: 'milestone', text: 'Hit 4K followers', icon: '🌟', time: '2 weeks ago', link: '#' },
      { type: 'join', text: 'Joined Hackathon Heroes', icon: '🎉', time: '4 months ago', link: '/communities/hackathon' }
    ],
    socialLinks: {
      github: 'https://github.com/sarahj'
    },
    communitiesJoined: 3,
    eventsAttended: 9,
    connectionsMade: 40,
    projectsShared: 1,
    postsThisMonth: 2,
    profileVisitsThisWeek: 22,
    newConnectionsThisWeek: 0,
    recentlyActive: false,
    memberSince: 'Sep 2023'
  },
  student: {
    id: 'u9',
    username: 'student',
    password: 'gla123',
    displayName: 'GLA Student',
    avatar: 'S',
    avatarUrl: null,
    bio: 'Student at GLA University.',
    location: 'Mathura, India',
    role: 'Student',
    email: 'student@gla.ac.in',
    followingList: ['alicechen', 'marcusrivera', 'priyasharma'],
    followersList: ['alicechen'],
    followers: 12,
    following: 34,
    communities: ['GLA University'],
    course: 'B.Tech CS',
    year: '1st Year',
    collegeId: 'gla',
    verified: true,
    interests: ['Programming', 'Technology'],
    skills: ['C++', 'Python', 'Web Dev'],
    projects: [],
    achievements: [],
    activityLog: [],
    socialLinks: {},
    communitiesJoined: 1,
    eventsAttended: 0,
    connectionsMade: 5,
    projectsShared: 0,
    postsThisMonth: 0,
    profileVisitsThisWeek: 2,
    newConnectionsThisWeek: 1,
    recentlyActive: true,
    memberSince: 'Jun 2026'
  }
};

export const initialPosts = [
  {
    id: 'f_main_1',
    authorId: 'u1',
    time: '2 hours ago',
    text: "Just wrapped our 48-hour hackathon with @marcusrivera and @priyasharma 🚀 We built an AI-powered study assistant that generates flashcards from your lecture notes in real time. Couldn't have shipped it without this crew!",
    mentions: [
      { userId: 'u2', username: 'marcusrivera', start: 40, end: 53 },
      { userId: 'u3', username: 'priyasharma', start: 58, end: 71 }
    ],
    media: { type: 'image', url: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=900&h=550&fit=crop' },
    poll: {
      question: 'Which feature should we ship next?',
      options: ['Voice-interactive tutor', 'Figma plugin', 'Auto flashcard generation', 'Spaced repetition scheduler'],
      votes: [18, 9, 34, 22],
      selectedUsers: {}
    },
    likes: 142,
    comments: 18,
    replies: [
      {
        id: 'r_1_1',
        authorId: 'u4',
        time: '1 hour ago',
        text: 'This is genuinely impressive @alicechen — the flashcard idea is going to be huge for exam season.',
        mentions: [{ userId: 'u1', username: 'alicechen', start: 28, end: 38 }],
        likes: 11,
        isLikedByMe: false,
        replies: [
          {
            id: 'r_1_1_1',
            authorId: 'u2',
            time: '45 min ago',
            text: 'Agreed with @alexq — we should push this to Product Hunt next week!',
            mentions: [{ userId: 'u4', username: 'alexq', start: 12, end: 18 }],
            likes: 4,
            isLikedByMe: false,
            replies: []
          }
        ]
      },
      {
        id: 'r_1_2',
        authorId: 'u5',
        time: '30 min ago',
        text: 'Voted for spaced repetition — that is the missing piece in every study app I have tried.',
        mentions: [],
        likes: 6,
        isLikedByMe: false,
        replies: []
      }
    ]
  },
  {
    id: 'f_main_2',
    authorId: 'u2',
    time: '5 hours ago',
    text: "New video drop 🎬 Here is a quick demo of the WebGL fluid simulation shader @alexq and I spent the last two weekends on. The vortex dynamics are finally looking buttery smooth. Full open-source release next week — cc @chrisb for the architecture review!",
    mentions: [
      { userId: 'u4', username: 'alexq', start: 74, end: 80 },
      { userId: 'u5', username: 'chrisb', start: 226, end: 232 }
    ],
    media: { type: 'video', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4' },
    likes: 203,
    comments: 31,
    replies: []
  },
  {
    id: 'f_main_3',
    authorId: 'u3',
    time: 'Yesterday',
    text: "Design systems deep-dive this Saturday 4 PM EST with @chrisb as our special guest — he will walk through his atomic token architecture that scales from mobile to desktop without a single override. Drop your questions below 👇",
    mentions: [
      { userId: 'u5', username: 'chrisb', start: 53, end: 59 }
    ],
    media: { type: 'image', url: 'https://images.unsplash.com/photo-1558655146-d09347e92766?w=900&h=500&fit=crop' },
    poll: {
      question: 'Which token format does your team use?',
      options: ['W3C Design Tokens (JSON)', 'Tailwind config', 'CSS Custom Properties', 'Style Dictionary'],
      votes: [41, 28, 62, 17],
      selectedUsers: {}
    },
    likes: 89,
    comments: 22,
    replies: []
  },
  {
    id: 'f_main_4',
    authorId: 'u4',
    time: '2 days ago',
    text: "Big news 🎮 Our mobile game engine just passed 60 FPS on a mid-range Android device with full skeletal animation running. Shoutout to @alicechen for the physics integration and @sarahj for profiling the render thread bottlenecks.",
    mentions: [
      { userId: 'u1', username: 'alicechen', start: 135, end: 145 },
      { userId: 'u8', username: 'sarahj', start: 151, end: 158 }
    ],
    media: { type: 'video', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
    linkPreview: {
      url: 'https://github.com/',
      site: 'github.com',
      title: 'Mobile Game Engine — open beta out now',
      description: 'A lightweight, cross-platform 2D/3D game engine built in C++ with Kotlin bindings for Android.',
      image: 'https://images.unsplash.com/photo-1556438064-2d7646166914?w=300&h=160&fit=crop'
    },
    likes: 317,
    comments: 44,
    replies: []
  },
  {
    id: 'f_main_5',
    authorId: 'u1',
    time: '2 days ago',
    text: "AI code review is now part of my daily workflow thanks to @johnsonw's recommendation 🧠 Dropped my bug rate by ~40% in the first week. Here is the article that started it all — highly recommend reading it with your morning coffee ☕",
    mentions: [
      { userId: 'u6', username: 'johnsonw', start: 57, end: 66 }
    ],
    linkPreview: {
      url: 'https://martinfowler.com/',
      site: 'martinfowler.com',
      title: 'Patterns of AI-Assisted Code Review',
      description: 'How to integrate large language models into your pull-request workflow without losing the human touch.',
      image: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=300&h=160&fit=crop'
    },
    poll: {
      question: 'Do you use AI coding assistants daily?',
      options: ['Yes, for everything', 'Just debugging & boilerplate', 'Occasionally', 'Not yet'],
      votes: [112, 58, 34, 14],
      selectedUsers: {}
    },
    likes: 241,
    comments: 37,
    replies: []
  },
  {
    id: 'f_main_6',
    authorId: 'u7',
    time: '3 days ago',
    text: "Global Game Jam is 6 weeks away and I am looking for a team! I handle 3D environments and VFX. @sarahj — your distributed-systems background could be wild for the networking layer if you are in 👀",
    mentions: [
      { userId: 'u8', username: 'sarahj', start: 95, end: 102 }
    ],
    media: { type: 'video', url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4' },
    likes: 54,
    comments: 12,
    replies: []
  },
  {
    id: 'f_main_7',
    authorId: 'u5',
    time: '4 days ago',
    text: "Gave a talk at the Startup Hub last night on component-driven architecture. Slides and recording are live — link below. Huge thanks to @marcusrivera for moderating and keeping the Q&A civilised 😄",
    mentions: [
      { userId: 'u2', username: 'marcusrivera', start: 137, end: 150 }
    ],
    media: { type: 'image', url: 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=900&h=500&fit=crop' },
    linkPreview: {
      url: 'https://speakerdeck.com/',
      site: 'speakerdeck.com',
      title: 'Component-Driven Architecture at Scale — Slides',
      description: '46 slides covering atomic design, token pipelines, and micro-frontend orchestration from a real production system.',
      image: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=300&h=160&fit=crop'
    },
    likes: 178,
    comments: 28,
    replies: []
  },
  {
    id: 'f_main_8',
    authorId: 'u6',
    time: '5 days ago',
    text: "Hot take 🌶️ Most junior devs would grow faster by reading 10 carefully chosen blog posts than by grinding LeetCode for a month. Here is my reading list — @alicechen and @priyasharma both vouched for most of these. What would you add?",
    mentions: [
      { userId: 'u1', username: 'alicechen', start: 161, end: 171 },
      { userId: 'u3', username: 'priyasharma', start: 176, end: 188 }
    ],
    poll: {
      question: 'Best way to level up as a junior dev?',
      options: ['Build side projects', 'LeetCode grind', 'Read engineering blogs', 'Contribute to open source'],
      votes: [198, 74, 112, 89],
      selectedUsers: {}
    },
    likes: 412,
    comments: 63,
    replies: [
      {
        id: 'r_8_1',
        authorId: 'u3',
        time: '4 days ago',
        text: "Can confirm — \"A Philosophy of Software Design\" changed how I write code more than any LeetCode problem ever did.",
        mentions: [],
        likes: 34,
        isLikedByMe: false,
        replies: []
      }
    ]
  }
];
