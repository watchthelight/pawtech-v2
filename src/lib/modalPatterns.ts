/**
 * Pawtropolis Tech — src/lib/modalPatterns.ts
 * WHAT: Regex patterns and router for our custom component IDs.
 * WHY: Consolidates ID formats and keeps parsing consistent across features.
 * FLOWS:
 *  - IDs use v1: prefix + route segments + optional HEX6 short code for humans.
 * DOCS:
 *  - Buttons/Modals: https://discord.js.org/#/docs/discord.js/main/class/Interaction
 *
 * ID format examples:
 *  - v1:decide:approve:code98FF66 → button; codeHEX6 maps to application via lookup
 *  - v1:modal:<sessionId>:p0 → modal; session id is an application id or UUID
 *  - v1:avatar:confirm18:codeAABBCC → modal; 18+ confirmation for viewing avatar source
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/**
 * Component ID patterns. Discord custom IDs are limited to 100 chars and must be
 * parseable by regex since there's no built-in routing. Our convention:
 *   v1:<type>:<action>:<params>
 *
 * The "v1:" prefix allows future format changes without breaking existing buttons.
 * HEX6 codes (e.g., "code98FF66") are shortCode() hashes for human readability.
 */

// Multi-page modal flow. Session ID is typically an application ID or UUID.
// Page index (p0, p1, ...) tracks wizard progress.
// GOTCHA: The session ID can contain any character except colons. If someone
// manages to get a colon in there, this regex will misbehave silently.
export const MODAL_PAGE_RE = /^v1:modal:([^:]+):p(\d+)$/;

// Review decision buttons. "accept" is a legacy alias for "approve" - kept for
// backwards compat with old button embeds that might still exist in channels.
// These buttons can live in channels for weeks, so backwards compat matters here.
export const BTN_DECIDE_RE = /^(?:v1:decide|review):(approve|accept|reject|kick|claim|unclaim):code([0-9A-F]{6})$/;

// Modmail button - opens a DM thread with the applicant
export const BTN_MODMAIL_RE = /^(?:v1:decide|review):modmail:code([0-9A-F]{6})$/;

// Permanent rejection - same as reject but adds to blocklist
export const BTN_PERM_REJECT_RE = /^(?:v1:decide|review):(permreject|perm_reject):code([0-9A-F]{6})$/;

// Copy user ID button - includes user ID in the customId since it's just a clipboard action
export const BTN_COPY_UID_RE = /^(?:v1:decide|review):(?:copyuid|copy_uid):code([0-9A-F]{6}):user(\d+)$/;

// Ping unverified user - sends a reminder. User ID required since code alone isn't enough
// to identify the Discord user (code is from application ID, not user ID).
export const BTN_PING_UNVERIFIED_RE = /^(?:v1:ping|review:ping_unverified):(?:code)?([0-9A-F]{6})?:?user(\d+)$/;

// Database recovery buttons - completely separate namespace (no v1: prefix).
// The 8-char hex suffix is a nonce to prevent accidental re-clicks.
export const BTN_DBRECOVER_RE = /^dbrecover:(validate|restore-dry|restore-confirm):([a-zA-Z0-9\-]+):([a-f0-9]{8})$/;

// Audit buttons - subcommand-based audit system
// - audit:members:confirm:nonce - bot detection audit
// - audit:nsfw:all:confirm:nonce - NSFW audit (all members)
// - audit:nsfw:flagged:confirm:nonce - NSFW audit (flagged members only)
export const BTN_AUDIT_MEMBERS_RE = /^audit:members:(confirm|cancel):([a-f0-9]{8})$/;
export const BTN_AUDIT_NSFW_RE = /^audit:nsfw:(all|flagged):(confirm|cancel):([a-f0-9]{8})$/;
// Combined pattern that matches any audit button
export const BTN_AUDIT_RE = /^audit:(members|nsfw):/;

// Modal IDs for forms that need to capture text input
export const MODAL_REJECT_RE = /^v1:modal:reject:code([0-9A-F]{6})$/;
export const MODAL_PERM_REJECT_RE = /^v1:modal:permreject:code([0-9A-F]{6})$/;
export const MODAL_ACCEPT_RE = /^v1:modal:accept:code([0-9A-F]{6})$/;
export const MODAL_KICK_RE = /^v1:modal:kick:code([0-9A-F]{6})$/;

// Age verification modal - requires explicit confirmation before showing NSFW avatar source
export const MODAL_18_RE = /^v1:avatar:confirm18:code([0-9A-F]{6})$/;

/**
 * Discriminated union for routed modal types. Allows type-safe handling
 * in the modal submission handler via switch on `type`.
 */
export type ModalRoute =
  | { type: "gate_submit_page"; sessionId: string; pageIndex: number }
  | { type: "review_reject"; code: string }
  | { type: "review_perm_reject"; code: string }
  | { type: "review_accept"; code: string }
  | { type: "review_kick"; code: string }
  | { type: "avatar_confirm18"; code: string };

/**
 * Routes a modal customId to a typed handler. Returns null if the ID doesn't
 * match any known pattern - caller should handle this as an "unhandled modal" error.
 *
 * Pattern matching order doesn't matter here since the patterns are mutually
 * exclusive, but we check the most common one (page submissions) first.
 */
export function identifyModalRoute(id: string): ModalRoute | null {
  // Check patterns in rough order of frequency. Page submissions happen constantly,
  // reject modals happen occasionally, confirm18 is rare. Not that it matters
  // much - regex matching is fast. But it's nice to fail fast on the common case.
  const page = id.match(MODAL_PAGE_RE);
  if (page) {
    return { type: "gate_submit_page", sessionId: page[1], pageIndex: Number(page[2]) };
  }

  const reject = id.match(MODAL_REJECT_RE);
  if (reject) {
    return { type: "review_reject", code: reject[1] };
  }

  const permReject = id.match(MODAL_PERM_REJECT_RE);
  if (permReject) {
    return { type: "review_perm_reject", code: permReject[1] };
  }

  const accept = id.match(MODAL_ACCEPT_RE);
  if (accept) {
    return { type: "review_accept", code: accept[1] };
  }

  const kick = id.match(MODAL_KICK_RE);
  if (kick) {
    return { type: "review_kick", code: kick[1] };
  }

  const confirm18 = id.match(MODAL_18_RE);
  if (confirm18) {
    return { type: "avatar_confirm18", code: confirm18[1] };
  }

  return null;
}
