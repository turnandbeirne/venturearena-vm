-- VentureFlow online tables: the ordered move list every browser at the table replays.
create table vf_moves (
  table_id uuid references tables on delete cascade,
  seq int not null,
  action jsonb not null,
  by_player uuid references profiles,
  created_at timestamptz default now(),
  primary key (table_id, seq)
);
alter table vf_moves enable row level security;
-- Readable with the table id (an unguessable uuid); the game client has no arena login.
create policy "vf moves readable" on vf_moves for select using (true);
alter publication supabase_realtime add table vf_moves;

-- Append a move atomically: the sequence must be exactly the next one.
create or replace function vf_append_move(p_table uuid, p_seq int, p_action jsonb, p_by uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cur int;
begin
  select coalesce(max(seq), 0) into cur from vf_moves where table_id = p_table for update;
  if p_seq <> cur + 1 then raise exception 'SEQ_CONFLICT expected % got %', cur + 1, p_seq; end if;
  insert into vf_moves (table_id, seq, action, by_player) values (p_table, p_seq, p_action, p_by);
  return p_seq;
end $$;
revoke execute on function vf_append_move(uuid, int, jsonb, uuid) from public, anon, authenticated;

-- VentureFlow seats four: humans from the arena table, robots fill the rest.
update games set max_players = 4, min_players = 1,
  tagline = 'Run a startup for 24 months at a live table with up to 4 players. Every round is a decision about cash.'
  where id = 'ventureflow';

create or replace function start_external(p_table uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare host uuid; st text; g text; n int; s jsonb;
begin
  select host_id, status, game_id, settings into host, st, g, s from tables where id = p_table;
  if host <> auth.uid() then raise exception 'only the host can start'; end if;
  select count(*) into n from table_seats where table_id = p_table and role = 'player' and not is_bot;
  if n < 1 then raise exception 'need at least one player'; end if;
  if st = 'open' then
    s := coalesce(s, jsonb_build_object(
      'seed', abs(hashtext(p_table::text)),
      'scenarioId', 'classic', 'difficultyId', 'medium', 'weatherSeverityId', 'normal',
      'aiCount', greatest(0, 4 - n)));
    update tables set status = 'playing', started_at = now(), settings = s where id = p_table;
  end if;
  return s;
end $$;
