alter table public.notes
  add column if not exists map_slug text not null default 'tsuchiura-yosui';

create index if not exists notes_map_slug_inserted_at_idx
  on public.notes (map_slug, inserted_at);
