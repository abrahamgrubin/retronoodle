-- Profiles mirror auth.users 1:1. IDs are the Supabase Auth user id (Google sign-in, RN-003),
-- not browser-generated, since the row can only exist once that user has authenticated.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  email text not null,
  avatar_url text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);
