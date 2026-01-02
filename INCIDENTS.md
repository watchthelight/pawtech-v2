# Incident Log

Production incidents and their resolutions for Pawtropolis Tech.

---

## INC-001: AWS Cost Anomaly (+1400%) - 2026-01-02

### Summary
Monthly AWS EC2 costs spiked from ~$6/month to ~$71/month (+1400%) due to an oversized instance type.

### Timeline
- **2025-10-21**: pawtech instance launched as c7i-flex.large ($0.085/hr)
- **2025-12-01 to 2025-12-31**: Instance ran full month, incurring $63.08
- **2026-01-02 00:37 UTC**: Instance manually stopped
- **2026-01-02 00:45 UTC**: Investigation began
- **2026-01-02 00:55 UTC**: Resolution complete

### Root Cause
The production server was running on a `c7i-flex.large` instance ($63/month) when a much smaller instance would suffice for a Discord bot workload.

Additionally, two idle instances were discovered:
- `entropy.root` (t4g.small) - running but empty, ~$12.50/month wasted
- `watchthelight` (t4g.micro) - running, ~$6.25/month

### Impact
- **Financial**: ~$57/month excess spend
- **Operational**: None - bot was functioning normally

### Resolution
1. Terminated idle instances (`entropy.root`, `watchthelight`)
2. Changed `pawtech` instance type from `c7i-flex.large` to `t3a.small`
3. Restarted instance and verified bot operation
4. Removed bot from 6 unauthorized guilds (keeping only Pawtropolis)
5. Added auto-leave logic to prevent joining unauthorized servers

### Cost Impact
| Before | After | Monthly Savings |
|--------|-------|-----------------|
| ~$71/mo | ~$14/mo | ~$57/mo (80%) |

### Preventive Measures
- Added `guildCreate` handler to auto-leave unauthorized servers
- Bot now only operates in guild ID `896070888594759740` (Pawtropolis)

### Lessons Learned
- Regularly audit AWS instances for right-sizing opportunities
- Monitor for idle/orphaned resources
- Implement guild allowlisting for single-server bots
