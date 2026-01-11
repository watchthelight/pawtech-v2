# Permission Conflicts & Security Concerns — 🎆 Pawtropolis™ | Furry • LGBTQ+

**Generated:** 2026-01-11T15:38:32.817Z
**Guild ID:** 896070888594759740
**Active Issues:** 2
**Acknowledged:** 9

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 1 |
| 🟠 High | 0 |
| 🟡 Medium | 1 |
| 🟢 Low | 0 |
| ✅ Acknowledged | 9 |

---

## 🔴 Critical Issues

### [CRIT-006] Administrator Permission on User Role

- **Affected:** Role: Community Apps (896070888749940774)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Risk:** 26 member(s) have unrestricted server access.
- **Recommendation:** Consider using specific permissions instead of Administrator. Audit who has this role.

---

## 🟡 Medium Priority Issues

### [MED-011] Potentially Sensitive Channel Accessible

- **Affected:** Channel: #「🐴」3d-modeling (1450227604152914131)
- **Issue:** Channel name suggests it's sensitive, but @everyone ViewChannel is not explicitly denied.
- **Risk:** May be unintentionally accessible to regular members.
- **Recommendation:** Verify channel permissions are intentional. Add explicit ViewChannel deny for @everyone if private.

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

### [CRIT-005] Administrator Permission on User Role *(Acknowledged)*

- **Affected:** Role: Senior Administrator (1420440472169746623)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** Giving the Administrator role to Senior Admin is intentional, and this is only given to vetted, trusted users.

*To unacknowledge, use `/audit unacknowledge CRIT-005`*

---

### [HIGH-009] Privilege Escalation Risk *(Acknowledged)*

- **Affected:** Role: Administrator (896070888779317248)
- **Issue:** Role has both BanMembers and ManageRoles permissions.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** This is intentional, part of moderation structure, only given to trusted individuals.

*To unacknowledge, use `/audit unacknowledge HIGH-009`*

---

### [MED-001] Administrator Permission on Bot Role *(Acknowledged)*

- **Affected:** Role: Wick (1394581676579094600)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-07
- **Reason:** Intentional, but should use Pawtech in the future probably. Look into it

*To unacknowledge, use `/audit unacknowledge MED-001`*

---

### [MED-002] Administrator Permission on Bot Role *(Acknowledged)*

- **Affected:** Role: Server Owner (896070888779317254)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** This is intentional, it's part of an old linked role.

*To unacknowledge, use `/audit unacknowledge MED-002`*

---

### [MED-004] Administrator Permission on Bot Role *(Acknowledged)*

- **Affected:** Role: Server Dev (1120074045883420753)
- **Issue:** This role has full Administrator permission, bypassing all permission checks.
- **Acknowledged by:** <@600968933293424640> on 2026-01-10
- **Reason:** Batch acknowledged after hash fix deployment

*To unacknowledge, use `/audit unacknowledge MED-004`*

---

### [MED-007] Webhook Impersonation Risk *(Acknowledged)*

- **Affected:** Role: Community Manager (1190093021170114680)
- **Issue:** Role can create/edit webhooks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** This is intentional. Resolve conflict

*To unacknowledge, use `/audit unacknowledge MED-007`*

---

### [MED-008] Webhook Impersonation Risk *(Acknowledged)*

- **Affected:** Role: Senior Administrator (1420440472169746623)
- **Issue:** Role can create/edit webhooks.
- **Acknowledged by:** <@697169405422862417> on 2026-01-04
- **Reason:** This is intentional. Resolve conflict

*To unacknowledge, use `/audit unacknowledge MED-008`*

---

### [LOW-010] Wide @everyone/@here Access *(Acknowledged)*

- **Affected:** Role: Moderation Team (987662057069482024)
- **Issue:** 15 members can mention @everyone/@here.
- **Acknowledged by:** <@697169405422862417> on 2026-01-09
- **Reason:** Intentional

*To unacknowledge, use `/audit unacknowledge LOW-010`*

---

