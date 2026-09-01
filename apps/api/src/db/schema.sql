-- NaruReader — SQLite schema (Phase 1)
-- Dijalankan oleh scripts/init-db.js. Idempotent (IF NOT EXISTS).

-- Tabel Komik (Series)
CREATE TABLE IF NOT EXISTS comics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  cover_image TEXT,              -- path relatif dari DATA_DIR, mis. comics/naruto/cover.webp
  author TEXT,
  artist TEXT,
  genres TEXT,                   -- JSON array: ["Action","Fantasy"]
  source TEXT,                   -- manual, komiku, webtoons, dst
  status TEXT DEFAULT 'Ongoing', -- Ongoing / Completed / Hiatus
  rating REAL,
  total_chapters INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_read_at TIMESTAMP,
  is_favorite BOOLEAN DEFAULT 0
);

-- Tabel Chapter
CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comic_id INTEGER NOT NULL,
  chapter_number REAL NOT NULL,
  chapter_title TEXT,
  slug TEXT,                     -- juga dipakai sebagai nama folder: chapter-1, chapter-10-5
  total_pages INTEGER DEFAULT 0,
  source_url TEXT,
  downloaded_at TIMESTAMP,
  is_downloaded BOOLEAN DEFAULT 0,
  file_size INTEGER DEFAULT 0,   -- bytes (total halaman setelah kompresi)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(comic_id) REFERENCES comics(id) ON DELETE CASCADE,
  UNIQUE(comic_id, chapter_number)
);

-- Tabel Pages
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL,
  page_number INTEGER NOT NULL,
  image_filename TEXT NOT NULL,  -- nama file saja, mis. 001.webp
  image_size INTEGER,            -- bytes setelah kompresi
  original_size INTEGER,         -- bytes sebelum kompresi
  compression_ratio REAL,        -- 0.78 = 78% lebih kecil
  hash TEXT,                     -- sha1 isi file, untuk deteksi duplikat
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  UNIQUE(chapter_id, page_number)
);

-- Reading progress (satu baris per comic+chapter)
CREATE TABLE IF NOT EXISTS reading_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comic_id INTEGER NOT NULL,
  chapter_id INTEGER NOT NULL,
  last_page_read INTEGER DEFAULT 1,
  progress_percentage REAL DEFAULT 0,
  read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(comic_id) REFERENCES comics(id) ON DELETE CASCADE,
  FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  UNIQUE(comic_id, chapter_id)
);

-- Bookmarks
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comic_id INTEGER NOT NULL,
  chapter_id INTEGER NOT NULL,
  page_number INTEGER,
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(comic_id) REFERENCES comics(id) ON DELETE CASCADE,
  FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

-- Download queue (queue berbasis SQLite — zero dependency, tanpa Redis)
CREATE TABLE IF NOT EXISTS download_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comic_id INTEGER NOT NULL,
  chapter_id INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending, downloading, completed, failed, paused
  priority INTEGER DEFAULT 0,
  progress REAL DEFAULT 0,        -- 0..100
  attempts INTEGER DEFAULT 0,
  payload TEXT,                   -- JSON: { image_urls: [...] }
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  FOREIGN KEY(comic_id) REFERENCES comics(id) ON DELETE CASCADE,
  FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_comics_favorite ON comics(is_favorite);
CREATE INDEX IF NOT EXISTS idx_comics_status ON comics(status);
CREATE INDEX IF NOT EXISTS idx_comics_updated ON comics(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chapters_comic ON chapters(comic_id);
CREATE INDEX IF NOT EXISTS idx_chapters_downloaded ON chapters(is_downloaded);
CREATE INDEX IF NOT EXISTS idx_pages_chapter ON pages(chapter_id);
CREATE INDEX IF NOT EXISTS idx_reading_progress_comic ON reading_progress(comic_id);
CREATE INDEX IF NOT EXISTS idx_reading_progress_read_at ON reading_progress(read_at DESC);
CREATE INDEX IF NOT EXISTS idx_queue_status ON download_queue(status, priority DESC, id);

-- Full-text search.
-- Catatan: SQLite tidak punya "CREATE FULLTEXT INDEX" (itu sintaks MySQL);
-- padanannya adalah virtual table FTS5 + trigger sinkronisasi.
CREATE VIRTUAL TABLE IF NOT EXISTS comics_fts USING fts5(
  title,
  author,
  description,
  content='comics',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS comics_fts_ai AFTER INSERT ON comics BEGIN
  INSERT INTO comics_fts(rowid, title, author, description)
  VALUES (new.id, new.title, new.author, new.description);
END;

CREATE TRIGGER IF NOT EXISTS comics_fts_ad AFTER DELETE ON comics BEGIN
  INSERT INTO comics_fts(comics_fts, rowid, title, author, description)
  VALUES ('delete', old.id, old.title, old.author, old.description);
END;

CREATE TRIGGER IF NOT EXISTS comics_fts_au AFTER UPDATE ON comics BEGIN
  INSERT INTO comics_fts(comics_fts, rowid, title, author, description)
  VALUES ('delete', old.id, old.title, old.author, old.description);
  INSERT INTO comics_fts(rowid, title, author, description)
  VALUES (new.id, new.title, new.author, new.description);
END;

-- Temuan pengawas (bot audit): chapter tidak lengkap, berkas rusak, nomor bolong.
CREATE TABLE IF NOT EXISTS audit_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comic_id INTEGER NOT NULL,
  chapter_id INTEGER,
  chapter_number REAL,
  kind TEXT NOT NULL,          -- missing_file, size_zero, count_mismatch, not_downloaded, gap, empty_chapter
  detail TEXT,
  status TEXT DEFAULT 'open',  -- open, queued, resolved
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  FOREIGN KEY(comic_id) REFERENCES comics(id) ON DELETE CASCADE,
  FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  UNIQUE(comic_id, chapter_number, kind)
);

CREATE INDEX IF NOT EXISTS idx_audit_status ON audit_findings(status, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- Akun & peran (Phase 2)
-- ─────────────────────────────────────────────────────────────────────

-- Peran: super_admin | publisher | editor | author | reader
-- Membaca komik TIDAK butuh akun sama sekali; akun hanya menambah kemampuan
-- (memberi rating, berkomentar, dan bagi staf: mengelola koleksi).
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,   -- scrypt: <salt-hex>:<hash-hex>
  role TEXT NOT NULL DEFAULT 'reader',
  display_name TEXT,
  is_active BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP,
  created_by INTEGER,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Sesi memakai token acak buram yang disimpan di server, bukan JWT. Alasannya
-- praktis: sesi bisa dicabut seketika (nonaktifkan akun = semua sesinya mati),
-- dan tidak ada rahasia penandatanganan yang harus dijaga di berkas .env.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  user_agent TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Satu pembaca = satu nilai per komik. Diubah, bukan ditumpuk.
CREATE TABLE IF NOT EXISTS comic_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comic_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  value INTEGER NOT NULL CHECK(value BETWEEN 1 AND 5),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(comic_id) REFERENCES comics(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(comic_id, user_id)
);

CREATE TABLE IF NOT EXISTS comic_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comic_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- Disembunyikan oleh editor/super admin, bukan dihapus: jejaknya tetap ada
  -- kalau suatu saat perlu ditinjau ulang.
  is_hidden BOOLEAN DEFAULT 0,
  hidden_by INTEGER,
  FOREIGN KEY(comic_id) REFERENCES comics(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(hidden_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_ratings_comic ON comic_ratings(comic_id);
CREATE INDEX IF NOT EXISTS idx_comments_comic ON comic_comments(comic_id, created_at DESC);
