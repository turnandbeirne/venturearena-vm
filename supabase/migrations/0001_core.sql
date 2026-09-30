-- VentureArena core schema
create extension if not exists pgcrypto;

create type tier as enum ('anonymous','free','member','vip','ceo');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null,
  display_name text,
  avatar_url text,
  bio text,
  interests text[] default '{}',
  playing_style text,
  sophistication int default 1,
  tier tier not null default 'free',
  tier_expires_at timestamptz,
  stripe_customer_id text,
  is_anonymous boolean default false,
  -- Player DNA
  archetype text,                       -- builder | trader | operator | backer | analyst
  dna jsonb default '{}'::jsonb,        -- {risk, pace, collab, sophistication}
  stage text,                           -- idea | pre_revenue | revenue | scaling | exited
  intent text[] default '{}',           -- play | mentor | peers | cofounder | investor
  open_to_mentoring int default 0,
  investor_profile jsonb,
  prompts jsonb default '[]'::jsonb,
  onboarded boolean default false,
  created_at timestamptz default now()
);

create table games (
  id text primary key,
  name text not null,
  kind text not null,                   -- external | builtin | link
  launch_url text,
  min_players int default 2,
  max_players int default 2,
  skills text[] default '{}',
  min_tier tier default 'anonymous',
  tagline text,
  lesson_md text,
  reflection_questions text[] default '{}'
);

create table tables (
  id uuid primary key default gen_random_uuid(),
  game_id text references games,
  host_id uuid references profiles,
  visibility text default 'public',     -- public | private | friends
  mode text default 'realtime',         -- realtime | turn_based
  status text default 'open',           -- open | playing | finished | abandoned
  invite_code text unique default substr(md5(random()::text),1,8),
  scheduled_for timestamptz,
  external_match_id text,
  state jsonb,                          -- built-in game state
  created_at timestamptz default now(),
  started_at timestamptz,
  ended_at timestamptz
);

create table table_seats (
  table_id uuid references tables on delete cascade,
  player_id uuid references profiles on delete cascade,
  seat int not null,
  is_bot boolean default false,
  joined_at timestamptz default now(),
  primary key (table_id, player_id)
);

create table results (
  id bigint generated always as identity primary key,
  table_id uuid references tables,
  player_id uuid references profiles,
  game_id text references games,
  placement int,
  score numeric,
  rating_before int,
  rating_after int,
  skill_tags text[] default '{}',
  recorded_at timestamptz default now()
);

create table ratings (
  player_id uuid references profiles on delete cascade,
  game_id text references games,
  rating int default 1200,
  games_played int default 0,
  wins int default 0,
  primary key (player_id, game_id)
);

create table reputation (
  player_id uuid primary key references profiles on delete cascade,
  score int default 100,
  abandons int default 0,
  kudos int default 0,
  vouches int default 0,
  debriefs int default 0
);

create table connections (
  requester_id uuid references profiles on delete cascade,
  addressee_id uuid references profiles on delete cascade,
  status text default 'pending',        -- pending | accepted | blocked
  source text,
  created_at timestamptz default now(),
  primary key (requester_id, addressee_id)
);

create table messages (
  id bigint generated always as identity primary key,
  table_id uuid references tables on delete cascade,
  to_id uuid references profiles,
  from_id uuid references profiles,
  body text not null check (length(body) <= 2000),
  created_at timestamptz default now()
);

create table recommendations (
  player_id uuid references profiles on delete cascade,
  suggested_id uuid references profiles on delete cascade,
  match_type text default 'playmate',
  reason text,
  score numeric,
  generated_at timestamptz default now(),
  acted_on boolean default false,
  primary key (player_id, suggested_id, match_type)
);

create table peer_feedback (
  table_id uuid references tables on delete cascade,
  from_id uuid references profiles on delete cascade,
  to_id uuid references profiles on delete cascade,
  chip text check (chip in ('bold','careful','generous','sharp','patient','fun')),
  kudos boolean default false,
  primary key (table_id, from_id, to_id)
);

create table telemetry (
  id bigint generated always as identity primary key,
  table_id uuid references tables on delete cascade,
  player_id uuid references profiles on delete cascade,
  game_id text references games,
  metrics jsonb not null,
  recorded_at timestamptz default now()
);

create table debriefs (
  table_id uuid references tables on delete cascade,
  player_id uuid references profiles on delete cascade,
  question text,
  answer text check (length(answer) <= 500),
  created_at timestamptz default now(),
  primary key (table_id, player_id)
);

create table introductions (
  id uuid primary key default gen_random_uuid(),
  kind text check (kind in ('mentor','investor','cofounder')),
  from_id uuid references profiles,
  to_id uuid references profiles,
  reason text,
  status text default 'pending',
  created_at timestamptz default now(),
  answered_at timestamptz
);

create table reports (
  id bigint generated always as identity primary key,
  reporter_id uuid references profiles,
  reported_id uuid references profiles,
  table_id uuid,
  body text,
  created_at timestamptz default now()
);

-- ---------- helpers ----------
create or replace function my_tier() returns tier language sql stable security definer set search_path = public as $$
  select coalesce((select case when tier_expires_at is not null and tier_expires_at < now() then 'free'::tier else tier end
                   from profiles where id = auth.uid()), 'anonymous'::tier);
$$;

create or replace function tier_allows(feature text) returns boolean language sql stable as $$
  select case feature
    when 'create_table'    then my_tier() >= 'free'
    when 'private_table'   then my_tier() >= 'member'
    when 'full_history'    then my_tier() >= 'member'
    when 'view_style'      then my_tier() >= 'member'
    when 'view_vip_fields' then my_tier() >= 'vip'
    when 'dm_anyone'       then my_tier() >= 'member'
    when 'mentor_match'    then my_tier() >= 'member'
    when 'cofounder_match' then my_tier() >= 'member'
    when 'investor_match'  then my_tier() >= 'vip'
    when 'vouch'           then my_tier() >= 'ceo'
    else false end;
$$;

create or replace function is_seated(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from table_seats s where s.table_id = t and s.player_id = auth.uid());
$$;

create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, username, is_anonymous, tier)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'username', 'guest_' || substr(replace(new.id::text,'-',''),1,6)),
          coalesce(new.is_anonymous, false),
          'free');
  insert into reputation (player_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ---------- RLS ----------
alter table profiles enable row level security;
alter table games enable row level security;
alter table tables enable row level security;
alter table table_seats enable row level security;
alter table results enable row level security;
alter table ratings enable row level security;
alter table reputation enable row level security;
alter table connections enable row level security;
alter table messages enable row level security;
alter table recommendations enable row level security;
alter table peer_feedback enable row level security;
alter table telemetry enable row level security;
alter table debriefs enable row level security;
alter table introductions enable row level security;
alter table reports enable row level security;

create policy "profiles readable" on profiles for select using (true);
create policy "own profile editable" on profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "games readable" on games for select using (true);

create policy "tables visible" on tables for select
  using (visibility = 'public' or host_id = auth.uid() or is_seated(id));
create policy "create table by tier" on tables for insert
  with check (host_id = auth.uid() and tier_allows('create_table')
              and (visibility = 'public' or tier_allows('private_table')));
create policy "host edits table" on tables for update using (host_id = auth.uid());

create policy "seats visible" on table_seats for select using (true);
create policy "sit down" on table_seats for insert with check (player_id = auth.uid());
create policy "stand up" on table_seats for delete using (player_id = auth.uid());

create policy "results visibility" on results for select
  using (player_id = auth.uid() or tier_allows('full_history')
         or (recorded_at > now() - interval '30 days' and my_tier() >= 'free'));

create policy "ratings readable" on ratings for select using (true);
create policy "reputation readable" on reputation for select using (true);

create policy "my connections" on connections for select using (requester_id = auth.uid() or addressee_id = auth.uid());
create policy "request connection" on connections for insert with check (requester_id = auth.uid() and my_tier() >= 'free');
create policy "answer connection" on connections for update using (addressee_id = auth.uid());

create policy "messages visible" on messages for select
  using (to_id = auth.uid() or from_id = auth.uid() or (table_id is not null and is_seated(table_id)));
create policy "send message" on messages for insert
  with check (from_id = auth.uid() and (
      (table_id is not null and is_seated(table_id))
      or tier_allows('dm_anyone')
      or exists (select 1 from connections c where c.status='accepted'
                 and ((c.requester_id = auth.uid() and c.addressee_id = to_id) or (c.addressee_id = auth.uid() and c.requester_id = to_id)))));

create policy "my recommendations" on recommendations for select using (player_id = auth.uid());
create policy "act on recommendation" on recommendations for update using (player_id = auth.uid());

create policy "give feedback" on peer_feedback for insert with check (from_id = auth.uid() and is_seated(table_id));
create policy "feedback readable" on peer_feedback for select using (true);

create policy "telemetry own" on telemetry for select using (player_id = auth.uid());

create policy "debriefs at my table" on debriefs for select using (is_seated(table_id));
create policy "answer debrief" on debriefs for insert with check (player_id = auth.uid() and is_seated(table_id));
create policy "edit debrief" on debriefs for update using (player_id = auth.uid());

create policy "my introductions" on introductions for select
  using (from_id = auth.uid() or (to_id = auth.uid()) );
create policy "request introduction" on introductions for insert with check (from_id = auth.uid());
create policy "answer introduction" on introductions for update using (to_id = auth.uid());

create policy "file report" on reports for insert with check (reporter_id = auth.uid());

-- ---------- realtime ----------
alter publication supabase_realtime add table tables, table_seats, messages, debriefs, peer_feedback;
