# Audits

This folder contains audit-related documentation.

**Note:** The codebase audit plans from 2025-12-02 were implemented in v4.5.0 and have been archived to `docs/_archive/audits-2025-12-02/`.

---

## Discord Server Audit

For Discord server permission and security audits, see:
- [internal-info/CONFLICTS.md](../internal-info/CONFLICTS.md) - Permission conflicts and security issues
- [internal-info/ROLES.md](../internal-info/ROLES.md) - Full role permission matrix
- [internal-info/CHANNELS.md](../internal-info/CHANNELS.md) - Channel permission overwrites

> **Re-generate:** `npx dotenvx run -- tsx scripts/audit-server-full.ts`
