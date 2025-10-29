/**
 * Sample data for preview commands and testing
 */

import type { ReviewAnswer } from "../ui/reviewCard.js";

/**
 * Standard sample answers (typical responses)
 */
export const SAMPLE_ANSWERS_STANDARD: ReviewAnswer[] = [
  {
    q_index: 1,
    question: "What is your age?",
    answer: "24",
  },
  {
    q_index: 2,
    question: "How did you find this server?",
    answer: "A friend recommended it after seeing a post on Twitter.",
  },
  {
    q_index: 3,
    question: "What tend to be your goals here?",
    answer: "I want to connect with other furry artists and share my artwork.",
  },
  {
    q_index: 4,
    question: "Have you read and agreed to follow our server rules?",
    answer: "Yes, I have read and agree to follow all server rules.",
  },
  {
    q_index: 5,
    question: "Anything else we should know?",
    answer: "Looking forward to being part of the community!",
  },
];

/**
 * Long sample answers (for testing multiline wrapping)
 */
export const SAMPLE_ANSWERS_LONG: ReviewAnswer[] = [
  {
    q_index: 1,
    question: "What is your age?",
    answer:
      "I am 24 years old, turning 25 in a few months. I've been part of the furry community for about 6 years now.",
  },
  {
    q_index: 2,
    question: "How did you find this server?",
    answer:
      "A friend of mine recommended this server after I mentioned I was looking for a welcoming furry community. They showed me a post on Twitter about the server's art channels and events, which really caught my interest. I've also heard great things about the community culture here from other friends who are members.",
  },
  {
    q_index: 3,
    question: "What tend to be your goals here?",
    answer:
      "My main goals are to connect with other furry artists, share my digital artwork, participate in community events, and learn from more experienced artists. I'm particularly interested in improving my character design skills and exploring different art styles within the furry fandom. I also hope to make lasting friendships with people who share similar creative interests.",
  },
  {
    q_index: 4,
    question: "Have you read and agreed to follow our server rules?",
    answer:
      "Yes, I have carefully read through all of the server rules and community guidelines. I understand the importance of maintaining a safe, respectful, and inclusive environment for all members. I agree to follow all rules regarding content posting, communication standards, and community conduct.",
  },
  {
    q_index: 5,
    question: "Anything else we should know?",
    answer:
      "I'm a digital artist specializing in anthro character art and I've been doing commissions for about 2 years. I'm active in several other furry communities and conventions. I'm respectful of content boundaries and always happy to help newcomers feel welcome. Looking forward to being an active and positive member of the community!",
  },
];

/**
 * Rejected sample answers (incomplete/problematic responses)
 */
export const SAMPLE_ANSWERS_REJECTED: ReviewAnswer[] = [
  {
    q_index: 1,
    question: "What is your age?",
    answer: "18",
  },
  {
    q_index: 2,
    question: "How did you find this server?",
    answer: "google",
  },
  {
    q_index: 3,
    question: "What tend to be your goals here?",
    answer: "idk just looking around",
  },
  {
    q_index: 4,
    question: "Have you read and agreed to follow our server rules?",
    answer: "yeah",
  },
  {
    q_index: 5,
    question: "Anything else we should know?",
    answer: "",
  },
];

/**
 * Standard rejection reason
 */
export const SAMPLE_REJECTION_REASON = `Application contained incomplete or inconsistent responses.`;

/**
 * Long rejection reason (for testing)
 */
export const SAMPLE_REJECTION_REASON_LONG = `After careful review of your application, we have determined that you do not meet our community standards at this time.

Specific concerns:
1. Your answers indicate you may not be familiar with our community guidelines and expectations
2. The tone and content of your responses suggest misalignment with our server culture
3. Your account age and activity history raise concerns about your intentions

We encourage you to:
- Review our server rules and guidelines more thoroughly
- Spend more time in similar communities to understand furry community norms
- Consider reapplying in the future when you have more experience with online furry communities

This decision is final for this application. You may reapply after 30 days if you believe you can better demonstrate alignment with our community values.

Thank you for your interest in Pawtropolis.`;

/**
 * Sample history actions
 */
export const SAMPLE_HISTORY = [
  {
    action: "claim",
    moderator_id: "SAMPLE_MOD_ID",
    reason: null,
    created_at: Math.floor(Date.now() / 1000) - 1, // 1s ago
  },
  {
    action: "approved",
    moderator_id: "SAMPLE_MOD_ID_2",
    reason: null,
    created_at: Math.floor(Date.now() / 1000) - 7200, // 2h ago
  },
  {
    action: "submitted",
    moderator_id: "SAMPLE_USER_ID",
    reason: null,
    created_at: Math.floor(Date.now() / 1000) - 86400, // 1d ago
  },
];
