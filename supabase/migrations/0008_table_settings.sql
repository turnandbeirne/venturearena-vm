-- Host-chosen game settings for VentureFlow tables, visible to everyone at the
-- table while it is open and frozen at start. Robots are chairs in settings
-- (settings->'bots'), not seat rows, so seat accounting stays about people.
--
-- settings = {
--   preset: 'casual' | 'classic' | 'shark' | 'custom',
--   scenarioId, difficultyId, weatherSeverityId, turnTimer: bool,
--   bots: [{ personalityId, skillLevelId }],   -- reserved robot chairs (0..3)
--   fillWithRobots: bool,                        -- empty chairs at start get random robots
--   seed: int                                    -- set at start
-- }

create or replace function vf_default_settings() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'preset', 'classic', 'scenarioId', 'classic', 'difficultyId', 'medium', 'weatherSeverityId', 'normal',
    'turnTimer', true, 'bots', '[]'::jsonb, 'fillWithRobots', true)
$$;

-- Validate and normalize a settings object; raises on bad values.
create or replace function vf_normalize_settings(p jsonb) returns jsonb
language plpgsql immutable as $$
declare out jsonb := vf_default_settings(); b jsonb; bots jsonb := '[]'::jsonb; pid text; sid text;
begin
  p := coalesce(p, '{}'::jsonb);
  if p ? 'preset' then
    if p->>'preset' not in ('casual','classic','shark','custom') then raise exception 'bad preset'; end if;
    out := out || jsonb_build_object('preset', p->>'preset');
  end if;
  if p ? 'scenarioId' then
    if p->>'scenarioId' not in ('classic','passiveIncomeRace','survivalCrash','businessSprint') then raise exception 'bad scenario'; end if;
    out := out || jsonb_build_object('scenarioId', p->>'scenarioId');
  end if;
  if p ? 'difficultyId' then
    if p->>'difficultyId' not in ('easy','medium','hard') then raise exception 'bad difficulty'; end if;
    out := out || jsonb_build_object('difficultyId', p->>'difficultyId');
  end if;
  if p ? 'weatherSeverityId' then
    if p->>'weatherSeverityId' not in ('gentle','normal','rough','severe') then raise exception 'bad weather'; end if;
    out := out || jsonb_build_object('weatherSeverityId', p->>'weatherSeverityId');
  end if;
  if p ? 'turnTimer' then out := out || jsonb_build_object('turnTimer', coalesce((p->>'turnTimer')::boolean, true)); end if;
  if p ? 'fillWithRobots' then out := out || jsonb_build_object('fillWithRobots', coalesce((p->>'fillWithRobots')::boolean, true)); end if;
  if p ? 'bots' then
    if jsonb_typeof(p->'bots') <> 'array' then raise exception 'bots must be a list'; end if;
    if jsonb_array_length(p->'bots') > 3 then raise exception 'at most 3 robots'; end if;
    for b in select * from jsonb_array_elements(p->'bots') loop
      pid := coalesce(b->>'personalityId', 'random'); sid := coalesce(b->>'skillLevelId', 'random');
      if pid not in ('random','leeroy','bossemby','mrb','mrgrinch','daddybigbux','moneymama','grumpymommy') then raise exception 'bad robot personality %', pid; end if;
      if sid not in ('random','rookie','sharp','shark') then raise exception 'bad robot skill %', sid; end if;
      bots := bots || jsonb_build_object('personalityId', pid, 'skillLevelId', sid);
    end loop;
    out := out || jsonb_build_object('bots', bots);
  end if;
  return out;
end $$;

-- Host edits the settings while the table is open. Everyone at the table sees
-- the change through the tables realtime feed.
create or replace function set_table_settings(p_table uuid, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare host uuid; st text; g text; mx int; humans int; s jsonb;
begin
  select t.host_id, t.status, t.game_id, g.max_players into host, st, g, mx from tables t join games g on g.id = t.game_id where t.id = p_table;
  if host is null then raise exception 'no such table'; end if;
  if host <> auth.uid() then raise exception 'only the host can change the settings'; end if;
  if st <> 'open' then raise exception 'settings are locked once the table starts'; end if;
  if g <> 'ventureflow' then raise exception 'this game has no table settings'; end if;
  s := vf_normalize_settings(p_settings);
  select count(*) into humans from table_seats where table_id = p_table and role = 'player' and not is_bot;
  if humans + jsonb_array_length(s->'bots') > mx then
    raise exception 'only % chairs: % people are already seated', mx, humans;
  end if;
  update tables set settings = s where id = p_table;
  return s;
end $$;
revoke execute on function set_table_settings(uuid, jsonb) from public, anon;

-- Chairs a person can still take = max_players minus reserved robot chairs.
create or replace function join_table(p_table uuid, p_role text default 'player') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); players int; total int; mx int; st text; nxt int; v_role text := coalesce(p_role,'player'); s jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  if v_role not in ('player','observer') then raise exception 'bad role'; end if;
  select t.status, g.max_players, t.settings into st, mx, s from tables t join games g on g.id = t.game_id where t.id = p_table;
  if st is null then raise exception 'no such table'; end if;
  if s is not null and jsonb_typeof(s->'bots') = 'array' then mx := mx - jsonb_array_length(s->'bots'); end if;
  if exists (select 1 from table_seats where table_id = p_table and player_id = me) then return p_table; end if;
  select count(*) into total from table_seats where table_id = p_table;
  if total >= table_capacity() then raise exception 'table is full (7 people max)'; end if;
  select count(*) into players from table_seats where table_id = p_table and role = 'player';
  if v_role = 'player' and (st <> 'open' or players >= mx) then v_role := 'observer'; end if;
  if st not in ('open','playing') then raise exception 'table already ended'; end if;
  if v_role = 'player' then
    select coalesce(max(seat),-1)+1 into nxt from table_seats where table_id = p_table and role = 'player';
  else
    nxt := 100 + total;
  end if;
  insert into table_seats (table_id, player_id, seat, role) values (p_table, me, nxt, v_role);
  return p_table;
end $$;

-- Starting freezes the settings: the seed is fixed, reserved robots are kept,
-- and (when fillWithRobots) empty chairs get random robots.
create or replace function start_external(p_table uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare host uuid; st text; g text; mx int; n int; s jsonb; bots jsonb; i int;
begin
  select t.host_id, t.status, t.game_id, t.settings, gm.max_players into host, st, g, s, mx from tables t join games gm on gm.id = t.game_id where t.id = p_table;
  if host <> auth.uid() then raise exception 'only the host can start'; end if;
  select count(*) into n from table_seats where table_id = p_table and role = 'player' and not is_bot;
  if n < 1 then raise exception 'need at least one player'; end if;
  if st = 'open' then
    s := vf_normalize_settings(s);
    bots := s->'bots';
    -- never more robots than empty chairs
    while jsonb_array_length(bots) > mx - n loop bots := bots - (jsonb_array_length(bots) - 1); end loop;
    if coalesce((s->>'fillWithRobots')::boolean, true) then
      i := jsonb_array_length(bots);
      while n + i < mx loop bots := bots || jsonb_build_object('personalityId','random','skillLevelId','random'); i := i + 1; end loop;
    end if;
    s := s || jsonb_build_object('bots', bots, 'aiCount', jsonb_array_length(bots), 'seed', abs(hashtext(p_table::text)));
    update tables set status = 'playing', started_at = now(), settings = s where id = p_table;
  end if;
  return s;
end $$;

-- New VentureFlow tables start from the defaults so the room shows them right away.
create or replace function vf_settings_default_trigger() returns trigger language plpgsql as $$
begin
  if new.game_id = 'ventureflow' and new.settings is null then new.settings := vf_default_settings(); end if;
  return new;
end $$;
drop trigger if exists tables_vf_settings_default on tables;
create trigger tables_vf_settings_default before insert on tables for each row execute function vf_settings_default_trigger();
update tables set settings = vf_default_settings() where game_id = 'ventureflow' and status = 'open' and settings is null;
