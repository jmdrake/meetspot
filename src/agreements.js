// The member and host agreements, one card per rule.
//
// Each card: a plain-English headline, the rule in a sentence or two, why it exists, the full
// terms, and optionally a one-question check. Members type their initials on every card.
//
// To change a card, edit its text AND raise its `version`. Everyone who initialed the old
// version is asked to initial that card again; untouched cards stay accepted.
//
// DRAFT for the founder's legal review. Wording is a starting point, not final legal text.

export const AGREEMENTS = {
  member: {
    title: 'Member agreement',
    intro: 'Ten short cards on what MeetSpot expects from you and what you can expect from us. Read each one and add your initials. It takes about three minutes.',
    cards: [
      {
        id: 'real-people', version: 1,
        title: 'Be who you say you are',
        rule: 'Use your real first name, a recent photo of yourself, and your real birth date. You must be 18 or older.',
        why: 'People decide whether to meet you based on your profile. Everyone deserves to know who is really showing up.',
        terms: 'You represent that you are at least 18 years old and that the information in your profile is accurate and belongs to you. You will not impersonate anyone, create more than one account, or let anyone else use your account. MeetSpot may suspend or close accounts that contain false information.',
      },
      {
        id: 'respect-consent', version: 1,
        title: 'Respect and consent, always',
        rule: 'No harassment, threats, hate or unwanted advances. Anyone can say no, leave, or change their mind at any time, and that ends it.',
        why: 'Activities only work if everyone feels safe saying no.',
        terms: 'You will treat other members with respect online and in person. You will not harass, threaten, intimidate, demean, stalk, or discriminate against anyone, or make sexual advances that are unwelcome. Consent must be clear, freely given, and can be withdrawn at any time; a person who is intoxicated, asleep, or pressured cannot consent. Violations may result in immediate removal and may be reported to law enforcement.',
        check: {
          question: 'Someone at a group dinner says they want to head home early. What should happen?',
          options: ['They go. No pressure, no questions.', 'Talk them into staying a bit longer.', 'It depends on who drove.'],
          answer: 0,
          explain: 'Anyone can leave at any time. Pressuring someone to stay is not OK on MeetSpot.',
        },
      },
      {
        id: 'nothing-illegal', version: 1,
        title: 'No drugs, no gambling, nothing illegal',
        rule: 'No drugs of any kind, including cannabis where it is legal. No betting or games played for money. No prostitution or paid sex. Nothing unlawful.',
        why: 'Drugs undermine judgment and consent. Gambling leads to fights and robbery. These risks hurt hosts and guests alike, so MeetSpot keeps them out completely.',
        terms: 'You will not use MeetSpot to buy, sell, offer, use, or encourage the use of any drug or controlled substance, including cannabis regardless of local law; to organize or take part in gambling of any kind, including card games, betting, or pools played for money or anything of value; to offer, request, or arrange sexual services for money or anything of value; or for any other unlawful purpose. Activities that involve any of these will be removed, and accounts involved may be closed and reported to law enforcement.',
        check: {
          question: 'A member suggests turning game night into a poker game with a $20 buy-in. Is that allowed?',
          options: ['Yes, if everyone agrees', 'No, games for money are not allowed', 'Yes, if it is under $50'],
          answer: 1,
          explain: 'No games for money of any size. Play for fun, not for stakes.',
        },
      },
      {
        id: 'alcohol', version: 1,
        title: 'Alcohol only at licensed venues',
        rule: 'Drinks are fine at a bar, restaurant or venue that is licensed to serve them. No alcohol at any other activity, including BYOB.',
        why: 'Licensed venues have trained staff, a legal duty to stop serving, and insurance. Living rooms and parks do not.',
        terms: 'Alcohol may be consumed at a MeetSpot activity only where it is served by a business licensed to sell it, and only by members of legal drinking age. You will not bring, serve, or provide alcohol at any activity held anywhere else, whether the activity is free or paid. Activities that include alcohol are limited to members 21 and older.',
        check: {
          question: 'Your group is meeting at a park for a picnic. Can someone bring a bottle of wine?',
          options: ['Yes, it is a picnic', 'Only if no one is under 21', 'No, alcohol only where a licensed venue serves it'],
          answer: 2,
          explain: 'Want drinks? Pick a licensed bar or restaurant, and the venue serves them.',
        },
      },
      {
        id: 'no-sex-events', version: 1,
        title: 'Nothing organized around sex',
        rule: 'Romance is welcome: dates, mixers, dinners. Activities whose purpose is sexual are not.',
        why: 'Sexual events are where consent questions get hardest to answer, and the platform should never be the one that organized them.',
        terms: 'You will not create, promote, or use MeetSpot to arrange any activity whose purpose or expected content is sexual, including parties or gatherings presented as something else. MeetSpot may remove any activity it reasonably believes falls into this category.',
      },
      {
        id: 'show-up', version: 1,
        title: 'Show up, or cancel early',
        rule: 'If you say you are going, go. Canceling within 48 hours, or not showing up, is recorded on your account.',
        why: 'Hosts plan around you, and someone on the waitlist may have wanted your spot.',
        terms: 'MeetSpot records check-ins, late cancellations (within 48 hours of the start) and no-shows. Repeated late cancellations or no-shows may limit your ability to request or host activities. Cancellations caused by a host change, an event cancellation, or a safety concern are not counted against you.',
      },
      {
        id: 'message-scanning', version: 1,
        title: 'We scan messages for safety',
        rule: 'AI reads chats, activity descriptions and profiles to catch violations of these rules, including slang and context, not just keywords. A person at MeetSpot reviews every flag before anything happens.',
        why: 'Problems often show up in messages first. Catching them early protects everyone. Your messages are never sold or used for ads.',
        terms: 'You consent to MeetSpot and its service providers using automated systems, including artificial intelligence, to review messages, activity details, profiles, and photos sent or posted through MeetSpot, for the purpose of enforcing these terms and protecting members. Content flagged by automated review is reviewed by a person before any action is taken against an account, except where immediate action is needed to prevent harm. MeetSpot does not sell your messages or use them for advertising. MeetSpot may preserve and disclose content where required by law or to protect the safety of any person.',
        check: {
          question: 'An AI flags a message in your group chat. Who decides whether it broke the rules?',
          options: ['The AI, automatically', 'A person at MeetSpot', 'The host of the activity'],
          answer: 1,
          explain: 'AI only flags. A person reviews every flag before any action is taken.',
        },
      },
      {
        id: 'privacy', version: 1,
        title: 'What others see, and what we keep',
        rule: 'Before a host invites you, others see only your gender, age range, intents, photo and bio. Your first name appears after an invite. Your email and birth date are never shown.',
        why: 'You should control how much strangers know about you until you decide to meet.',
        terms: 'MeetSpot collects the information you provide (email, profile, photos), the activities you host, request and attend, check-ins, messages, and basic device and usage information. We use it to run MeetSpot, match activities to their audiences, keep members safe, and improve the service. We share it with service providers who help us operate (hosting, email, storage) under confidentiality obligations, and where required by law. We do not sell personal information. You may request a copy or deletion of your data at any time; some records, such as safety reports and referral records, may be retained as required by law or to protect members.',
      },
      {
        id: 'report', version: 1,
        title: 'Report anything unsafe',
        rule: 'If something feels wrong, leave, and report it in the app. In an emergency, call 911 first.',
        why: 'Reports are how we find problems we cannot see. Every report is reviewed, and reporters are never identified to the person reported.',
        terms: 'You may report any member, activity, message, or photo. MeetSpot will review reports and may warn, suspend, or remove accounts, or share information with law enforcement. Knowingly false reports are a violation of these terms. MeetSpot does not conduct criminal background checks and does not guarantee the conduct of any member; you are responsible for your own safety decisions.',
      },
      {
        id: 'test-program', version: 1,
        title: 'You are part of a private test',
        rule: 'MeetSpot is in testing. Keep what you see confidential under the agreement you signed, expect bugs, and tell us what you think. Referrals are recorded and will be honored under the program’s terms when it launches.',
        why: 'Your feedback shapes what MeetSpot becomes.',
        terms: 'MeetSpot is provided as a pre-release test version, as is, and may change, contain errors, or be unavailable. Your participation is also governed by the confidentiality agreement you signed. MeetSpot records who invited each member; referral rewards, if any, will be governed by terms published when the program launches. MeetSpot may update these terms; changed sections will be shown to you to initial again before you continue using the service.',
      },
    ],
  },

  host: {
    title: 'Host agreement',
    intro: 'Hosting is what makes MeetSpot work. Six cards on what hosting means. Initial each one and you are ready to post.',
    cards: [
      {
        id: 'responsible', version: 1,
        title: 'Your activity, your responsibility',
        rule: 'Be there for the whole activity, and make sure what happens matches what you posted: same place, same time, same cost.',
        why: 'Guests decide to come based on your description. Surprises erode trust.',
        terms: 'As a host, you will attend the activities you host, describe them accurately, keep the time, place, and cost as posted unless you edit them in MeetSpot, and use the cancellation tools if plans change. You are responsible for the activities you organize, and you will comply with venue rules and applicable law.',
      },
      {
        id: 'public-places', version: 1,
        title: 'Public places only, for now',
        rule: 'Host at restaurants, bars, parks, theaters, cafés and other public places. No activities at homes during testing.',
        why: 'Homes put strangers in a private space with no staff and no witnesses. Home activities will return later, for friends only.',
        terms: 'During the test period you will host activities only at locations open to the public. You will not host, or move an activity to, a private residence.',
        check: {
          question: 'Can you host board game night at your apartment?',
          options: ['Yes, if it is free', 'Not during testing. Pick a café or game store', 'Yes, if everyone is a friend'],
          answer: 1,
          explain: 'Public places only for now. Board game cafés and bars with game nights are great options.',
        },
      },
      {
        id: 'host-alcohol', version: 1,
        title: 'The venue serves, not you',
        rule: 'If your activity involves drinks, hold it at a licensed venue and set the age range to 21 and up. Never bring or provide alcohol yourself.',
        why: 'A licensed venue can stop serving someone who has had too much. A host cannot be expected to.',
        terms: 'You will not bring, provide, or sell alcohol at any activity. If alcohol will be available, you will hold the activity at a venue licensed to serve it and limit the activity to members 21 and older.',
      },
      {
        id: 'stop-it', version: 1,
        title: 'If it starts going wrong, stop it',
        rule: 'If you see drugs, gambling, sexual pressure or anyone being harmed, end the activity or leave, and report it.',
        why: 'A rule only protects people if someone acts on it in the moment. As host, that is you.',
        terms: 'If you become aware of drug use, gambling, sexual misconduct, violence, or any person at risk of harm at your activity, you will end your participation in the activity, ask the people involved to stop or leave where it is safe to do so, contact emergency services if anyone is in danger, and report the incident to MeetSpot as soon as you can.',
        check: {
          question: 'At your trivia night, two guests start passing around pills. What do you do?',
          options: ['Ignore it, it is their choice', 'Ask them to stop, end the activity if needed, and report it', 'Wait until the activity is over, then report it'],
          answer: 1,
          explain: 'Act in the moment: ask them to stop, end it if needed, and report it.',
        },
      },
      {
        id: 'check-in', version: 1,
        title: 'Check your guests in',
        rule: 'Scan each guest’s code or mark them here when they arrive. Mark only people who actually came.',
        why: 'Check-in is how MeetSpot knows who really attended. It unlocks photos and friend requests, and later, payouts.',
        terms: 'You will record attendance accurately using MeetSpot’s check-in tools and will not mark as present anyone who did not attend.',
      },
      {
        id: 'host-cancel', version: 1,
        title: 'Cancel honestly',
        rule: 'If you have to cancel, do it in the app with the real reason. Canceling within 48 hours because you cannot make it is recorded.',
        why: 'Your guests may have turned down other plans for yours.',
        terms: 'You will cancel activities only through MeetSpot and will state the reason accurately. Late cancellations for personal reasons are recorded on your account; cancellations because the underlying event was canceled or for safety reasons are not.',
      },
    ],
  },
};

export const KINDS = Object.keys(AGREEMENTS);
