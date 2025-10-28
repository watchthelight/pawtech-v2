# Avatar NSFW Detection Test Results

**Date:** 2025-10-28
**Model:** WD v3 ViT Tagger
**Tag Count:** 10,861 tags

## Test Configuration

**Thresholds:**
- `SOFT_DAMPEN`: 0.45
- `MIN_HARD_FLOOR`: 0.90
- `GENERAL_CLAMP_TRIGGER`: 0.45
- `GENERAL_CLAMP_VALUE`: 0.15

**Risk Levels:**
- 0-39%: Safe (reason: "none")
- 40-69%: Suggestive (reason: "suggestive")
- 70-89%: Soft evidence (reason: "soft_evidence")
- 90-100%: Hard evidence (reason: "hard_evidence")

---

## Test Results

### Safe Images (Expected: <40% score)

#### Test 1: Discord Default Avatar #0
- **URL:** `https://cdn.discordapp.com/embed/avatars/0.png`
- **Score:** 1%
- **Reason:** none
- **NSFW Score:** 0.3%
- **Furry Score:** 0.1%
- **Scalie Score:** 0.1%
- **Inference Time:** 1340ms (first run, includes model loading)
- **Crops Used:** 1
- **Status:** ✅ PASS - Correctly identified as safe

#### Test 2: Discord Default Avatar #1
- **URL:** `https://cdn.discordapp.com/embed/avatars/1.png`
- **Score:** 1%
- **Reason:** none
- **NSFW Score:** 0.3%
- **Furry Score:** 0.1%
- **Scalie Score:** 0.1%
- **Status:** ✅ PASS - Correctly identified as safe

#### Test 3: Discord Default Avatar #2
- **URL:** `https://cdn.discordapp.com/embed/avatars/2.png`
- **Score:** 1%
- **Reason:** none
- **NSFW Score:** 0.3%
- **Furry Score:** 0.1%
- **Scalie Score:** 0.1%
- **Status:** ✅ PASS - Correctly identified as safe

---

## Performance Metrics

### Inference Speed
- **First run (cold start):** ~1340ms
- **Subsequent runs (warm):** ~200-300ms (estimated)
- **Multi-crop strategy:** 1-5 crops depending on early exit

### Memory Usage
- **Model size:** 361 MB
- **Runtime memory:** ~200-300 MB (estimated)
- **Tag vocabulary:** 301 KB

### Accuracy (Initial Tests)
- **Safe image detection:** 3/3 (100%)
- **False positive rate:** 0/3 (0%)
- **False negative rate:** N/A (no NSFW images tested yet)

---

## Observations

### Strengths
1. **Consistent scoring:** All Discord default avatars scored identically at 1%
2. **Fast model loading:** Model loads in ~600ms
3. **Low false positives:** No safe images incorrectly flagged
4. **Proper evidence tracking:** Evidence arrays populated correctly

### Areas to Monitor
1. **Need more diverse test data:** Only tested simple geometric Discord avatars
2. **Furry avatar testing:** Need to test with actual furry artwork (safe and NSFW)
3. **Edge case handling:** Need to test suggestive but non-explicit content
4. **Performance at scale:** Need to test concurrent inference

---

## Next Steps

### Immediate Testing Needed
- [ ] Test with safe furry avatars (portraits, headshots)
- [ ] Test with safe scalie avatars (dragon characters)
- [ ] Test with suggestive content (40-69% range)
- [ ] Test with explicit content (70-100% range)
- [ ] Test with edge cases (borderline content)

### Threshold Tuning
Based on initial results:
- Current thresholds appear conservative (good for avoiding false positives)
- May need adjustment after testing with furry-specific content
- SOFT_DAMPEN (0.45) may need increase if furry art triggers too often

### Production Monitoring
- [ ] Enable `RISK_DEBUG=1` initially to log full evidence
- [ ] Monitor first 50-100 real application scans
- [ ] Collect staff feedback on accuracy
- [ ] Document any false positives/negatives
- [ ] Adjust thresholds based on real-world data

---

## Test Image Sources

### Safe Test Images (Discord Defaults)
- Discord embed avatars (0-5): Simple geometric shapes, known safe content

### Future Test Sources
- Public furry art galleries (with permission)
- SFW furry community avatar collections
- Known safe character reference sheets

---

## Changelog

### 2025-10-28 - Initial Testing
- Implemented WD v3 ViT tagger with dynamic tag loading
- Tested 3 Discord default avatars - all passed (1% score)
- Model loads successfully and performs inference
- Evidence tracking working correctly
- Ready for expanded testing

---

## Notes

- All test images should be publicly accessible and non-copyrighted
- NSFW test images should only be used privately, not committed to repo
- Real application testing will provide best accuracy data
- Staff feedback is crucial for threshold tuning
