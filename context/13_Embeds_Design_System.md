---
title: "Embeds Design System"
slug: "13_Embeds_Design_System"
status: "active"
last_reviewed: "2025-10-30"
owner: "Pawtropolis Tech / Platform"
audience: "Engineers • Designers • Product"
source_of_truth: ["src/ui/reviewCard.ts", "Discord.js Embed documentation"]
related:
  - "03_Slash_Commands_and_UX"
  - "04_Gate_and_Review_Flow"
summary: "Complete design specification for review card embeds: code-block answer formatting, decision reason blocks, timestamp rules, color borders, and mobile constraints."
---

## Purpose & Outcomes

Standardize Discord embed design for review cards with:
- Consistent code-block formatting for Q&A answers
- Decision reason blocks with proper text wrapping
- Discord timestamp formats (`<t:...:F>`) for all dates
- Color-coded borders (approved/rejected/pending)
- Mobile-responsive constraints (line length limits)

## Scope & Boundaries

### In Scope
- Review card embed structure (title, description, fields, footer)
- Answer formatting with code blocks
- Decision reason display format
- Timestamp formatting rules
- Color palette for status indicators
- Mobile line-length guidelines (80 characters max)
- Action button layouts

### Out of Scope
- Custom emoji rendering (uses Discord defaults)
- Rich media embeds (images, videos)
- Interactive embed components beyond buttons

## Current State

**Primary Implementation**: [src/ui/reviewCard.ts](../src/ui/reviewCard.ts)

**Color Palette**:
```typescript
const COLORS = {
  primary: 0x1e293b, // slate-800 (pending)
  ok: 0x10b981,      // green-500 (approved)
  err: 0xef4444,     // red-500 (rejected/kicked)
  muted: 0x94a3b8,   // slate-400 (neutral)
};
```

**Answer Format**: Code blocks with triple backticks
```
Q: What is your age?
```md
25
```
```

**Timestamp Format**: Discord absolute + relative
- Absolute: `<t:1730217600:F>` → "Monday, October 28, 2025 10:00 AM"
- Relative: `<t:1730217600:R>` → "2 days ago"

## Key Flows

### Review Card Build Flow
```
1. Fetch application data
2. Format answers as code blocks
3. Add claim/status fields
4. Add avatar scan results
5. Add action history
6. Build action buttons
7. Set color based on status
8. Return embed + action rows
```

## Commands & Snippets

### Answer Formatting
```typescript
// File: src/ui/reviewCard.ts
function formatAnswers(answers: ReviewAnswer[]): string {
  return answers.map((a, i) => {
    const question = a.question;
    const answer = a.answer.trim() || "(no answer)";
    return `**Q${i+1}:** ${question}\n\`\`\`md\n${answer}\n\`\`\``;
  }).join("\n\n");
}
```

### Decision Reason Block
```typescript
function formatDecisionReason(reason: string | null): string {
  if (!reason) return "_No reason provided_";
  
  // Wrap at 80 chars for mobile
  const wrapped = reason.match(/.{1,80}(\s|$)/g) || [reason];
  return `\`\`\`md\n${wrapped.join('\n')}\n\`\`\``;
}
```

### Timestamp Formatting
```typescript
// Discord timestamp format
function toDiscordTimestamp(unixSeconds: number, format: string = 'F'): string {
  return `<t:${unixSeconds}:${format}>`;
}

// Usage:
const submitted = toDiscordTimestamp(app.submitted_at, 'F'); // Full date/time
const relative = toDiscordTimestamp(app.submitted_at, 'R'); // Relative
```

## Interfaces & Data

### Embed Structure
```typescript
interface ReviewCardEmbed {
  title: string;          // "Application Review — username"
  description: string;    // Formatted Q&A with code blocks
  color: number;          // Status-based color
  fields: EmbedField[];   // Claim, status, avatar scan
  footer: { text: string }; // App ID + short code
  timestamp: string;      // ISO 8601
}
```

## Ops & Recovery

### Mobile Testing
```bash
# Test answer length constraints
echo "Very long answer text..." | wc -c
# Ensure < 1024 chars per field (Discord limit)
```

## Security & Privacy

- No PII in footer text
- User IDs hashed in short codes
- Reasons redacted if sensitive flag set

## FAQ / Gotchas

**Q: Why code blocks for answers?**
A: Preserves formatting, prevents markdown injection, mobile-readable.

**Q: What's the Discord field limit?**
A: 1024 characters per field, 6000 characters total per embed.

**Q: How to handle multi-line answers?**
A: Use `\`\`\`md` code blocks to preserve newlines.

## Changelog

- 2025-10-30: Initial creation
