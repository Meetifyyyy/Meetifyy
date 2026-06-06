export const initialMessages = [
  {
    id: 1, name: 'Alice Chen', avatar: 'A', color: '#EC4899', online: true,
    lastMsg: 'Hey! Are you coming to the meetup tomorrow?', time: '2m ago', unread: 2,
    messages: [
      { from: 'them', text: 'Hey! How are you?', time: '10:32 AM' },
      { from: 'me', text: "I'm good! Excited about the hackathon this weekend.", time: '10:33 AM' },
      { from: 'them', text: 'Same here! Our team is almost ready. Have you seen the theme?', time: '10:34 AM' },
      { from: 'me', text: 'Yeah, it looks amazing! I have some ideas already.', time: '10:35 AM' },
      { from: 'them', text: "Let's discuss over coffee tomorrow?", time: '10:36 AM' },
      { from: 'me', text: 'Sure! 11 AM at the usual place?', time: '10:37 AM' },
      { from: 'them', text: 'Perfect! See you there 😊', time: '10:38 AM' },
      { from: 'them', text: 'Hey! Are you coming to the meetup tomorrow?', time: '2m ago' },
    ],
  },
  {
    id: 2, name: 'Marcus Rivera', avatar: 'M', color: '#3B82F6', online: true,
    lastMsg: "Sure, let me know when you're free", time: '1h ago', unread: 0,
    messages: [
      { from: 'them', text: 'Hi! I saw your post about the startup project.', time: '2:15 PM' },
      { from: 'me', text: "Oh hey! Yes, I'm looking for a UI/UX designer.", time: '2:16 PM' },
      { from: 'them', text: 'I might know someone. Let me check with my network.', time: '2:17 PM' },
      { from: 'me', text: 'That would be great, thanks!', time: '2:18 PM' },
      { from: 'them', text: "Sure, let me know when you're free", time: '1h ago' },
    ],
  },
  {
    id: 3, name: 'Priya Sharma', avatar: 'P', color: '#22C55E', online: false,
    lastMsg: 'Thanks for the awesome feedback! 🙌', time: '3h ago', unread: 0,
    messages: [
      { from: 'me', text: 'Hey Priya, great presentation today!', time: '11:00 AM' },
      { from: 'them', text: 'Thank you so much! I was really nervous.', time: '11:02 AM' },
      { from: 'me', text: 'You did amazing! The AI/ML insights were super valuable.', time: '11:05 AM' },
      { from: 'them', text: 'Thanks for the awesome feedback! 🙌', time: '3h ago' },
    ],
  },
  {
    id: 4, name: 'Design Buddies', avatar: 'D', color: '#A855F7', online: true,
    lastMsg: 'New design challenge posted!', time: '5h ago', unread: 5,
    messages: [
      { from: 'them', text: 'Welcome to Design Buddies! 🎨', time: '9:00 AM' },
      { from: 'them', text: 'Check out our weekly design challenges.', time: '9:01 AM' },
      { from: 'them', text: 'New design challenge posted!', time: '5h ago' },
    ],
  },
  {
    id: 5, name: 'Emma L.', avatar: 'E', color: '#F97316', online: true,
    lastMsg: 'Love your new portfolio design! ✨', time: '1d ago', unread: 1,
    messages: [
      { from: 'them', text: 'Hey! I saw your recent project. Great work!', time: 'Yesterday' },
      { from: 'me', text: 'Thanks Emma! Means a lot coming from you.', time: 'Yesterday' },
      { from: 'them', text: 'Love your new portfolio design! ✨', time: '1d ago' },
    ],
  },
  {
    id: 6, name: 'AI/ML Enthusiasts', avatar: 'A', color: '#06B6D4', online: false,
    lastMsg: 'New paper discussion this Friday', time: '2d ago', unread: 0,
    messages: [
      { from: 'them', text: 'Join our paper discussion this Friday!', time: '2d ago' },
      { from: 'them', text: 'New paper discussion this Friday', time: '2d ago' },
    ],
  },
  {
    id: 7, name: 'Johnson Wood', avatar: 'J', color: '#EAB308', online: true,
    lastMsg: 'Are we still on for the co-op session tonight?', time: '10m ago', unread: 1,
    messages: [
      { from: 'them', text: 'Hey, I finally got the new expansion pack.', time: 'Yesterday' },
      { from: 'me', text: 'Nice! I am free tomorrow evening to play.', time: 'Yesterday' },
      { from: 'them', text: 'Sounds like a plan. Let us aim for 8 PM.', time: 'Yesterday' },
      { from: 'me', text: 'Perfect. See you then!', time: 'Yesterday' },
      { from: 'them', text: 'Are we still on for the co-op session tonight?', time: '10m ago' },
    ]
  },
  {
    id: 8, name: 'Sarah Jones', avatar: 'S', color: '#14B8A6', online: false,
    lastMsg: 'Check out this new Rust library I found.', time: '4h ago', unread: 0,
    messages: [
      { from: 'me', text: 'Hey Sarah, do you have any good resources for learning Rust?', time: '10:00 AM' },
      { from: 'them', text: 'Absolutely! The official Rust book is the best place to start.', time: '10:15 AM' },
      { from: 'me', text: 'I am reading it now, but the borrow checker is tricky.', time: '10:20 AM' },
      { from: 'them', text: 'Yeah, it takes some getting used to. Check out this new Rust library I found.', time: '4h ago' }
    ]
  }
];
