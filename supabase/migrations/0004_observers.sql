-- Up to 7 people at any table: players fill the game's seats, everyone else observes.
alter table table_seats add column role text not null default 'player' check (role in ('player','observer'));
create index if not exists table_seats_role_idx on table_seats (table_id, role);

create or replace function table_capacity() returns int language sql immutable as $$ select 7 $$;

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
  -- can only take a player seat while the table is open and a seat is free; otherwise observe
  if v_role = 'player' and (st <> 'open' or players >= mx) then v_role := 'observer'; end if;
  if st not in ('open','playing') then raise exception 'table already ended'; end if;
  if v_role = 'player' then
    select coalesce(max(seat),-1)+1 into nxt from table_seats where table_id = p_table and role = 'player';
  else
    nxt := 100 + total;   -- observers sit above 100 so they never collide with player seats
  end if;
  insert into table_seats (table_id, player_id, seat, role) values (p_table, me, nxt, v_role);
  return p_table;
end $$;
drop function if exists join_table(uuid);

create or replace function join_by_code(p_code text, p_role text default 'player') returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select id into t from tables where invite_code = p_code;
  if t is null then raise exception 'invalid invite'; end if;
  return join_table(t, p_role);
end $$;
drop function if exists join_by_code(text);

-- switch between playing and watching while the table is still open
create or replace function set_role(p_table uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); st text; mx int; players int; nxt int; cur text; host uuid;
begin
  if p_role not in ('player','observer') then raise exception 'bad role'; end if;
  select t.status, g.max_players, t.host_id into st, mx, host from tables t join games g on g.id = t.game_id where t.id = p_table;
  select role into cur from table_seats where table_id = p_table and player_id = me;
  if cur is null then raise exception 'not at this table'; end if;
  if cur = p_role then return; end if;
  if st <> 'open' then raise exception 'roles are locked once the game starts'; end if;
  if p_role = 'player' then
    select count(*) into players from table_seats where table_id = p_table and role = 'player';
    if players >= mx then raise exception 'all player seats are taken'; end if;
    select coalesce(max(seat),-1)+1 into nxt from table_seats where table_id = p_table and role = 'player';
    update table_seats set role = 'player', seat = nxt where table_id = p_table and player_id = me;
  else
    if host = me then raise exception 'the host plays; hand off hosting first by leaving the table'; end if;
    update table_seats set role = 'observer', seat = 100 + (select count(*) from table_seats where table_id = p_table) where table_id = p_table and player_id = me;
    -- close the gap in player seats
    with ranked as (select player_id, row_number() over (order by seat) - 1 as s from table_seats where table_id = p_table and role = 'player')
    update table_seats ts set seat = ranked.s from ranked where ts.table_id = p_table and ts.player_id = ranked.player_id;
  end if;
end $$;

create or replace function add_bot(p_table uuid) returns void
language plpgsql security definer set search_path = public as $$
declare bot uuid; nxt int; mx int; players int;
begin
  if not is_seated(p_table) then raise exception 'not at this table'; end if;
  select id into bot from profiles where username = 'robo_trader';
  select g.max_players into mx from tables t join games g on g.id=t.game_id where t.id=p_table;
  select count(*) into players from table_seats where table_id = p_table and role = 'player';
  if players >= mx then raise exception 'all player seats are taken'; end if;
  select coalesce(max(seat),-1)+1 into nxt from table_seats where table_id = p_table and role = 'player';
  insert into table_seats (table_id, player_id, seat, is_bot, role) values (p_table, bot, nxt, true, 'player') on conflict do nothing;
end $$;

create or replace function quick_match(p_game text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid; me uuid := auth.uid(); my_rating int; mx int;
begin
  if me is null then raise exception 'not signed in'; end if;
  select coalesce(rating,1200) into my_rating from ratings where player_id = me and game_id = p_game;
  my_rating := coalesce(my_rating, 1200);
  select max_players into mx from games where id = p_game;
  select t2.id into t from tables t2
   where t2.game_id = p_game and t2.status = 'open' and t2.visibility = 'public'
     and not exists (select 1 from table_seats s where s.table_id = t2.id and s.player_id = me)
     and (select count(*) from table_seats s where s.table_id = t2.id and s.role = 'player') < mx
     and abs(coalesce((select avg(r.rating) from table_seats s join ratings r on r.player_id = s.player_id and r.game_id = p_game where s.table_id = t2.id and s.role='player'), 1200) - my_rating) <= 400
   order by t2.created_at limit 1 for update skip locked;
  if t is null then
    insert into tables (game_id, host_id) values (p_game, me) returning id into t;
    insert into table_seats (table_id, player_id, seat) values (t, me, 0);
  else
    perform join_table(t, 'player');
  end if;
  return t;
end $$;

create or replace function start_table(p_table uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n int; g text; host uuid;
begin
  select host_id, game_id into host, g from tables where id = p_table;
  if host <> auth.uid() then raise exception 'only the host can start'; end if;
  select count(*) into n from table_seats where table_id = p_table and role = 'player';
  if n < 2 then raise exception 'need at least 2 players (observers do not count)'; end if;
  update tables set status = 'playing', started_at = now(),
    state = case when g = 'connect4' then jsonb_build_object('board', (select jsonb_agg(jsonb_build_array(0,0,0,0,0,0,0)) from generate_series(1,6)), 'turn', 0, 'winner', null, 'moves', 0)
                 else state end
  where id = p_table;
end $$;

create or replace function make_move(p_table uuid, p_col int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st jsonb; turn int; my_seat int; my_role text; mover uuid; board jsonb; r int; placed boolean := false; w int; moves int; is_bot_turn boolean;
begin
  select state into st from tables where id = p_table and status = 'playing' for update;
  if st is null then raise exception 'game not in progress'; end if;
  turn := (st->>'turn')::int;
  select player_id, is_bot into mover, is_bot_turn from table_seats where table_id = p_table and seat = turn and role = 'player';
  select seat, role into my_seat, my_role from table_seats where table_id = p_table and player_id = auth.uid();
  if my_seat is null then raise exception 'not at this table'; end if;
  if my_role = 'observer' and not is_bot_turn then raise exception 'observers cannot move'; end if;
  if mover <> auth.uid() and not is_bot_turn then raise exception 'not your turn'; end if;
  if p_col < 0 or p_col > 6 then raise exception 'bad column'; end if;
  board := st->'board';
  for r in reverse 5..0 loop
    if (board->r->>p_col)::int = 0 then
      board := jsonb_set(board, array[r::text, p_col::text], to_jsonb(turn + 1));
      placed := true; exit;
    end if;
  end loop;
  if not placed then raise exception 'column full'; end if;
  moves := (st->>'moves')::int + 1;
  w := c4_winner(board);
  st := jsonb_build_object('board', board, 'turn', (turn + 1) % 2, 'moves', moves,
                           'winner', case when w > 0 then to_jsonb(w - 1) when moves >= 42 then to_jsonb(-1) else 'null'::jsonb end,
                           'last_col', p_col);
  update tables set state = st where id = p_table;
  if w > 0 or moves >= 42 then
    perform finish_builtin(p_table, case when w > 0 then w - 1 else null end);
  end if;
  return st;
end $$;

create or replace function finish_builtin(p_table uuid, p_winner_seat int) returns void
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  select jsonb_agg(jsonb_build_object('player_id', player_id, 'placement',
           case when p_winner_seat is null then 1 when seat = p_winner_seat then 1 else 2 end))
    into res from table_seats where table_id = p_table and role = 'player';
  perform record_result(p_table, res);
end $$;

create or replace function abandon_table(p_table uuid) returns void
language plpgsql security definer set search_path = public as $$
declare st text; my_role text;
begin
  select status into st from tables where id = p_table;
  select role into my_role from table_seats where table_id = p_table and player_id = auth.uid();
  if my_role is null then raise exception 'not at this table'; end if;
  if my_role = 'observer' then
    delete from table_seats where table_id = p_table and player_id = auth.uid();
    return;
  end if;
  if st = 'playing' then
    update reputation set score = greatest(score - 10, 0), abandons = abandons + 1 where player_id = auth.uid();
    update tables set status = 'abandoned', ended_at = now() where id = p_table;
  elsif st = 'open' then
    delete from table_seats where table_id = p_table and player_id = auth.uid();
    if not exists (select 1 from table_seats where table_id = p_table and not is_bot and role = 'player') then
      delete from tables where id = p_table;
    end if;
  end if;
end $$;

revoke execute on function join_table(uuid, text), join_by_code(text, text), set_role(uuid, text), finish_builtin(uuid, int) from public, anon;
revoke execute on function finish_builtin(uuid, int) from authenticated;
