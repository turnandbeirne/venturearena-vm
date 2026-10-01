-- 1) Member feedback: suggestions and problem reports, tied to the member,
--    answered by the arena (admin SQL for now), surfaced back in their Inbox.
create table if not exists feedback (
  id bigint generated always as identity primary key,
  user_id uuid references profiles on delete cascade,
  kind text not null check (kind in ('general','suggestion','problem')),
  scope text not null default 'arena',          -- arena | connect4 | ventureflow | ventureboom | matching | membership | other
  body text not null check (length(body) between 3 and 4000),
  page text,                                    -- where they were when they sent it
  status text not null default 'new',           -- new | seen | planned | done | declined
  response text,                                -- what we did with it, shown back to the member
  responded_at timestamptz,
  created_at timestamptz default now()
);
alter table feedback enable row level security;
drop policy if exists "feedback own select" on feedback;
create policy "feedback own select" on feedback for select using (user_id = auth.uid());
drop policy if exists "feedback own insert" on feedback;
create policy "feedback own insert" on feedback for insert with check (user_id = auth.uid());
do $$ begin alter publication supabase_realtime add table feedback; exception when duplicate_object then null; end $$;

create or replace function send_feedback(p_kind text, p_scope text, p_body text, p_page text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare fid bigint;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into feedback (user_id, kind, scope, body, page) values (auth.uid(), p_kind, coalesce(p_scope,'arena'), p_body, p_page) returning id into fid;
  -- a thank-you lands in their inbox right away
  insert into messages (to_id, from_id, body) values (auth.uid(), '00000000-0000-0000-0000-00000000b0b0',
    'Thanks for the ' || case p_kind when 'problem' then 'problem report' when 'suggestion' then 'suggestion' else 'feedback' end ||
    ' about ' || coalesce(p_scope,'the arena') || '. We read every one; you will hear back here once it has been acted on.');
  return fid;
end $$;
revoke execute on function send_feedback(text, text, text, text) from public, anon;

-- Arena staff close the loop (service role / SQL editor): status + a note the member sees.
create or replace function respond_feedback(p_id bigint, p_status text, p_response text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid; k text;
begin
  select user_id, kind into uid, k from feedback where id = p_id;
  if uid is null then raise exception 'no such feedback'; end if;
  update feedback set status = p_status, response = p_response, responded_at = now() where id = p_id;
  insert into messages (to_id, from_id, body) values (uid, '00000000-0000-0000-0000-00000000b0b0',
    'Your ' || k || ' #' || p_id || ' — ' || p_status || ': ' || p_response || ' Thank you for helping the arena get better for every entrepreneur learning with VentureMaker.');
end $$;
revoke execute on function respond_feedback(bigint, text, text) from public, anon, authenticated;

-- 2) Close my tables without rejoining each one. p_stale_only: only tables
--    older than 2 hours. Open tables are cancelled; playing tables where I am
--    the host are abandoned (robots finish nothing; the table ends).
create or replace function close_my_tables(p_stale_only boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int := 0; t record;
begin
  if me is null then raise exception 'not signed in'; end if;
  for t in select tb.id, tb.status, tb.host_id from tables tb
           join table_seats s on s.table_id = tb.id and s.player_id = me
           where tb.status in ('open','playing') and (not p_stale_only or tb.created_at < now() - interval '2 hours') loop
    if t.host_id = me then
      update tables set status = 'abandoned', ended_at = now() where id = t.id;
    else
      delete from table_seats where table_id = t.id and player_id = me;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function close_my_tables(boolean) from public, anon;

-- 3) Mixer: one person worth meeting right now, with the reason, drawn from
--    the recommender when it has something and from recent active players
--    otherwise. Never the same person twice in a row for the same member.
create table if not exists mixer_seen (
  player_id uuid references profiles on delete cascade,
  suggested_id uuid references profiles on delete cascade,
  seen_at timestamptz default now(),
  primary key (player_id, suggested_id)
);
alter table mixer_seen enable row level security;
drop policy if exists "mixer own" on mixer_seen;
create policy "mixer own" on mixer_seen for select using (player_id = auth.uid());

create or replace function mixer_next(p_mode text default 'any') returns table (suggested_id uuid, reason text, match_type text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare me uuid := auth.uid(); sid uuid; why text; mt text;
begin
  if me is null then raise exception 'not signed in'; end if;
  perform generate_recommendations(me);
  -- recommender first (filtered by mode when given), skipping recent mixer picks
  select rc.suggested_id, rc.reason, rc.match_type into sid, why, mt from recommendations rc
    where rc.player_id = me and (p_mode = 'any' or rc.match_type = p_mode)
      and not exists (select 1 from mixer_seen m where m.player_id = me and m.suggested_id = rc.suggested_id and m.seen_at > now() - interval '1 day')
    order by rc.score desc, random() limit 1;
  if sid is null then
    -- random mixer: someone active recently, onboarded, not me, not connected yet
    select p.id, 'Random mixer: ' || coalesce(initcap(p.archetype),'a founder') || case when p.stage is not null then ', ' || replace(p.stage,'_',' ') || ' stage' else '' end, 'playmate'
      into sid, why, mt from profiles p
      where p.id <> me and p.onboarded and p.id <> '00000000-0000-0000-0000-00000000b0b0'
        and not exists (select 1 from connections c where (c.requester_id = me and c.addressee_id = p.id) or (c.requester_id = p.id and c.addressee_id = me))
        and not exists (select 1 from mixer_seen m where m.player_id = me and m.suggested_id = p.id and m.seen_at > now() - interval '1 day')
      order by (select max(recorded_at) from results rs where rs.player_id = p.id) desc nulls last, random() limit 1;
  end if;
  if sid is null then
    -- everyone has been seen today: allow repeats rather than returning nothing
    select p.id, 'Mixer: ' || coalesce(initcap(p.archetype),'a founder'), 'playmate' into sid, why, mt from profiles p
      where p.id <> me and p.onboarded and p.id <> '00000000-0000-0000-0000-00000000b0b0' order by random() limit 1;
  end if;
  if sid is null then return; end if;
  insert into mixer_seen (player_id, suggested_id) values (me, sid) on conflict (player_id, suggested_id) do update set seen_at = now();
  return query select sid, why, mt;
end $$;
revoke execute on function mixer_next(text) from public, anon;

-- 4) How the arena sees a member: a play-style summary from their telemetry,
--    stored on the profile so cards and matching can use it.
create or replace function refresh_play_style(p_player uuid) returns text
language plpgsql security definer set search_path = public as $$
declare n int; biz numeric; passive numeric; units numeric; wins int; gp int; style text;
begin
  select count(*), avg((metrics->>'businesses')::numeric), avg((metrics->>'passive')::numeric), avg((metrics->>'units')::numeric)
    into n, biz, passive, units from telemetry where player_id = p_player and game_id = 'ventureflow';
  select coalesce(sum(r.wins),0), coalesce(sum(r.games_played),0) into wins, gp from ratings r where r.player_id = p_player;
  if n = 0 then return null; end if;
  style := case
    when biz >= 2 then 'Builder: starts businesses early and often'
    when passive >= 150 then 'Cashflow-minded: stacks passive income'
    when units >= 30 then 'Accumulator: buys in volume and rides the market'
    else 'Balanced: mixes cash, assets and businesses' end;
  if gp >= 3 and wins::numeric / gp >= 0.5 then style := style || ' · wins more than half their games'; end if;
  update profiles set playing_style = style where id = p_player;
  return style;
end $$;
revoke execute on function refresh_play_style(uuid) from public, anon;

-- telemetry rows for a table are visible to everyone who was at that table (debrief observations)
drop policy if exists "telemetry own" on telemetry;
drop policy if exists "telemetry at my table" on telemetry;
create policy "telemetry at my table" on telemetry for select using (player_id = auth.uid() or is_seated(table_id));

-- keep the play-style summary fresh after every reported game
create or replace function telemetry_refresh_style() returns trigger language plpgsql security definer set search_path = public as $$
begin perform refresh_play_style(new.player_id); return new; end $$;
drop trigger if exists telemetry_refresh_style on telemetry;
create trigger telemetry_refresh_style after insert on telemetry for each row execute function telemetry_refresh_style();

-- player cards carry the play-style summary (Members, or your own card)
create or replace view player_cards with (security_invoker = true) as
select p.id, p.username, p.display_name, p.avatar_url, p.archetype, p.stage, p.intent, p.interests, p.tier, p.bio, p.prompts,
       p.open_to_mentoring, (p.investor_profile is not null) as is_investor, p.is_anonymous, p.onboarded, p.created_at,
       coalesce(r.score,100) as reputation, coalesce(r.kudos,0) as kudos,
       coalesce((select sum(games_played) from ratings x where x.player_id = p.id),0) as games_played,
       coalesce((select round(avg(rating)) from ratings x where x.player_id = p.id),1200) as rating,
       (select coalesce(jsonb_object_agg(chip, n), '{}'::jsonb) from (select chip, count(*) n from peer_feedback f where f.to_id = p.id group by chip) c) as chips,
       case when tier_allows('view_style') or p.id = auth.uid() then p.dna else '{}'::jsonb end as dna,
       case when tier_allows('view_style') or p.id = auth.uid() then p.playing_style else null end as playing_style
from profiles p left join reputation r on r.player_id = p.id
where p.username <> 'robo_trader';
