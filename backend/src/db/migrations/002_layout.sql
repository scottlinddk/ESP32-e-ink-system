-- Migration: add layout JSONB column to user_preferences
-- Stores the user's custom grid layout for the e-ink display.
-- NULL = use the server-side default layout.
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS layout JSONB DEFAULT NULL;
