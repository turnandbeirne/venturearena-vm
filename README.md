# VentureArena

Multiplayer arena where aspiring entrepreneurs practice business through strategy games, then meet the people they played with.

Stack: Vite + React 19 + TypeScript + Tailwind 4 · Supabase (Auth with anonymous sign-in, Postgres + RLS, Realtime, Edge Functions) · Stripe (checkout, portal, webhook) · Render/Vercel static hosting.

## What is in the MVP

- Instant guest play (anonymous auth), progressive signup that keeps the same user id and history
- 3-minute onboarding card sort → archetype (Builder/Trader/Operator/Backer/Analyst), risk, pace, collaboration style, stage, intent, interests, conversation prompts → flippable Player Card
- Lobby: live open tables, presence, "People who fit you", quick match (`quick_match` SQL, rating band ±400), host/join, invite links `/join/:code` that work logged-out
- Table room: seats with archetype + stage + reputation shield, table chat (Realtime), Question of the table, bots
- Connect 4 fully server-validated in Postgres (`make_move`, `c4_winner`), bot driven by the host client
- Debrief room: result + Elo delta, reflection question, everyone's answers live, two-tap peer chips, kudos, connect, lesson card (full lesson for Members), play again
- Profiles: Player Card, play history (30 days for free viewers, full for Members), head-to-head (VIP), mentor toggle, guest → account upgrade
- People: five match segments (playmate, peers, mentor, cofounder, investor) from `generate_recommendations`; first-move buttons; intro requests; search
- Inbox: connection requests, introductions (accept / not now), DMs gated by RLS (connections free, anyone for Members)
- Membership page with tier framing; Stripe functions written, deployed only when keys exist
- Game adapter: `launch-game` (signed HS256 token) and `report-result` (writes results, ratings, reputation, telemetry) for VentureFlow / VentureBoom

## Setup

1. Supabase project → SQL editor → run `supabase/migrations/0001_core.sql`, `0002_game_logic.sql`, `0003_seed.sql` in order.
2. Authentication → Providers: enable Email and **Anonymous sign-ins**. URL configuration: site URL = your deploy URL.
3. Edge Functions → Secrets: `ARENA_GAME_SECRET` (random 32+ chars), `ARENA_URL` (deploy URL). Deploy `launch-game` (JWT on) and `report-result` (JWT off; token-verified).
4. `cp .env.example .env` and fill `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. `npm i && npm run dev`.
5. Deploy: `npm run build`, publish `dist/` (Render static site or Vercel; `public/_redirects` handles SPA routing on Render, use `vercel.json` rewrites on Vercel).
6. Stripe (when ready): create Member $9.99 / VIP $49.99 / CEO $249 monthly prices; add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PRICE_MEMBER`, `PRICE_VIP`, `PRICE_CEO`; deploy `create-checkout`, `customer-portal`, `stripe-webhook` (JWT off); register the webhook for `checkout.session.completed`, `customer.subscription.*`.
7. Make yourself CEO tier once: `update profiles set tier='ceo' where username='<you>'`; then `select admin_set_tier('someone','vip')` works from SQL or an admin screen.

## Integrating a game (VentureFlow / VentureBoom)

1. Read `arena` from the query string on load. Verify it with the shared secret (in your own server/edge function), or trust it for display only.
2. Seat the `players` array from the token; show an "Arena match" ribbon.
3. When the game ends, `POST {SUPABASE_URL}/functions/v1/report-result` with `{ token, results: [{ player_id, placement, score, skill_tags, telemetry }] }`.
4. Send players to the returned `debrief_url`.

## Structure

```
src/lib        supabase client, auth context (useTier), archetype content + card-sort scoring
src/components Layout (Play / People / Me / Inbox), PlayerCard, Connect4 board + bot
src/pages      Landing, Onboarding, Lobby, TableRoom, Debrief, Profile, People, Inbox, Membership, Join
supabase/      migrations (schema, RLS, game logic, seed) and edge functions
```
