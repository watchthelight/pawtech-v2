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
export const MODAL_PAGE_RE = /^v1:modal:([^:]+):p(\d+)$/;
// Support both legacy and new review:* IDs (accept is legacy alias for approve)
export const BTN_DECIDE_RE = /^(?:v1:decide|review):(approve|accept|reject|kick|claim|unclaim):code([0-9A-F]{6})$/;
export const BTN_MODMAIL_RE = /^(?:v1:decide|review):modmail:code([0-9A-F]{6})$/;
export const BTN_PERM_REJECT_RE = /^(?:v1:decide|review):(permreject|perm_reject):code([0-9A-F]{6})$/;
export const BTN_COPY_UID_RE = /^(?:v1:decide|review):(?:copyuid|copy_uid):code([0-9A-F]{6}):user(\d+)$/;
export const BTN_PING_UNVERIFIED_RE = /^(?:v1:ping|review:ping_unverified):(?:code)?([0-9A-F]{6})?:?user(\d+)$/;
export const BTN_DBRECOVER_RE = /^dbrecover:(validate|restore-dry|restore-confirm):([a-zA-Z0-9\-]+):([a-f0-9]{8})$/;
export const MODAL_REJECT_RE = /^v1:modal:reject:code([0-9A-F]{6})$/;
export const MODAL_PERM_REJECT_RE = /^v1:modal:permreject:code([0-9A-F]{6})$/;
export const MODAL_18_RE = /^v1:avatar:confirm18:code([0-9A-F]{6})$/;

export type ModalRoute =
  | { type: "gate_submit_page"; sessionId: string; pageIndex: number }
  | { type: "review_reject"; code: string }
  | { type: "review_perm_reject"; code: string }
  | { type: "avatar_confirm18"; code: string };

export function identifyModalRoute(id: string): ModalRoute | null {
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

  const confirm18 = id.match(MODAL_18_RE);
  if (confirm18) {
    return { type: "avatar_confirm18", code: confirm18[1] };
  }

  return null;
}
