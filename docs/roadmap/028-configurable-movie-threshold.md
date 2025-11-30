# Roadmap: Configurable Movie Night Threshold

**Issue #28**: Hardcoded 30-Minute Threshold
**Type**: Feature Enhancement
**Priority**: Medium
**Estimated Effort**: 2-3 hours

## Issue Summary

The movie night attendance qualification system uses a hardcoded 30-minute threshold that applies to all guilds. This prevents guilds from customizing the threshold based on their movie lengths or community preferences. The code at `src/features/movieNight.ts:232-237` contains a TODO comment acknowledging this limitation and suggesting adding a configurable threshold to `guild_movie_config`.

## Current State

### What's Wrong

**Location:** `src/features/movieNight.ts:232-237`

The `finalizeMovieAttendance()` function uses a hardcoded 30-minute threshold for both attendance modes:

```typescript
// 30-minute threshold is hardcoded. If this needs to be configurable per
// guild, add a threshold column to guild_movie_config.
const qualified =
  mode === "continuous"
    ? session.longestSessionMinutes >= 30
    : session.totalMinutes >= 30;
```

**Current System Behavior:**
- All guilds must use the same 30-minute threshold
- Short films (<30 minutes) always result in no qualified attendees
- Extra-long movies (2+ hours) still only require 30 minutes of participation
- No admin control over qualification requirements

**Database Schema:**

**File:** `migrations/025_role_automation.ts:123-128`

The `guild_movie_config` table currently only has `attendance_mode`:

```sql
CREATE TABLE guild_movie_config (
  guild_id TEXT PRIMARY KEY,
  attendance_mode TEXT DEFAULT 'cumulative',
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
)
```

### Why This Is a Problem

1. **Inflexible for different content types:**
   - Short films (15-25 minutes) never qualify anyone
   - TV episodes vs feature films have different ideal thresholds
   - Anime episodes vs live-action movies require different participation times

2. **No community customization:**
   - Smaller communities may want lower thresholds (15 minutes)
   - Larger communities may want stricter requirements (45 minutes)
   - No way for admins to adjust based on guild culture

3. **Code maintenance:**
   - Changing the threshold requires code changes and deployment
   - Comment explicitly identifies this as a limitation
   - Violates the multi-guild configuration pattern used elsewhere

4. **Inconsistent with existing design:**
   - System already supports per-guild `attendance_mode` configuration
   - Threshold should follow the same pattern for consistency

## Proposed Changes

### Step 1: Add `qualification_threshold_minutes` to Database Schema

**File:** `migrations/026_add_movie_threshold.ts` (new file)

Create migration to add threshold column to `guild_movie_config`:

```typescript
export function migrate026AddMovieThreshold(db: Database): void {
  logger.info("[migration 026] Starting: add movie qualification threshold");

  enableForeignKeys(db);

  // Add column if it doesn't exist
  if (!columnExists(db, "guild_movie_config", "qualification_threshold_minutes")) {
    logger.info("[migration 026] Adding qualification_threshold_minutes column");
    db.exec(`
      ALTER TABLE guild_movie_config
      ADD COLUMN qualification_threshold_minutes INTEGER DEFAULT 30
    `);
    logger.info("[migration 026] qualification_threshold_minutes column added");
  } else {
    logger.info("[migration 026] qualification_threshold_minutes already exists, skipping");
  }

  recordMigration(db, "026", "add_movie_threshold");
  logger.info("[migration 026] ✅ Complete");
}
```

**Default:** 30 minutes (preserves current behavior)

### Step 2: Update Database Initialization

**File:** `src/db/db.ts`

Add column initialization helper (following existing pattern from other migrations):

```typescript
addColumnIfMissing("guild_movie_config", "qualification_threshold_minutes", "INTEGER DEFAULT 30");
```

This ensures existing databases get the column even without running migrations.

### Step 3: Create Config Getter Function

**File:** `src/features/movieNight.ts`

Add helper function to retrieve threshold with fallback:

```typescript
/**
 * Get guild's movie night qualification threshold in minutes.
 * Defaults to 30 minutes if not configured.
 */
function getMovieQualificationThreshold(guildId: string): number {
  const stmt = db.prepare(`
    SELECT qualification_threshold_minutes FROM guild_movie_config
    WHERE guild_id = ?
  `);
  const result = stmt.get(guildId) as { qualification_threshold_minutes: number } | undefined;
  return result?.qualification_threshold_minutes ?? 30;
}
```

Place this function near `getMovieAttendanceMode()` (line 183) for consistency.

### Step 4: Update Qualification Logic

**File:** `src/features/movieNight.ts:232-237`

Replace hardcoded threshold with config lookup:

```typescript
// Before:
const qualified =
  mode === "continuous"
    ? session.longestSessionMinutes >= 30
    : session.totalMinutes >= 30;

// After:
const threshold = getMovieQualificationThreshold(guild.id);
const qualified =
  mode === "continuous"
    ? session.longestSessionMinutes >= threshold
    : session.totalMinutes >= threshold;
```

### Step 5: Add Configuration Commands

**File:** `src/commands/config.ts`

Add subcommand handler to set threshold (following pattern of existing movie config):

```typescript
/**
 * Set movie night qualification threshold
 */
async function executeSetMovieThreshold(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    return;
  }

  const minutes = interaction.options.getInteger("minutes", true);

  // Validation: reasonable range (5-180 minutes = 5 min to 3 hours)
  if (minutes < 5 || minutes > 180) {
    await interaction.reply({
      content: "Threshold must be between 5 and 180 minutes.",
      ephemeral: true
    });
    return;
  }

  // Insert or update guild config
  const stmt = db.prepare(`
    INSERT INTO guild_movie_config (guild_id, qualification_threshold_minutes, updated_at)
    VALUES (?, ?, strftime('%s', 'now'))
    ON CONFLICT(guild_id) DO UPDATE SET
      qualification_threshold_minutes = excluded.qualification_threshold_minutes,
      updated_at = excluded.updated_at
  `);

  stmt.run(interaction.guildId, minutes);

  await interaction.reply({
    content: `Movie night qualification threshold set to **${minutes} minutes**.\n\nMembers must watch for at least ${minutes} minutes to qualify for tier roles.`,
    ephemeral: true
  });

  logger.info({
    evt: "movie_threshold_updated",
    guildId: interaction.guildId,
    threshold: minutes,
    userId: interaction.user.id
  }, "Movie qualification threshold updated");
}
```

Add to slash command builder:

```typescript
.addSubcommand(sub => sub
  .setName("set-movie-threshold")
  .setDescription("Set movie night qualification threshold in minutes")
  .addIntegerOption(opt => opt
    .setName("minutes")
    .setDescription("Minutes required to qualify (5-180)")
    .setRequired(true)
    .setMinValue(5)
    .setMaxValue(180)
  )
)
```

Update command router to include new subcommand.

### Step 6: Add Threshold Display Command

**File:** `src/commands/config.ts`

Add subcommand to view current movie configuration:

```typescript
async function executeShowMovieConfig(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    return;
  }

  const stmt = db.prepare(`
    SELECT attendance_mode, qualification_threshold_minutes
    FROM guild_movie_config
    WHERE guild_id = ?
  `);
  const config = stmt.get(interaction.guildId) as
    { attendance_mode: string; qualification_threshold_minutes: number } | undefined;

  const mode = config?.attendance_mode ?? "cumulative";
  const threshold = config?.qualification_threshold_minutes ?? 30;

  const modeDescription = mode === "continuous"
    ? "Longest single session must exceed threshold (stricter)"
    : "Total time across all sessions must exceed threshold (more forgiving)";

  await interaction.reply({
    embeds: [{
      title: "Movie Night Configuration",
      color: 0x5865F2,
      fields: [
        {
          name: "Attendance Mode",
          value: `\`${mode}\`\n${modeDescription}`,
          inline: false
        },
        {
          name: "Qualification Threshold",
          value: `**${threshold} minutes**\nMembers must watch for at least ${threshold} minutes to qualify.`,
          inline: false
        }
      ],
      footer: { text: "Use /config set-movie-threshold to change threshold" }
    }],
    ephemeral: true
  });
}
```

Add subcommand definition:

```typescript
.addSubcommand(sub => sub
  .setName("show-movie-config")
  .setDescription("View current movie night configuration")
)
```

### Step 7: Update Logging

**File:** `src/features/movieNight.ts:204-209`

Include threshold in finalization log:

```typescript
const mode = getMovieAttendanceMode(guild.id);
const threshold = getMovieQualificationThreshold(guild.id);

logger.info({
  evt: "finalizing_movie_attendance",
  guildId: guild.id,
  eventDate: event.eventDate,
  mode,
  threshold,  // Add this
  participantCount: movieSessions.size,
}, "Finalizing movie night attendance");
```

**File:** `src/features/movieNight.ts:249-258`

Include threshold in attendance recorded log:

```typescript
logger.info({
  evt: "attendance_recorded",
  guildId,
  userId,
  eventDate: event.eventDate,
  totalMinutes: session.totalMinutes,
  longestSession: session.longestSessionMinutes,
  qualified,
  mode,
  threshold,  // Add this
}, `Attendance recorded: ${qualified ? "✅ Qualified" : "❌ Not qualified"}`);
```

## Files Affected

### Modified Files
1. **`src/features/movieNight.ts`**
   - Add `getMovieQualificationThreshold()` helper function
   - Update qualification logic at lines 232-237
   - Update logging at lines 204-209 and 249-258

2. **`src/commands/config.ts`**
   - Add `executeSetMovieThreshold()` function
   - Add `executeShowMovieConfig()` function
   - Add subcommand builders and routing

3. **`src/db/db.ts`**
   - Add column initialization via `addColumnIfMissing()`

### New Files
4. **`migrations/026_add_movie_threshold.ts`**
   - Database migration for new column

5. **`migrations/lib/helpers.ts`** (if `columnExists` doesn't exist)
   - Add `columnExists()` helper if not already present

### Test Files
6. **`tests/features/movieNight.test.ts`** (if exists)
   - Test threshold retrieval with default fallback
   - Test custom thresholds affect qualification
   - Test edge cases (5 min, 180 min, null values)

## Testing Strategy

### Unit Tests

1. **Threshold retrieval:**
   - Test `getMovieQualificationThreshold()` returns 30 when not configured
   - Test returns configured value when set
   - Test handles missing guild_movie_config row gracefully

2. **Qualification logic:**
   - User with 29 minutes, 30 minute threshold → not qualified
   - User with 30 minutes, 30 minute threshold → qualified
   - User with 15 minutes, 10 minute threshold → qualified
   - User with 20 minutes continuous, 30 minute threshold, continuous mode → not qualified

### Integration Tests

1. **Configuration flow:**
   - Run `/config set-movie-threshold 15`
   - Verify database updated correctly
   - Run `/config show-movie-config`
   - Verify threshold displays as 15 minutes

2. **Attendance qualification:**
   - Configure threshold to 10 minutes
   - Start movie event with `/movie start`
   - Track user in VC for 12 minutes
   - End movie event with `/movie end`
   - Verify user qualifies (12 >= 10)
   - Check `movie_attendance` table has `qualified = 1`

3. **Multiple guilds:**
   - Configure Guild A with 15 minute threshold
   - Configure Guild B with 45 minute threshold
   - Verify each guild uses its own threshold independently

4. **Default behavior:**
   - Test guild with no movie_config row
   - Verify defaults to 30 minutes (backward compatibility)

### Migration Testing

1. **Fresh database:**
   - Run migration 026 on empty database
   - Verify column exists with DEFAULT 30

2. **Existing database:**
   - Create test database with movie_config rows
   - Run migration 026
   - Verify column added to all existing rows
   - Verify existing data preserved
   - Verify default value (30) applied

3. **Already migrated database:**
   - Run migration 026 twice
   - Verify idempotent (no errors, no data loss)

### Manual Testing

1. **Admin configuration:**
   - Configure threshold to 20 minutes via `/config set-movie-threshold 20`
   - View config via `/config show-movie-config`
   - Verify displays correctly

2. **Edge cases:**
   - Set threshold to minimum (5 minutes)
   - Set threshold to maximum (180 minutes)
   - Try to set threshold to 4 (should error)
   - Try to set threshold to 181 (should error)

3. **Backward compatibility:**
   - Test with guild that has never configured movie settings
   - Verify defaults work (30 minute threshold, cumulative mode)

4. **Attendance scenarios:**
   - Short film test: 20 minute movie, 15 minute threshold
   - Feature film test: 120 minute movie, 45 minute threshold
   - TV episode test: 22 minute episode, 10 minute threshold

## Rollback Plan

### Database Rollback

**Safety:** The new column has a DEFAULT value, so old code continues working:
- Old code hardcoded to 30 minutes still functions
- New column defaults to 30 minutes (identical behavior)
- No data migration required for rollback

**If column must be removed:**

SQLite doesn't support DROP COLUMN directly. Options:

1. **Leave column in place (recommended):**
   - Column is harmless if unused
   - Allows re-deploying feature without migration

2. **Table recreation (nuclear option):**
   ```sql
   -- Create new table without threshold column
   CREATE TABLE guild_movie_config_new (
     guild_id TEXT PRIMARY KEY,
     attendance_mode TEXT DEFAULT 'cumulative',
     updated_at INTEGER DEFAULT (strftime('%s', 'now'))
   );

   -- Copy data
   INSERT INTO guild_movie_config_new (guild_id, attendance_mode, updated_at)
   SELECT guild_id, attendance_mode, updated_at FROM guild_movie_config;

   -- Swap tables
   DROP TABLE guild_movie_config;
   ALTER TABLE guild_movie_config_new RENAME TO guild_movie_config;
   ```

### Code Rollback

```bash
# Revert code changes
git revert <commit-hash>
git push origin main

# Restart bot
pm2 restart pawtropolis-bot
```

**Validation after rollback:**
- Verify movie night qualification uses hardcoded 30 minutes
- Check logs for no errors related to missing functions
- Test `/movie` commands still work
- Confirm attendance recording functions normally

### Fallback Strategy

If issues occur in production:

1. **Partial rollback (keep database, revert code):**
   - Safest option
   - Column exists but isn't used
   - Bot uses hardcoded 30 minutes

2. **Config override:**
   - If specific threshold causing issues
   - Manually update database: `UPDATE guild_movie_config SET qualification_threshold_minutes = 30`
   - No code changes needed

3. **Monitor affected guilds:**
   - Check logs for qualification anomalies
   - Compare qualified counts before/after feature deployment
   - Manually adjust attendance records if needed

## Success Criteria

- [ ] Migration runs successfully on fresh and existing databases
- [ ] Column `qualification_threshold_minutes` exists with DEFAULT 30
- [ ] `getMovieQualificationThreshold()` returns correct value with fallback
- [ ] `/config set-movie-threshold <minutes>` updates database correctly
- [ ] `/config show-movie-config` displays current threshold
- [ ] Qualification logic uses configured threshold instead of hardcoded value
- [ ] Different guilds can have different thresholds independently
- [ ] Guilds without configuration default to 30 minutes (backward compatible)
- [ ] Validation prevents unreasonable values (<5 or >180 minutes)
- [ ] Logs include threshold value for debugging
- [ ] Unit tests pass with 100% coverage of new code
- [ ] Integration tests verify end-to-end configuration flow
- [ ] Existing movie night functionality unchanged when threshold = 30

## Post-Deployment Tasks

1. **Production verification:**
   - Check migration 026 ran successfully
   - Verify all guilds have default threshold (30)
   - Monitor logs for threshold-related messages

2. **Documentation:**
   - Update admin documentation with `/config set-movie-threshold` command
   - Document recommended thresholds for different content types:
     - Short films / TV episodes: 10-15 minutes
     - Feature films: 30-45 minutes
     - Movie marathons: 45-60 minutes

3. **Guild notifications:**
   - Announce new configuration option to server admins
   - Suggest reviewing threshold based on typical movie length
   - Provide examples of different threshold use cases

4. **Monitoring:**
   - Track threshold values across guilds (metrics/analytics)
   - Monitor qualification rates before/after threshold changes
   - Alert if threshold set to extreme values (<10 or >120)

## Notes

- **Preserves existing behavior:** Default 30 minutes maintains current system
- **Follows established patterns:** Mirrors `attendance_mode` configuration approach
- **Admin-friendly:** Simple integer parameter (minutes), no complex concepts
- **Flexible range:** 5-180 minutes covers short films to multi-hour marathons
- **Backward compatible:** Guilds without config continue working with defaults
- **Future extensibility:** Could add per-tier thresholds (tier 1: 30 min, tier 2: 60 min) later

## Future Improvements

If this feature proves successful, consider:

1. **Per-tier thresholds:**
   - Tier 1: 30 minutes
   - Tier 2: 60 minutes
   - Tier 3: 90 minutes
   - Rewards longer participation with higher tiers

2. **Percentage-based thresholds:**
   - Qualify by watching 50% of the movie
   - Requires storing movie duration with event
   - More dynamic than fixed minutes

3. **Activity-based thresholds:**
   - Lower threshold for guilds with fewer participants
   - Higher threshold for larger communities
   - Auto-adjust based on typical attendance

4. **Threshold recommendations:**
   - Bot suggests threshold based on recent movie lengths
   - Analyze past events to optimize qualification rate
   - Alert if current threshold results in <10% or >90% qualification
