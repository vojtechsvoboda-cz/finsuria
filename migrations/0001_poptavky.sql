CREATE TABLE IF NOT EXISTS poptavky (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  jmeno TEXT NOT NULL,
  role TEXT,
  svj TEXT NOT NULL,
  pocet_jednotek TEXT,
  vytapeni TEXT,
  temata TEXT,
  zprava TEXT,
  telefon TEXT,
  email TEXT NOT NULL,
  preferovany_kontakt TEXT,
  email_odeslan INTEGER NOT NULL DEFAULT 0,
  ip_zeme TEXT
);
