export const initialMessages = [
  {
    id: 1, name: 'Ethan Wong', avatar: 'E', color: '#EC4899', online: true,
    lastMsg: 'Hey! Are you joining the robotics build tomorrow?', time: '2m ago', unread: 2,
    messages: [
      { from: 'them', text: 'Hey! How are you? 😊', time: '10:32 AM' },
      { from: 'me', text: "I'm good! Excited about the hackathon this weekend. 🚀", time: '10:33 AM' },
      { from: 'them', text: 'Same here! Our protocol team is ready. Have you seen the layout? 👍', time: '10:34 AM' },
      { from: 'me', text: 'Yeah, it looks amazing! I have some ideas for the UI.', time: '10:35 AM' },
      { 
        from: 'them', 
        text: 'Shared a post showing the skeletal animation framework we worked on.', 
        time: '10:36 AM',
        inviteData: {
          type: 'postShare',
          post: {
            id: 'f_main_4',
            authorId: 'u4',
            authorName: 'Sophia Li',
            authorAvatar: 'S',
            time: '2 days ago',
            text: "Milestone alert! 🎮 The skeletal animation system we designed for our web framework now hits a stable 90 FPS.",
            likes: 317,
            comments: 44
          }
        }
      },
      { 
        from: 'me', 
        text: 'That looks super smooth. Is the repo open to public reviews? 💻', 
        time: '10:38 AM',
        replyTo: {
          from: 'them',
          senderName: 'Ethan Wong',
          text: 'Shared a post showing the skeletal animation framework we worked on.'
        }
      },
      { 
        from: 'them', 
        text: 'Yes! Check out this community, they are posting review questions there: https://github.com/creatives', 
        time: '10:40 AM',
        inviteData: {
          type: 'communityShare',
          community: {
            id: 'creatives',
            name: 'Creative Studio',
            avatar: 'C',
            color: 'linear-gradient(135deg, #3B82F6, #06B6D4)',
            desc: 'Dive into interactive media, UI styling, and animations. From CSS art to complex web interactions.',
            members: 8200
          }
        }
      },
      {
        from: 'them',
        text: 'Shared a voice message detailing the protocol optimizations. 🎙️',
        time: '10:41 AM',
        mediaUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        mediaType: 'audio'
      },
      {
        from: 'them',
        text: 'Here is a screenshot of the latency graph.',
        time: '10:42 AM',
        mediaUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&h=400&fit=crop',
        mediaType: 'image'
      },
      {
        from: 'them',
        text: 'Also sharing Zoe\'s profile if you want to invite her directly to the repo.',
        time: '10:44 AM',
        inviteData: {
          type: 'profileShare',
          profile: {
            id: 'u2',
            username: 'zoemiller',
            displayName: 'Zoe Miller',
            avatar: 'Z',
            role: 'Creative Lead',
            followers: 6100,
            following: 290,
            bio: 'Product Designer. Focused on immersive design, glassmorphism, and clean interfaces.'
          }
        }
      },
      { from: 'them', text: 'Hey! Are you joining the robotics build tomorrow? 🤖', time: '2m ago' },
    ],
  },
  {
    id: 2, name: 'Zoe Miller', avatar: 'Z', color: '#3B82F6', online: true,
    lastMsg: "Sure, let me know when you're free", time: '1h ago', unread: 0,
    messages: [
      { from: 'them', text: 'Hi! I saw your post about the design challenge. 🎨', time: '2:15 PM' },
      { from: 'me', text: "Oh hey! Yes, I'm looking for a designer to team up with.", time: '2:16 PM' },
      { 
        from: 'them', 
        text: 'Awesome. I hosted an activity for design feedback. Join us! 🙌', 
        time: '2:17 PM',
        inviteData: {
          type: 'activityShare',
          activity: {
            id: 'crew_1_0',
            hostId: 'u2',
            hostName: 'Zoe Miller',
            hostUsername: 'zoemiller',
            hostAvatar: 'Z',
            category: 'Creative',
            title: 'Interaction portfolio reviews',
            description: 'Constructive reviews of interaction design, user maps, and wireframe prototypes.',
            coverImage: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?q=80&w=1000&auto=format&fit=crop',
            dateLabel: 'Tomorrow',
            time: '8:00 PM',
            location: 'Online - Google Meet',
            slotsNeeded: 4,
            slotsFilled: 2,
            participants: ['u2', 'u4']
          }
        }
      },
      { from: 'me', text: 'Perfect, I just registered for that slot.', time: '2:18 PM' },
      { from: 'them', text: "Sure, let me know when you're free 👍", time: '1h ago' },
    ],
  },
  {
    id: 3, name: 'Kabir Verma', avatar: 'K', color: '#22C55E', online: false,
    lastMsg: 'Thanks for the awesome feedback! 🙌', time: '3h ago', unread: 0,
    messages: [
      { from: 'me', text: 'Hey Kabir, great workshop presentation today!', time: '11:00 AM' },
      { from: 'them', text: 'Thank you so much! I was really nervous about the CUDA demo. 😅', time: '11:02 AM' },
      { from: 'me', text: 'You did amazing! The quantization insights were super valuable. 🔥', time: '11:05 AM' },
      { from: 'them', text: 'Thanks for the awesome feedback! 🙌', time: '3h ago' },
    ],
  },
  {
    id: 'creatives', name: 'Creative Studio', avatar: 'C', color: '#A855F7', online: true,
    lastMsg: 'Added glassmorphic CSS rules!', time: '5h ago', unread: 5,
    isGroup: true,
    ownerId: 'u2',
    admins: ['u4'],
    members: ['u1', 'u2', 'u3', 'u4', 'u9'],
    messages: [
      { from: 'them', text: 'Welcome to Creative Studio! 🎨 Let\'s design something cool today. 👍', time: '9:00 AM', senderName: 'Zoe Miller', senderAvatar: 'Z' },
      { 
        from: 'them', 
        text: 'Hey Zoe! I just completed this WebGL fluid simulation shader draft.', 
        time: '9:05 AM', 
        senderName: 'Sophia Li', 
        senderAvatar: 'S',
        mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        mediaType: 'video'
      },
      { 
        from: 'them', 
        text: 'Awesome! @sophiali is it compiled to WASM? 🔥', 
        time: '9:10 AM', 
        senderName: 'Kabir Verma', 
        senderAvatar: 'K',
        mentions: [{ userId: 'u4', username: 'sophiali', start: 9, end: 18 }]
      },
      { 
        from: 'them', 
        text: 'Yes Kabir! Check out the details at https://github.com/', 
        time: '9:15 AM', 
        senderName: 'Sophia Li', 
        senderAvatar: 'S',
        replyTo: {
          from: 'them',
          senderName: 'Kabir Verma',
          text: 'Awesome! @sophiali is it compiled to WASM? 🔥'
        }
      },
      { from: 'them', text: 'Very smooth frame rates! Deployed is working. 🚀', time: '9:20 AM', senderName: 'Ethan Wong', senderAvatar: 'E' },
      { 
        from: 'them', 
        text: 'Agreed. Added glassmorphic CSS rules, looks way cleaner.', 
        time: '5h ago', 
        senderName: 'Zoe Miller', 
        senderAvatar: 'Z',
        mediaUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&h=400&fit=crop',
        mediaType: 'image'
      },
    ],
  },
  {
    id: 5, name: 'Sophia Li', avatar: 'S', color: '#F97316', online: true,
    lastMsg: 'Love the new transition mechanics! ✨', time: '1d ago', unread: 1,
    messages: [
      { from: 'them', text: 'Hey! I saw your recent website page. Great work! 😊', time: 'Yesterday' },
      { from: 'me', text: 'Thanks Sophia! Means a lot coming from you.', time: 'Yesterday' },
      { from: 'them', text: 'Love the new transition mechanics! ✨', time: '1d ago' },
    ],
  },
  {
    id: 'fintech', name: 'Fintech Labs', avatar: 'F', color: '#06B6D4', online: false,
    lastMsg: 'Yes! Deployed contract check suite is here.', time: '2d ago', unread: 0,
    isGroup: true,
    ownerId: 'u9',
    admins: ['u1', 'u3'],
    members: ['u9', 'u1', 'u2', 'u3'],
    pendingRequests: ['u4', 'u7'],
    messages: [
      { from: 'them', text: 'Join our contract safety discussion this Friday! 💡', time: '2d ago', senderName: 'Ethan Wong', senderAvatar: 'E' },
      { from: 'them', text: 'New contract checks discussion this Friday. Draft paper is online: https://martinfowler.com/', time: '2d ago', senderName: 'Kabir Verma', senderAvatar: 'K' },
      { from: 'me', text: 'Will there be a live coding demo? 🤔', time: '2d ago', senderName: 'GLA Student', senderAvatar: 'S' },
      { 
        from: 'them', 
        text: 'Yes! Deployed contract check suite is here.', 
        time: '2d ago', 
        senderName: 'Ethan Wong', 
        senderAvatar: 'E',
        mediaUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=600&h=400&fit=crop',
        mediaType: 'image'
      },
    ],
  },
  {
    id: 7, name: 'Lucas Gray', avatar: 'L', color: '#EAB308', online: true,
    lastMsg: 'Are we still on for the shader testing session tonight?', time: '10m ago', unread: 1,
    messages: [
      { from: 'them', text: 'Hey, I finally got the shader compilation working.', time: 'Yesterday' },
      { from: 'me', text: 'Nice! I am free tomorrow evening to check it.', time: 'Yesterday' },
      { from: 'them', text: 'Sounds like a plan. Let us aim for 8 PM. ⏱️', time: 'Yesterday' },
      { from: 'me', text: 'Perfect. See you then!', time: 'Yesterday' },
      { 
        from: 'them', 
        text: 'Join the robotics alliance chat using this invite.', 
        time: 'Yesterday',
        inviteData: {
          groupId: 'robotics',
          groupName: 'Robotics Alliance Chat',
          groupAvatar: 'R',
          inviterId: 'u7'
        }
      },
      { from: 'them', text: 'Are we still on for the shader testing session tonight?', time: '10m ago' },
    ]
  },
  {
    id: 8, name: 'Hannah Kim', avatar: 'H', color: '#14B8A6', online: false,
    lastMsg: 'Check out this distributed database engine.', time: '4h ago', unread: 0,
    messages: [
      { from: 'me', text: 'Hey Hannah, do you have any database papers to read?', time: '10:00 AM' },
      { from: 'them', text: 'Absolutely! The Raft consensus paper is the best place to start.', time: '10:15 AM' },
      { from: 'me', text: 'I am reading it now, but leader election constraints are tricky.', time: '10:20 AM' },
      { from: 'them', text: 'Yeah, replication checks are hard. Check out this distributed database engine.', time: '4h ago' }
    ]
  },
  {
    id: 'robotics', name: 'Robotics Alliance Group', avatar: 'R', color: '#EF4444', online: true,
    lastMsg: 'Group invite link shared.', time: '5m ago', unread: 0,
    isGroup: true,
    ownerId: 'u1',
    admins: ['u5'],
    members: ['u1', 'u2', 'u5', 'u7', 'u9'],
    messages: [
      { from: 'them', text: 'Who is working on the motor controller board this evening? 🛠️', time: 'Yesterday', senderName: 'Liam Davies', senderAvatar: 'L' },
      { 
        from: 'them', 
        text: 'I have the firmware drafts ready. Check this video of the test run! 🏎️', 
        time: 'Yesterday', 
        senderName: 'Lucas Gray', 
        senderAvatar: 'L',
        mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        mediaType: 'video'
      },
      { 
        from: 'them', 
        text: '@lucasgray that torque response is incredible! 🔥 Let\'s sync on the ROS nodes.', 
        time: 'Yesterday', 
        senderName: 'Ethan Wong', 
        senderAvatar: 'E',
        mentions: [{ userId: 'u7', username: 'lucasgray', start: 0, end: 10 }]
      },
      { 
        from: 'them', 
        text: 'Shared a layout idea for the remote controller app interface.', 
        time: 'Yesterday', 
        senderName: 'Zoe Miller', 
        senderAvatar: 'Z',
        mediaUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&h=400&fit=crop',
        mediaType: 'image',
        replyTo: {
          from: 'them',
          senderName: 'Lucas Gray',
          text: 'I have the firmware drafts ready. Check this video of the test run! 🏎️'
        }
      },
      { from: 'me', text: 'Looks amazing! Can I join the session? 🙏', time: '1h ago', senderName: 'GLA Student', senderAvatar: 'S' },
      { 
        from: 'them', 
        text: 'Of course! Group invite link shared.', 
        time: '5m ago', 
        senderName: 'Liam Davies', 
        senderAvatar: 'L',
        inviteData: {
          groupId: 'robotics',
          groupName: 'Robotics Alliance Chat',
          groupAvatar: 'R',
          inviterId: 'u5'
        }
      },
    ]
  }
];
