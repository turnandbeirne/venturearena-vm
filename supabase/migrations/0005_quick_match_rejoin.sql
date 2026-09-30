-- Quick match: rejoin your own open table for that game before creating another one
create or replace function quick_match(p_game text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid; me uuid := auth.uid(); my_rating int; mx int;
begin
  if me is null then raise exception 'not signed in'; end if;
  -- already hosting an open table for this game? go back to it
  select id into t from tables where host_id = me and game_id = p_game and status = 'open' order by created_at desc limit 1;
  if t is not null then return t; end if;
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

-- housekeeping: open tables idle for 2 hours and playing tables idle for 24 hours are closed
create or replace function sweep_stale_tables() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with gone as (
    delete from tables where status = 'open' and created_at < now() - interval '2 hours' returning 1)
  select count(*) into n from gone;
  update tables set status = 'abandoned', ended_at = now() where status = 'playing' and coalesce(started_at, created_at) < now() - interval '24 hours';
  return n;
end $$;
revoke execute on function sweep_stale_tables() from public, anon, authenticated;
