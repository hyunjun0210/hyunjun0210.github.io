-- Run this once in the Supabase SQL Editor for the project used by Netlify.
create table if not exists public.reactions (
  id bigint generated always as identity primary key,
  artwork_id text not null check (artwork_id in (
    'photo-night',
    'animation-short',
    'poster'
  )),
  created_at timestamptz not null default now()
);

create index if not exists reactions_artwork_id_idx
  on public.reactions (artwork_id);

alter table public.reactions enable row level security;

-- No anonymous policies are created: only the Netlify function's server-side
-- service role key can insert or read reaction records.
