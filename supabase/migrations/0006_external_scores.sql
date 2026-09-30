-- External games played solo-per-player against a shared seed ("arena race"):
-- each player's game reports its own score; the table finalizes when everyone has reported
-- (or when the host finalizes early; missing players place last).
create table external_scores (
  table_id uuid references tables on delete cascade,
  player_id uuid references profiles on delete cascade,
  score numeric not null,
  skill_tags text[] default '{}',
  telemetry jsonb,
  reported_at timestamptz default now(),
  primary key (table_id, player_id)
);
alter table external_scores enable row level security;
create policy "scores visible at my table" on external_scores for select using (is_seated(table_id));
alter publication supabase_realtime add table external_scores;

-- deterministic per-table settings for the external game (seed, scenario etc.) chosen at start
alter table tables add column settings jsonb;

create or replace function finalize_external(p_table uuid) returns void
language plpgsql security definer set search_path = public as $$
declare res jsonb; host uuid; st text; missing int;
begin
  select host_id, status into host, st from tables where id = p_table;
  if st <> 'playing' then return; end if;
  -- callable by the host, or by the server (auth.uid() null) when everyone has reported
  select count(*) into missing from table_seats s where s.table_id = p_table and s.role = 'player' and not s.is_bot
    and not exists (select 1 from external_scores e where e.table_id = p_table and e.player_id = s.player_id);
  if auth.uid() is not null and auth.uid() <> host then raise exception 'only the host can finalize early'; end if;
  if auth.uid() is null and missing > 0 then return; end if;
  with ranked as (
    select s.player_id, e.score, e.skill_tags, e.telemetry,
           rank() over (order by coalesce(e.score, -1e18) desc) as placement
    from table_seats s left join external_scores e on e.table_id = s.table_id and e.player_id = s.player_id
    where s.table_id = p_table and s.role = 'player' and not s.is_bot)
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('player_id', player_id, 'placement', placement, 'score', score,
                                      'skill_tags', coalesce(to_jsonb(skill_tags), '[]'::jsonb), 'telemetry', telemetry)))
    into res from ranked;
  perform record_result(p_table, res);
end $$;
revoke execute on function finalize_external(uuid) from public, anon;

-- called by report-result (service role) for one player's score
create or replace function submit_external_score(p_table uuid, p_player uuid, p_score numeric, p_tags text[], p_telemetry jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare st text; missing int;
begin
  select status into st from tables where id = p_table;
  if st = 'finished' then return true; end if;
  if st <> 'playing' then raise exception 'table is not in play'; end if;
  if not exists (select 1 from table_seats where table_id = p_table and player_id = p_player and role = 'player') then
    raise exception 'player is not seated at this table';
  end if;
  insert into external_scores (table_id, player_id, score, skill_tags, telemetry) values (p_table, p_player, p_score, coalesce(p_tags,'{}'), p_telemetry)
    on conflict (table_id, player_id) do update set score = excluded.score, skill_tags = excluded.skill_tags, telemetry = excluded.telemetry, reported_at = now();
  select count(*) into missing from table_seats s where s.table_id = p_table and s.role = 'player' and not s.is_bot
    and not exists (select 1 from external_scores e where e.table_id = p_table and e.player_id = s.player_id);
  if missing = 0 then perform finalize_external(p_table); return true; end if;
  return false;
end $$;
revoke execute on function submit_external_score(uuid, uuid, numeric, text[], jsonb) from public, anon, authenticated;

-- launching an external table: host starts it (locks seats), settings chosen once per table
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
      'scenarioId', 'classic', 'difficultyId', 'medium', 'weatherSeverityId', 'normal', 'aiCount', 3));
    update tables set status = 'playing', started_at = now(), settings = s where id = p_table;
  end if;
  return s;
end $$;
revoke execute on function start_external(uuid) from public, anon;

update games set launch_url = 'https://venture-flow-olive.vercel.app/', min_players = 1, max_players = 6,
  tagline = 'Same weather, same prices, same 24 months for everyone at the table. Highest net worth wins.'
  where id = 'ventureflow';
