-- ---------- table lifecycle ----------

create or replace function join_table(p_table uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int; mx int; st text; nxt int;
begin
  if me is null then raise exception 'not signed in'; end if;
  select t.status, g.max_players into st, mx from tables t join games g on g.id = t.game_id where t.id = p_table;
  if st is null then raise exception 'no such table'; end if;
  if exists (select 1 from table_seats where table_id = p_table and player_id = me) then return p_table; end if;
  if st <> 'open' then raise exception 'table already started'; end if;
  select count(*) into n from table_seats where table_id = p_table;
  if n >= mx then raise exception 'table is full'; end if;
  select coalesce(max(seat),-1)+1 into nxt from table_seats where table_id = p_table;
  insert into table_seats (table_id, player_id, seat) values (p_table, me, nxt);
  return p_table;
end $$;

create or replace function join_by_code(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select id into t from tables where invite_code = p_code;
  if t is null then raise exception 'invalid invite'; end if;
  return join_table(t);
end $$;

create or replace function create_table(p_game text, p_visibility text default 'public', p_mode text default 'realtime') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t uuid; open_count int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if not tier_allows('create_table') then raise exception 'Create an account to host a table'; end if;
  if p_visibility <> 'public' and not tier_allows('private_table') then raise exception 'Private tables are a Member feature'; end if;
  select count(*) into open_count from tables where host_id = me and status = 'open';
  if my_tier() = 'free' and open_count >= 1 then raise exception 'Free accounts can host one open table at a time'; end if;
  insert into tables (game_id, host_id, visibility, mode) values (p_game, me, p_visibility, p_mode) returning id into t;
  insert into table_seats (table_id, player_id, seat) values (t, me, 0);
  return t;
end $$;

-- bot player: a fixed profile row created by seed
create or replace function add_bot(p_table uuid) returns void
language plpgsql security definer set search_path = public as $$
declare bot uuid; nxt int; mx int; n int;
begin
  if not is_seated(p_table) then raise exception 'not at this table'; end if;
  select id into bot from profiles where username = 'robo_trader';
  select g.max_players into mx from tables t join games g on g.id=t.game_id where t.id=p_table;
  select count(*) into n from table_seats where table_id = p_table;
  if n >= mx then raise exception 'table is full'; end if;
  select coalesce(max(seat),-1)+1 into nxt from table_seats where table_id = p_table;
  insert into table_seats (table_id, player_id, seat, is_bot) values (p_table, bot, nxt, true) on conflict do nothing;
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
     and (select count(*) from table_seats s where s.table_id = t2.id) < mx
     and abs(coalesce((select avg(r.rating) from table_seats s join ratings r on r.player_id = s.player_id and r.game_id = p_game where s.table_id = t2.id), 1200) - my_rating) <= 400
   order by t2.created_at limit 1 for update skip locked;
  if t is null then
    insert into tables (game_id, host_id) values (p_game, me) returning id into t;
    insert into table_seats (table_id, player_id, seat) values (t, me, 0);
  else
    perform join_table(t);
  end if;
  return t;
end $$;

-- ---------- Connect 4 (built-in) ----------
create or replace function start_table(p_table uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n int; g text; host uuid;
begin
  select host_id, game_id into host, g from tables where id = p_table;
  if host <> auth.uid() then raise exception 'only the host can start'; end if;
  select count(*) into n from table_seats where table_id = p_table;
  if n < 2 then raise exception 'need at least 2 players'; end if;
  update tables set status = 'playing', started_at = now(),
    state = case when g = 'connect4' then jsonb_build_object('board', (select jsonb_agg(jsonb_build_array(0,0,0,0,0,0,0)) from generate_series(1,6)), 'turn', 0, 'winner', null, 'moves', 0)
                 else state end
  where id = p_table;
end $$;

create or replace function c4_winner(board jsonb) returns int language plpgsql immutable as $$
declare r int; c int; p int;
begin
  for r in 0..5 loop for c in 0..6 loop
    p := (board->r->>c)::int;
    if p = 0 then continue; end if;
    if c <= 3 and (board->r->>(c+1))::int = p and (board->r->>(c+2))::int = p and (board->r->>(c+3))::int = p then return p; end if;
    if r <= 2 and (board->(r+1)->>c)::int = p and (board->(r+2)->>c)::int = p and (board->(r+3)->>c)::int = p then return p; end if;
    if r <= 2 and c <= 3 and (board->(r+1)->>(c+1))::int = p and (board->(r+2)->>(c+2))::int = p and (board->(r+3)->>(c+3))::int = p then return p; end if;
    if r >= 3 and c <= 3 and (board->(r-1)->>(c+1))::int = p and (board->(r-2)->>(c+2))::int = p and (board->(r-3)->>(c+3))::int = p then return p; end if;
  end loop; end loop;
  return 0;
end $$;

create or replace function make_move(p_table uuid, p_col int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st jsonb; turn int; my_seat int; mover uuid; board jsonb; r int; placed boolean := false; w int; moves int; is_bot_turn boolean;
begin
  select state into st from tables where id = p_table and status = 'playing' for update;
  if st is null then raise exception 'game not in progress'; end if;
  turn := (st->>'turn')::int;
  select player_id, is_bot into mover, is_bot_turn from table_seats where table_id = p_table and seat = turn;
  select seat into my_seat from table_seats where table_id = p_table and player_id = auth.uid();
  if my_seat is null then raise exception 'not at this table'; end if;
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

-- ---------- results, ratings, reputation ----------
create or replace function record_result(p_table uuid, p_results jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare g text; rec jsonb; pid uuid; place int; n int; me_r int; opp_r int; expected numeric; actual numeric; delta numeric; k int; gp int; opp jsonb; tags text[];
begin
  select game_id into g from tables where id = p_table;
  n := jsonb_array_length(p_results);
  -- ensure rating rows
  for rec in select * from jsonb_array_elements(p_results) loop
    insert into ratings (player_id, game_id) values ((rec->>'player_id')::uuid, g) on conflict do nothing;
  end loop;
  for rec in select * from jsonb_array_elements(p_results) loop
    pid := (rec->>'player_id')::uuid; place := (rec->>'placement')::int;
    select rating, games_played into me_r, gp from ratings where player_id = pid and game_id = g;
    k := case when gp < 10 then 40 else 20 end;
    delta := 0;
    for opp in select * from jsonb_array_elements(p_results) loop
      if (opp->>'player_id')::uuid = pid then continue; end if;
      select rating into opp_r from ratings where player_id = (opp->>'player_id')::uuid and game_id = g;
      expected := 1 / (1 + power(10, (opp_r - me_r) / 400.0));
      actual := case when place < (opp->>'placement')::int then 1 when place = (opp->>'placement')::int then 0.5 else 0 end;
      delta := delta + k * (actual - expected);
    end loop;
    delta := round(delta / greatest(n - 1, 1));
    tags := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(rec->'skill_tags','[]'::jsonb)) x), '{}');
    insert into results (table_id, player_id, game_id, placement, score, rating_before, rating_after, skill_tags)
      values (p_table, pid, g, place, (rec->>'score')::numeric, me_r, me_r + delta::int, tags);
    update ratings set rating = rating + delta::int, games_played = games_played + 1, wins = wins + case when place = 1 then 1 else 0 end
      where player_id = pid and game_id = g;
    update reputation set score = score + 2 where player_id = pid;
    if rec ? 'telemetry' then
      insert into telemetry (table_id, player_id, game_id, metrics) values (p_table, pid, g, rec->'telemetry');
    end if;
  end loop;
  update tables set status = 'finished', ended_at = now() where id = p_table;
end $$;

create or replace function finish_builtin(p_table uuid, p_winner_seat int) returns void
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  select jsonb_agg(jsonb_build_object('player_id', player_id, 'placement',
           case when p_winner_seat is null then 1 when seat = p_winner_seat then 1 else 2 end))
    into res from table_seats where table_id = p_table;
  perform record_result(p_table, res);
end $$;

create or replace function abandon_table(p_table uuid) returns void
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select status into st from tables where id = p_table;
  if not is_seated(p_table) then raise exception 'not at this table'; end if;
  if st = 'playing' then
    update reputation set score = greatest(score - 10, 0), abandons = abandons + 1 where player_id = auth.uid();
    update tables set status = 'abandoned', ended_at = now() where id = p_table;
  elsif st = 'open' then
    delete from table_seats where table_id = p_table and player_id = auth.uid();
    if not exists (select 1 from table_seats where table_id = p_table and not is_bot) then
      delete from tables where id = p_table;
    end if;
  end if;
end $$;

-- kudos & chips (from_id = giver)
create or replace function give_feedback(p_table uuid, p_to uuid, p_chip text, p_kudos boolean) returns void
language plpgsql security definer set search_path = public as $$
declare had boolean;
begin
  if not is_seated(p_table) then raise exception 'not at this table'; end if;
  select kudos into had from peer_feedback where table_id = p_table and from_id = auth.uid() and to_id = p_to;
  insert into peer_feedback (table_id, from_id, to_id, chip, kudos) values (p_table, auth.uid(), p_to, p_chip, p_kudos)
    on conflict (table_id, from_id, to_id) do update set chip = excluded.chip, kudos = excluded.kudos;
  if p_kudos and not coalesce(had,false) then update reputation set score = score + 3, kudos = kudos + 1 where player_id = p_to; end if;
end $$;

create or replace function answer_debrief(p_table uuid, p_question text, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_seated(p_table) then raise exception 'not at this table'; end if;
  insert into debriefs (table_id, player_id, question, answer) values (p_table, auth.uid(), p_question, p_answer)
    on conflict (table_id, player_id) do update set answer = excluded.answer;
  update reputation set debriefs = debriefs + 1 where player_id = auth.uid();
end $$;

-- ---------- Player DNA & matching ----------
create or replace function complete_onboarding(p_archetype text, p_risk int, p_pace int, p_collab text, p_stage text, p_intent text[], p_interests text[], p_prompts jsonb, p_username text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set archetype = p_archetype, dna = jsonb_build_object('risk', p_risk, 'pace', p_pace, 'collab', p_collab, 'sophistication',
        case p_stage when 'idea' then 1 when 'pre_revenue' then 2 when 'revenue' then 3 when 'scaling' then 4 when 'exited' then 5 else 1 end),
      stage = p_stage, intent = p_intent, interests = p_interests, prompts = p_prompts, onboarded = true,
      username = coalesce(nullif(p_username,''), username)
    where id = auth.uid();
end $$;

-- upgrade a guest to a real account keeps id; just flip the flag
create or replace function mark_registered() returns void language sql security definer set search_path = public as $$
  update profiles set is_anonymous = false where id = auth.uid();
$$;

create or replace view player_cards as
select p.id, p.username, p.display_name, p.avatar_url, p.archetype, p.stage, p.intent, p.interests, p.tier, p.bio, p.prompts,
       p.open_to_mentoring, (p.investor_profile is not null) as is_investor, p.is_anonymous, p.onboarded, p.created_at,
       coalesce(r.score,100) as reputation, coalesce(r.kudos,0) as kudos,
       coalesce((select sum(games_played) from ratings x where x.player_id = p.id),0) as games_played,
       coalesce((select round(avg(rating)) from ratings x where x.player_id = p.id),1200) as rating,
       (select coalesce(jsonb_object_agg(chip, n), '{}'::jsonb) from (select chip, count(*) n from peer_feedback f where f.to_id = p.id group by chip) c) as chips,
       case when tier_allows('view_style') or p.id = auth.uid() then p.dna else '{}'::jsonb end as dna
from profiles p left join reputation r on r.player_id = p.id
where p.username <> 'robo_trader';

-- archetype complement matrix
create or replace function archetype_fit(a text, b text) returns numeric language sql immutable as $$
  select case
    when a is null or b is null then 0.4
    when (a,b) in (('builder','trader'),('trader','builder'),('builder','backer'),('backer','builder'),
                   ('operator','builder'),('builder','operator'),('operator','analyst'),('analyst','operator'),
                   ('analyst','trader'),('trader','analyst'),('backer','operator'),('operator','backer')) then 1.0
    when a = b then 0.5
    else 0.7 end;
$$;

create or replace function stage_num(s text) returns int language sql immutable as $$
  select case s when 'idea' then 1 when 'pre_revenue' then 2 when 'revenue' then 3 when 'scaling' then 4 when 'exited' then 5 else 1 end;
$$;

create or replace function generate_recommendations(p_player uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare me record; cand record; cnt int := 0; sc numeric; why text; mt text;
begin
  for me in select * from profiles where onboarded and (p_player is null or id = p_player) loop
    delete from recommendations where player_id = me.id;
    for cand in select p.*, coalesce(r.score,100) rep from profiles p left join reputation r on r.player_id = p.id
                 where p.id <> me.id and p.onboarded and p.username <> 'robo_trader' loop
      -- playmate
      sc := 0.35 * archetype_fit(me.archetype, cand.archetype)
          + 0.30 * (1 - least(abs(stage_num(me.stage) - stage_num(cand.stage)),4) / 4.0)
          + 0.35 * (coalesce(cardinality(array(select unnest(me.interests) intersect select unnest(cand.interests))),0)::numeric / greatest(cardinality(me.interests),1));
      why := format('%s, %s stage; %s',
                    initcap(coalesce(cand.archetype,'player')), replace(coalesce(cand.stage,'idea'),'_',' '),
                    case when archetype_fit(me.archetype, cand.archetype) = 1 then 'a style that complements yours' else 'plays at your level' end);
      insert into recommendations (player_id, suggested_id, match_type, reason, score) values (me.id, cand.id, 'playmate', why, sc);
      cnt := cnt + 1;
      -- mentor
      if cand.open_to_mentoring > 0 and stage_num(cand.stage) - stage_num(me.stage) >= 2 and 'mentor' = any(me.intent) then
        sc := 0.4 + 0.3 * (case when cand.archetype = me.archetype then 1 else 0.5 end) + 0.3 * least(cand.rep,200)/200.0;
        insert into recommendations (player_id, suggested_id, match_type, reason, score)
          values (me.id, cand.id, 'mentor', format('%s two stages ahead of you, open to mentoring', initcap(cand.archetype)), sc);
      end if;
      -- peer
      if stage_num(cand.stage) = stage_num(me.stage) and 'peers' = any(me.intent) then
        insert into recommendations (player_id, suggested_id, match_type, reason, score)
          values (me.id, cand.id, 'peer', format('Same stage as you (%s), %s', replace(me.stage,'_',' '), initcap(cand.archetype)), 0.5 + 0.5 * archetype_fit(me.archetype,cand.archetype));
      end if;
      -- cofounder
      if 'cofounder' = any(me.intent) and 'cofounder' = any(cand.intent) and archetype_fit(me.archetype,cand.archetype) = 1
         and abs(coalesce((me.dna->>'risk')::int,3) - coalesce((cand.dna->>'risk')::int,3)) <= 1 then
        insert into recommendations (player_id, suggested_id, match_type, reason, score)
          values (me.id, cand.id, 'cofounder', format('%s to your %s, also looking for a cofounder, similar risk appetite', initcap(cand.archetype), initcap(me.archetype)), 0.9);
      end if;
      -- investor (investor sees founder; founder sees only after acceptance)
      if cand.investor_profile is not null and 'investor' = any(me.intent) and stage_num(me.stage) >= 3 then
        insert into recommendations (player_id, suggested_id, match_type, reason, score)
          values (cand.id, me.id, 'investor', format('%s-stage %s founder looking for investors', replace(me.stage,'_',' '), initcap(me.archetype)), 0.8)
          on conflict do nothing;
      end if;
    end loop;
  end loop;
  return cnt;
end $$;

-- refresh my recommendations on demand (cheap at MVP scale)
create or replace function my_recommendations() returns setof recommendations
language plpgsql security definer set search_path = public as $$
begin
  perform generate_recommendations(auth.uid());
  return query select * from recommendations where player_id = auth.uid() order by score desc;
end $$;

create or replace function head_to_head(a uuid, b uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'games', count(distinct ra.table_id),
    'a_wins', count(distinct ra.table_id) filter (where ra.placement < rb.placement),
    'b_wins', count(distinct ra.table_id) filter (where rb.placement < ra.placement))
  from results ra join results rb on rb.table_id = ra.table_id and rb.player_id = b
  where ra.player_id = a;
$$;

-- admin helper: set tier by username (until Stripe is wired)
create or replace function admin_set_tier(p_username text, p_tier tier) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select tier from profiles where id = auth.uid()) <> 'ceo' then raise exception 'admin only'; end if;
  update profiles set tier = p_tier, tier_expires_at = null where username = p_username;
end $$;

-- only server-side callers (service role / edge functions) may write results directly
revoke execute on function record_result(uuid, jsonb) from public, anon, authenticated;
revoke execute on function finish_builtin(uuid, int) from public, anon, authenticated;
revoke execute on function generate_recommendations(uuid) from public, anon, authenticated;
revoke execute on function c4_winner(jsonb) from public, anon, authenticated;
