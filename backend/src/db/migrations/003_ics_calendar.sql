-- ICS Calendar integration — add URL column to user_preferences
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS ics_calendar_url TEXT;
