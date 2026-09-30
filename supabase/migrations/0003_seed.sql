insert into games (id, name, kind, launch_url, min_players, max_players, skills, tagline, lesson_md, reflection_questions) values
('connect4', 'Connect 4', 'builtin', null, 2, 2, array['pattern recognition','positioning','patience'],
 'Four in a row. Two minutes to learn, a career to master.',
 'Connect 4 rewards players who build threats in two directions at once. In business the same move is called optionality: make choices that leave you two good next steps, and force competitors into one. Watch how often the winner controlled the center column: the center is where the most lines pass through, just as the most valuable position in a market is the one the most customer journeys pass through.',
 array['Which move did you regret, and what would you have needed to see earlier?','Did you play to win or play not to lose? When does each make sense in a business?','What did the center column teach you about positioning?']),
('ventureflow', 'VentureFlow', 'external', 'https://venturemaker.org/ventureflow', 2, 6, array['cash flow','fundraising','pricing','hustle'],
 'Run a startup from idea to exit. Every round is a decision about cash.',
 'VentureFlow is about the timing of money. The players who win rarely raise the most; they raise before they need to and spend into proven demand. Look at your lowest cash point: that is the moment your venture was actually at risk.',
 array['When was your cash the tightest, and what decision put it there?','Who would you have partnered with in round 6, and why?','Did you raise too early, too late, or just right?']),
('ventureboom', 'VentureBoom', 'external', 'https://venturemaker.org/ventureboom', 2, 5, array['deal making','risk','portfolio thinking'],
 'Collect sets of legendary entrepreneur types before the market goes boom.',
 'VentureBoom teaches portfolio thinking: no single card wins, sets do. Founders who diversify their skills and their relationships survive the boom rounds that wipe out specialists.',
 array['Which entrepreneur type did you find hardest to collect, and who do you know like that?','When did you know the boom was coming, and what did you do about it?']),
('chess', 'Chess', 'builtin', null, 2, 2, array['strategy','planning','patience'], 'Coming soon: the original strategy game.', null, array['What was your plan, and when did it change?']),
('checkers', 'Checkers', 'builtin', null, 2, 2, array['tempo','sacrifice'], 'Coming soon.', null, array['What did you give up to get ahead?']);

-- a bot user for built-in games
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, is_anonymous)
values ('00000000-0000-0000-0000-00000000b0b0', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'robo@venturearena.local', '', now(), '{"username":"robo_trader"}'::jsonb, now(), now(), false)
on conflict (id) do nothing;
update profiles set display_name = 'Robo-Trader', archetype = 'trader', stage = 'scaling', onboarded = true, bio = 'House bot. Level 2. Plays fast, never sulks.' where username = 'robo_trader';
