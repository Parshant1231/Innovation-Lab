-- QuantumSafe Messenger — PostgreSQL Schema
-- Zero-plaintext policy: private keys and message content NEVER stored here
-- Run via: docker-compose exec backend node scripts/migrate.js
-- Or auto-runs via docker-entrypoint-initdb.d on first postgres start

-- ── Extensions ──────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USERS ────────────────────────────────────────────────────────
-- Stores identity only. Password is bcrypt hash — NEVER plaintext.
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username      VARCHAR(32)  NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,       -- bcrypt cost 12 — never plaintext
  status        VARCHAR(10)  NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
  reliable_delivery BOOLEAN NOT NULL DEFAULT false, -- opt-in: use PG queue instead of Redis-only
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status   ON users(status);

-- ── DEVICES ──────────────────────────────────────────────────────
-- One user can have many devices (phone, laptop, tablet).
-- Stores PUBLIC keys only. Private keys NEVER leave the device.
CREATE TABLE IF NOT EXISTS devices (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id             UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  device_name           VARCHAR(64),                          -- "iPhone 15", "Chrome on MacBook"
  kyber_public_key      TEXT NOT NULL,                        -- Kyber-1024 public key (Phase 2)
  dilithium_public_key  TEXT NOT NULL,                        -- Dilithium3 public key (Phase 2)
  push_subscription     TEXT,                                 -- Web Push subscription JSON (Phase 5)
  last_seen             TIMESTAMPTZ,
  registered_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id   ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);

-- ── MESSAGES ─────────────────────────────────────────────────────
-- Stores DELIVERED message ciphertext for chat history display.
-- ciphertext is the AES-256-GCM encrypted blob. NEVER plaintext.
-- iv and auth_tag are required for decryption by the recipient's device.
CREATE TABLE IF NOT EXISTS messages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id       UUID NOT NULL,
  sender_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext    TEXT NOT NULL,     -- base64-encoded AES-256-GCM ciphertext — NEVER plaintext
  iv            TEXT NOT NULL,     -- base64-encoded 96-bit nonce
  auth_tag      TEXT NOT NULL,     -- base64-encoded 128-bit GCM authentication tag
  sequence_num  BIGINT NOT NULL,   -- monotonically increasing per chat, used by Double Ratchet
  status        VARCHAR(10) NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent', 'delivered', 'read')),
  blockchain_hash TEXT,            -- SHA-256 of ciphertext, logged to Polygon (Phase 4)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id      ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id    ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at   ON messages(created_at DESC);

-- ── PUBLIC KEYS ───────────────────────────────────────────────────
-- Rotating public key registry. Public keys rotate every 24h.
-- Devices upload new key pairs here; server serves these to senders.
CREATE TABLE IF NOT EXISTS public_keys (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  kyber_key       TEXT NOT NULL,         -- Kyber-1024 public key for this rotation
  dilithium_key   TEXT NOT NULL,         -- Dilithium3 public key for this rotation
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_public_keys_user_id   ON public_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_public_keys_device_id ON public_keys(device_id);
CREATE INDEX IF NOT EXISTS idx_public_keys_expires   ON public_keys(expires_at);

-- Auto-cleanup expired keys (PostgreSQL scheduled with pg_cron in production)
-- For now, application layer handles cleanup on key fetch

-- ── MESSAGE QUEUE ─────────────────────────────────────────────────
-- OPT-IN ONLY — used when user enables "Reliable Delivery" in settings.
-- DEFAULT path uses Redis (in-memory, 48h TTL) — see server/services/dbService.js
-- This table stores ciphertext blobs for users who need persistence across
-- server restarts. Hard 7-day TTL regardless. Deleted immediately on delivery.
CREATE TABLE IF NOT EXISTS message_queue (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id     UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  sender_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext    TEXT NOT NULL,    -- encrypted blob — no key stored
  iv            TEXT NOT NULL,
  auth_tag      TEXT NOT NULL,
  sequence_num  BIGINT NOT NULL,
  chat_id       UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ttl_expires   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days') -- HARD MAX: 7 days
);

CREATE INDEX IF NOT EXISTS idx_queue_recipient_device ON message_queue(recipient_id, device_id);
CREATE INDEX IF NOT EXISTS idx_queue_ttl              ON message_queue(ttl_expires);

-- ── HELPER: updated_at trigger ────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── HELPER: Auto-delete expired queue entries ─────────────────────
-- Runs on every SELECT to clean up, or schedule with pg_cron in production
CREATE OR REPLACE FUNCTION cleanup_expired_queue() RETURNS void AS $$
BEGIN
  DELETE FROM message_queue WHERE ttl_expires < NOW();
END;
$$ LANGUAGE plpgsql;
