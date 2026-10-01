-- 1) Robots never block people. settings->'bots' is the robot line-up used to
--    fill chairs that are still empty when the host starts; a person joining
--    always takes the chair. (0008 reserved chairs, which locked people out.)
create or replace function set_table_settings(p_table uuid, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare host uuid; st text; g text; s jsonb;
begin
  select t.host_id, t.status, t.game_id into host, st, g from tables t where t.id = p_table;
  if host is null then raise exception 'no such table'; end if;
  if host <> auth.uid() then raise exception 'only the host can change the settings'; end if;
  if st <> 'open' then raise exception 'settings are locked once the table starts'; end if;
  if g <> 'ventureflow' then raise exception 'this game has no table settings'; end if;
  s := vf_normalize_settings(p_settings);
  update tables set settings = s where id = p_table;
  return s;
end $$;

create or replace function join_table(p_table uuid, p_role text default 'player') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); players int; total int; mx int; st text; nxt int; v_role text := coalesce(p_role,'player');
begin
  if me is null then raise exception 'not signed in'; end if;
  if v_role not in ('player','observer') then raise exception 'bad role'; end if;
  select t.status, g.max_players into st, mx from tables t join games g on g.id = t.game_id where t.id = p_table;
  if st is null then raise exception 'no such table'; end if;
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

-- 2) How many open tables a host may run at once, by tier.
create or replace function max_open_tables() returns int language sql stable as $$
  select case my_tier() when 'free' then 1 when 'member' then 3 when 'vip' then 10 else 100 end
$$;

create or replace function create_table(p_game text, p_visibility text default 'public', p_mode text default 'realtime') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t uuid; open_count int; lim int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if not tier_allows('create_table') then raise exception 'Create an account to host a table'; end if;
  if p_visibility <> 'public' and not tier_allows('private_table') then raise exception 'Private tables are a Member feature'; end if;
  select count(*) into open_count from tables where host_id = me and status = 'open';
  lim := max_open_tables();
  if open_count >= lim then
    raise exception 'You already have % open table%. % accounts can host % at a time; Members host 3, VIPs 10.',
      open_count, case when open_count = 1 then '' else 's' end, initcap(my_tier()::text), lim;
  end if;
  insert into tables (game_id, host_id, visibility, mode) values (p_game, me, p_visibility, p_mode) returning id into t;
  insert into table_seats (table_id, player_id, seat) values (t, me, 0);
  return t;
end $$;

-- 3) The tables I'm at (hosting or seated), open or playing, for the lobby.
create or replace function my_tables() returns table (id uuid, game_id text, status text, host_id uuid, created_at timestamptz, invite_code text, people int, role text)
language sql stable security definer set search_path = public as $$
  select t.id, t.game_id, t.status, t.host_id, t.created_at, t.invite_code,
         (select count(*)::int from table_seats s2 where s2.table_id = t.id),
         case when t.host_id = auth.uid() then 'host' else s.role end
  from tables t join table_seats s on s.table_id = t.id and s.player_id = auth.uid()
  where t.status in ('open','playing')
  order by t.created_at desc
$$;
revoke execute on function my_tables() from public, anon;
