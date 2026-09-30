// Deploy with verify_jwt = false. Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, PRICE_MEMBER, PRICE_VIP, PRICE_CEO
import Stripe from 'npm:stripe@17'
import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)
  const sig = req.headers.get('stripe-signature')!
  let event: Stripe.Event
  try { event = await stripe.webhooks.constructEventAsync(await req.text(), sig, Deno.env.get('STRIPE_WEBHOOK_SECRET')!) }
  catch (e) { return new Response(`bad signature: ${(e as Error).message}`, { status: 400 }) }
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const tierForPrice: Record<string, string> = { [Deno.env.get('PRICE_MEMBER')!]: 'member', [Deno.env.get('PRICE_VIP')!]: 'vip', [Deno.env.get('PRICE_CEO')!]: 'ceo' }
  const apply = async (sub: Stripe.Subscription) => {
    const price = sub.items.data[0]?.price.id
    const active = sub.status === 'active' || sub.status === 'trialing'
    const tier = active ? (tierForPrice[price] ?? 'free') : 'free'
    const period = (sub as any).current_period_end ?? sub.items.data[0]?.current_period_end
    await admin.from('profiles').update({ tier, tier_expires_at: period ? new Date(period * 1000).toISOString() : null }).eq('stripe_customer_id', sub.customer as string)
  }
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session
      if (s.subscription) await apply(await stripe.subscriptions.retrieve(s.subscription as string)); break
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.created':
    case 'customer.subscription.deleted': await apply(event.data.object as Stripe.Subscription); break
  }
  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } })
})
