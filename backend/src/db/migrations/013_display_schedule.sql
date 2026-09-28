-- Named layout pages, UTC rotation and local quiet hours. NULL keeps the single saved layout.
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS display_schedule JSONB DEFAULT NULL;
