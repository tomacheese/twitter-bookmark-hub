/**
 * SQLite スキーマ定義。
 * crawler と viewer/backend の両方で使用する。
 * スキーマを変更する場合はここだけを更新すること。
 */
export const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS users (
    user_id           TEXT PRIMARY KEY,
    screen_name       TEXT NOT NULL,
    user_name         TEXT NOT NULL,
    profile_image_url TEXT,
    updated_at        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tweets (
    tweet_id           TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL,
    full_text          TEXT NOT NULL,
    created_at         TEXT NOT NULL,
    quoted_tweet_id    TEXT,
    card_type          TEXT CHECK(card_type IN ('player', 'summary', 'summary_large_image')),
    card_url           TEXT,
    card_vanity_url    TEXT,
    card_title         TEXT,
    card_description   TEXT,
    card_thumbnail_url TEXT,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (quoted_tweet_id) REFERENCES tweets(tweet_id)
  );

  CREATE TABLE IF NOT EXISTS media_items (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    tweet_id  TEXT NOT NULL,
    position  INTEGER NOT NULL DEFAULT 0,
    type      TEXT NOT NULL CHECK(type IN ('photo', 'video', 'animated_gif')),
    thumb_url TEXT NOT NULL,
    video_url TEXT,
    FOREIGN KEY (tweet_id) REFERENCES tweets(tweet_id)
  );

  CREATE TABLE IF NOT EXISTS url_entities (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tweet_id     TEXT NOT NULL,
    url          TEXT NOT NULL,
    expanded_url TEXT NOT NULL,
    display_url  TEXT NOT NULL,
    FOREIGN KEY (tweet_id) REFERENCES tweets(tweet_id)
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    tweet_id             TEXT NOT NULL,
    account_username     TEXT NOT NULL,
    first_bookmarked_at  TEXT NOT NULL,
    last_seen_at         TEXT NOT NULL,
    position             INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tweet_id, account_username),
    FOREIGN KEY (tweet_id) REFERENCES tweets(tweet_id)
  );

  CREATE TABLE IF NOT EXISTS crawl_jobs (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at         TEXT NOT NULL,
    finished_at        TEXT,
    status             TEXT NOT NULL CHECK(status IN ('running', 'success', 'error')),
    error_message      TEXT,
    accounts_total     INTEGER,
    accounts_succeeded INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_tweets_user_id         ON tweets(user_id);
  CREATE INDEX IF NOT EXISTS idx_tweets_created_at      ON tweets(created_at);
  CREATE INDEX IF NOT EXISTS idx_media_items_tweet_id   ON media_items(tweet_id);
  CREATE INDEX IF NOT EXISTS idx_url_entities_tweet_id  ON url_entities(tweet_id);
  CREATE INDEX IF NOT EXISTS idx_bookmarks_account      ON bookmarks(account_username);
  CREATE INDEX IF NOT EXISTS idx_bookmarks_last_seen    ON bookmarks(last_seen_at);

  CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT    NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS tweet_tags (
    tweet_id TEXT    NOT NULL REFERENCES tweets(tweet_id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (tweet_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    color      TEXT    NOT NULL DEFAULT '#6B7280',
    keywords   TEXT    NOT NULL DEFAULT '[]',
    created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS tweet_categories (
    tweet_id    TEXT    NOT NULL REFERENCES tweets(tweet_id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    confidence  REAL    NOT NULL DEFAULT 1.0,
    PRIMARY KEY (tweet_id, category_id)
  );

  CREATE INDEX IF NOT EXISTS idx_tweet_tags_tag_id           ON tweet_tags(tag_id);
  CREATE INDEX IF NOT EXISTS idx_tweet_categories_cat_id     ON tweet_categories(category_id);
`
