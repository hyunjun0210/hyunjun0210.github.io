-- Run this once in the Supabase SQL Editor for the project used by Netlify.
create table if not exists public.reactions (
  id bigint generated always as identity primary key,
  artwork_id text not null check (artwork_id in (
    'photo-night',
    'animation-short',
    'poster',
    'kart3d'
  )),
  created_at timestamptz not null default now()
);

create index if not exists reactions_artwork_id_idx
  on public.reactions (artwork_id);

alter table public.reactions enable row level security;

-- No anonymous policies are created: only the Netlify function's server-side
-- service role key can insert or read reaction records.

-- 방명록: 포트폴리오를 본 사람이 짧은 응원 글을 남긴다.
-- 저장 항목: 글 고유 번호(id), 별명(nickname), 메시지(message), 저장 시각(created_at).
-- 실명·연락처는 받지 않는다. 길이 제약은 서버 함수와 동일하게 DB에서도 강제한다.
create table if not exists public.guestbook_entries (
  id bigint generated always as identity primary key,
  nickname text not null check (char_length(nickname) between 2 and 12),
  message text not null check (char_length(message) between 1 and 100),
  created_at timestamptz not null default now()
);

create index if not exists guestbook_entries_created_at_idx
  on public.guestbook_entries (created_at desc);

alter table public.guestbook_entries enable row level security;

-- 익명 정책을 만들지 않는다. 브라우저는 테이블에 직접 접근하지 못하고,
-- Netlify 함수(service role)만 등록·조회한다. 수정·삭제 API는 제공하지 않는다.
