create table if not exists public.terrain_profiles (
  id text not null,
  map_slug text not null default 'tsuchiura-yosui',
  name text not null,
  points jsonb not null default '[]'::jsonb,
  created_by uuid not null,
  created_by_login text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint terrain_profiles_pkey primary key (map_slug, id),
  constraint terrain_profiles_points_array check (jsonb_typeof(points) = 'array')
);

create index if not exists terrain_profiles_map_updated_idx
  on public.terrain_profiles (map_slug, updated_at desc);

create index if not exists terrain_profiles_created_by_idx
  on public.terrain_profiles (created_by);

alter table public.terrain_profiles enable row level security;
