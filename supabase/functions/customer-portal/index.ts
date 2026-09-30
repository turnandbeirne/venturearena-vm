import Stripe from 'npm:stripe@17'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from './cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const key = Deno.env.get('STRIPE_SECRET_KEY')
  if (!key) return json({ error: 'billing not configured' }, 503)
  const stripe = new Stripe(key)
  const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: { user: me } } = await user.auth.getUser()
  if (!me) return json({ error: 'not signed in' }, 401)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: p } = await admin.from('profiles').select('stripe_customer_id').eq('id', me.id).single()
  if (!p?.stripe_customer_id) return json({ error: 'no billing account yet' }, 400)
  const session = await stripe.billingPortal.sessions.create({ customer: p.stripe_customer_id, return_url: `${Deno.env.get('ARENA_URL')}/membership` })
  return json({ url: session.url })
})
