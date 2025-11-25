#!/bin/bash
# Comprehensive disk cleanup script

echo "🧹 Pawtropolis Disk Cleanup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "📊 Current disk usage:"
df -h /home/ubuntu | grep -E '(Filesystem|/dev/root)'
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 Part 1: Old Deploy Archives (tar.gz)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

TAR_COUNT=$(find /home/ubuntu -maxdepth 1 -name '*.tar.gz' -type f 2>/dev/null | wc -l)
TAR_COUNT_TECH=$(find /home/ubuntu/pawtropolis-tech -maxdepth 1 -name '*.tar.gz' -type f 2>/dev/null | wc -l)
TOTAL_TAR_COUNT=$((TAR_COUNT + TAR_COUNT_TECH))

if [ $TOTAL_TAR_COUNT -gt 0 ]; then
    echo "Found $TOTAL_TAR_COUNT old deploy archives:"
    find /home/ubuntu -maxdepth 1 -name '*.tar.gz' -type f -exec ls -lh {} \; 2>/dev/null | awk '{print "  " $5 "\t" $9}'
    find /home/ubuntu/pawtropolis-tech -maxdepth 1 -name '*.tar.gz' -type f -exec ls -lh {} \; 2>/dev/null | awk '{print "  " $5 "\t" $9}'

    TAR_SIZE=$(du -ch /home/ubuntu/*.tar.gz /home/ubuntu/pawtropolis-tech/*.tar.gz 2>/dev/null | tail -1 | awk '{print $1}')
    echo ""
    echo "Total size: $TAR_SIZE"
else
    echo "✅ No old tar.gz files found"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💾 Part 2: Database Backups"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

DB_BACKUP_COUNT=$(find /home/ubuntu/pawtropolis-tech/data -name '*.db.backup*' -type f 2>/dev/null | wc -l)

if [ $DB_BACKUP_COUNT -gt 0 ]; then
    echo "Found $DB_BACKUP_COUNT database backups:"
    echo ""
    find /home/ubuntu/pawtropolis-tech/data -name '*.db.backup*' -type f -exec ls -lh {} \; 2>/dev/null | sort -k9 | awk '{print "  " $5 "\t" $9}' | tail -15

    if [ $DB_BACKUP_COUNT -gt 15 ]; then
        echo "  ... (showing 15 most recent)"
    fi

    DB_SIZE=$(du -ch /home/ubuntu/pawtropolis-tech/data/*.db.backup* 2>/dev/null | tail -1 | awk '{print $1}')
    echo ""
    echo "Total size: $DB_SIZE"
    echo ""
    echo "Strategy: Keep 3 most recent + oldest, delete rest"
else
    echo "✅ No database backups found"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "⚠️  Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ $TOTAL_TAR_COUNT -eq 0 ] && [ $DB_BACKUP_COUNT -eq 0 ]; then
    echo "✅ Nothing to clean up!"
    exit 0
fi

echo "This will:"
if [ $TOTAL_TAR_COUNT -gt 0 ]; then
    echo "  🗑️  Delete $TOTAL_TAR_COUNT old deploy archives (~$TAR_SIZE)"
fi
if [ $DB_BACKUP_COUNT -gt 0 ]; then
    echo "  🗑️  Delete $(($DB_BACKUP_COUNT - 4)) old database backups (keep 4 newest)"
fi
echo ""
echo "✅ Preserves:"
echo "  - /home/ubuntu/archives/ (intentional archives)"
echo "  - /home/ubuntu/.npm/ (npm cache)"
echo "  - 4 most recent database backups"
echo ""

read -p "Continue? (y/N): " confirm

if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "❌ Cancelled"
    exit 0
fi

echo ""
echo "🗑️  Cleaning up..."
echo ""

# Remove old deploy archives
if [ $TOTAL_TAR_COUNT -gt 0 ]; then
    echo "Removing deploy archives..."
    rm -fv /home/ubuntu/*.tar.gz 2>/dev/null | head -5
    rm -fv /home/ubuntu/pawtropolis-tech/*.tar.gz 2>/dev/null | head -5
    echo "  ✅ Removed $TOTAL_TAR_COUNT tar.gz files"
fi

# Remove old database backups (keep 4 newest)
if [ $DB_BACKUP_COUNT -gt 4 ]; then
    echo ""
    echo "Removing old database backups (keeping 4 newest)..."

    # Get list of backups sorted by date, skip first 4 (newest)
    find /home/ubuntu/pawtropolis-tech/data -name '*.db.backup*' -type f -printf '%T@ %p\n' 2>/dev/null | \
        sort -rn | \
        tail -n +5 | \
        cut -d' ' -f2- | \
        while read file; do
            rm -fv "$file"
        done

    REMOVED_COUNT=$(($DB_BACKUP_COUNT - 4))
    echo "  ✅ Removed $REMOVED_COUNT old backups"
fi

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "📊 New disk usage:"
df -h /home/ubuntu | grep -E '(Filesystem|/dev/root)'
echo ""

AVAIL_GB=$(df -h /home/ubuntu | grep /dev/root | awk '{print $4}')
echo "💾 Available space: $AVAIL_GB"
