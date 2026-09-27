-- Per-user UI preferences (task 5.1: fleet column choice and row density persist per user, PRD FL-3).
-- Stored on the user's profile, which only they can update (profiles_update policy).
alter table public.profiles
  add column preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object');
