# Permission Conflicts & Security Concerns — 🎆 Pawtropolis™ | Furry • LGBTQ+

**Generated:** 2026-01-04T20:33:03.800Z
**Guild ID:** 896070888594759740
**Active Issues:** 3
**Acknowledged:** 6

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 0 |
| 🟡 Medium | 2 |
| 🟢 Low | 1 |
| ✅ Acknowledged | 6 |

---

## 🟡 Medium Priority Issues

### [MED-001] Administrator Permission on Bot Role

- **Affected:** Role: Wick (1394581676579094600)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Risk:** Bot roles with Admin can be compromised if the bot is vulnerable.
- **Recommendation:** Review if bot actually needs Administrator. Most bots work with specific permissions.

---

### [MED-009] Potentially Sensitive Channel Accessible

- **Affected:** Channel: #「🐴」3d-modeling (1450227604152914131)
- **Issue:** Channel name suggests it's sensitive, but @everyone ViewChannel is not explicitly denied.
- **Risk:** May be unintentionally accessible to regular members.
- **Recommendation:** Verify channel permissions are intentional. Add explicit ViewChannel deny for @everyone if private.

---

## 🟢 Low Priority / Notes

### [LOW-008] Wide @everyone/@here Access

- **Affected:** Role: Moderation Team (987662057069482024)
- **Issue:** 17 members can mention @everyone/@here.
- **Risk:** Potential for spam or disruption.
- **Recommendation:** Consider restricting to staff roles or specific channels only.

---

## ✅ Acknowledged Issues

These issues have been reviewed by staff and marked as intentional.

### [CRIT-003] Administrator Permission on User Role *(Acknowledged)*

- **Affected:** Role: Community Manager (1190093021170114680)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** Only given to trusted users

*To unacknowledge, use `/audit unacknowledge CRIT-003`*

---

### [CRIT-004] Administrator Permission on User Role *(Acknowledged)*

- **Affected:** Role: Senior Administrator (1420440472169746623)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** Giving the Administrator role to Senior Admin is intentional, and this is only given to vetted, trusted users.

*To unacknowledge, use `/audit unacknowledge CRIT-004`*

---

### [HIGH-007] Privilege Escalation Risk *(Acknowledged)*

- **Affected:** Role: Administrator (896070888779317248)
- **Issue:** Role has both BanMembers and ManageRoles permissions.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** This is intentional, part of moderation structure, only given to trusted individuals.

*To unacknowledge, use `/audit unacknowledge HIGH-007`*

---

### [MED-002] Administrator Permission on Bot Role *(Acknowledged)*

- **Affected:** Role: Server Owner (896070888779317254)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** This is intentional, it's part of an old linked role.

*To unacknowledge, use `/audit unacknowledge MED-002`*

---

### [MED-005] Webhook Impersonation Risk *(Acknowledged)*

- **Affected:** Role: Community Manager (1190093021170114680)
- **Issue:** Role can create/edit webhooks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** This is intentional. Resolve conflict

*To unacknowledge, use `/audit unacknowledge MED-005`*

---

### [MED-006] Webhook Impersonation Risk *(Acknowledged)*

- **Affected:** Role: Senior Administrator (1420440472169746623)
- **Issue:** Role can create/edit webhooks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** This is intentional. Resolve conflict

*To unacknowledge, use `/audit unacknowledge MED-006`*

---

