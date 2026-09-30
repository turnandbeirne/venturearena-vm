// Stripe Checkout for a tier. Secrets: STRIPE_SECRET_KEY, PRICE_MEMBER, PRICE_VIP, PRICE_CEO, ARENA_URL
import Stripe from 'npm:stripe@17'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from './cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const key = Deno.env.get('STRIPE_SECRET_KEY')
  if (!key) return json({ error: 'billing not configured' }, 503)
  const stripe = new Stripe(key)
  const auth = req.headers.get('Authorization') ?? ''
  const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: { user: me } } = await user.auth.getUser()
  if (!me || !me.email) return json({ error: 'add an email to your account first' }, 401)
  const { tier } = await req.json()
  const price = { member: Deno.env.get('PRICE_MEMBER'), vip: Deno.env.get('PRICE_VIP'), ceo: Deno.env.get('PRICE_CEO') }[tier as string]
  if (!price) return json({ error: 'unknown tier' }, 400)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: p } = await admin.from('profiles').select('stripe_customer_id').eq('id', me.id).single()
  let customer = p?.stripe_customer_id
  if (!customer) {
    const c = await stripe.customers.create({ email: me.email, metadata: { user_id: me.id } })
    customer = c.id; await admin.from('profiles').update({ stripe_customer_id: customer }).eq('id', me.id)
  }
  const session = await stripe.checkout.sessions.create({
    customer, mode: 'subscription', line_items: [{ price, quantity: 1 }], allow_promotion_codes: true,
    success_url: `${Deno.env.get('ARENA_URL')}/membership?upgraded=1`, cancel_url: `${Deno.env.get('ARENA_URL')}/membership`,
  })
  return json({ url: session.url })
})
