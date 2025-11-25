const DB = require("better-sqlite3");
const fs = require("fs");

const path = "./data/data.db";
if (!fs.existsSync(path)) {
  console.error("DB not found at", path);
  process.exit(1);
}

const db = new DB(path);

// Table DDL
const ddl = db.prepare("SELECT sql FROM sqlite_schema WHERE name='review_action' AND type='table';").get();
console.log("\n== review_action DDL ==");
console.log(ddl ? ddl.sql : "NO TABLE");

// Column info
console.log("\n== PRAGMA table_info(review_action) ==");
console.table(db.prepare("PRAGMA table_info(review_action);").all());

// Indexes
console.log("\n== PRAGMA index_list(review_action) ==");
console.table(db.prepare("PRAGMA index_list(review_action);").all());

// Foreign keys
console.log("\n== PRAGMA foreign_key_list(review_action) ==");
console.table(db.prepare("PRAGMA foreign_key_list(review_action);").all());

// Backfill sanity
const nulls = db.prepare("SELECT COUNT(*) AS c FROM review_action WHERE created_at IS NULL;").get().c;
console.log("\nrows_with_null_created_at =", nulls);
