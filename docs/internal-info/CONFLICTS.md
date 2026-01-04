# Permission Conflicts & Security Concerns — 🎆 Pawtropolis™ | Furry • LGBTQ+

**Generated:** 2026-01-04T14:31:06.900Z
**Guild ID:** 896070888594759740
**Total Issues Found:** 7

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 2 |
| 🟠 High | 1 |
| 🟡 Medium | 4 |
| 🟢 Low | 0 |

---

## 🔴 Critical Issues

### [CRIT-003] Administrator Permission on User Role

- **Affected:** Role: Community Manager (1190093021170114680)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Risk:** 1 member(s) have unrestricted server access.
- **Recommendation:** Consider using specific permissions instead of Administrator. Audit who has this role.

---

### [CRIT-004] Administrator Permission on User Role

- **Affected:** Role: Senior Administrator (1420440472169746623)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Risk:** 1 member(s) have unrestricted server access.
- **Recommendation:** Consider using specific permissions instead of Administrator. Audit who has this role.

---

## 🟠 High Priority Issues

### [HIGH-007] Privilege Escalation Risk

- **Affected:** Role: Administrator (896070888779317248)
- **Issue:** Role has both BanMembers and ManageRoles permissions.
- **Risk:** Users can potentially escalate privileges by assigning themselves roles up to this role's position.
- **Recommendation:** Ensure role is high in hierarchy and only trusted staff have it. Consider splitting permissions.

---

## 🟡 Medium Priority Issues

### [CRIT-001] Administrator Permission on Bot Role

- **Affected:** Role: Wick (1394581676579094600)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Risk:** Bot roles with Admin can be compromised if the bot is vulnerable.
- **Recommendation:** Review if bot actually needs Administrator. Most bots work with specific permissions.

---

### [CRIT-002] Administrator Permission on Bot Role

- **Affected:** Role: Server Owner (896070888779317254)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Risk:** Bot roles with Admin can be compromised if the bot is vulnerable.
- **Recommendation:** Review if bot actually needs Administrator. Most bots work with specific permissions.

---

### [MED-005] Webhook Impersonation Risk

- **Affected:** Role: Community Manager (1190093021170114680)
- **Issue:** Role can create/edit webhooks.
- **Risk:** Webhooks can impersonate any user or bot. 1 member(s) can create fake messages.
- **Recommendation:** Limit ManageWebhooks to trusted staff only. Audit webhook usage.

---

### [MED-006] Webhook Impersonation Risk

- **Affected:** Role: Senior Administrator (1420440472169746623)
- **Issue:** Role can create/edit webhooks.
- **Risk:** Webhooks can impersonate any user or bot. 1 member(s) can create fake messages.
- **Recommendation:** Limit ManageWebhooks to trusted staff only. Audit webhook usage.

---

