// api/stripe-webhook.js
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getTierFromPriceId(priceId) {
  const notetakerIds = [
    process.env.STRIPE_LINK_NOTETAKER_MONTHLY,
    process.env.STRIPE_LINK_NOTETAKER_ANNUAL
  ];
  return notetakerIds.includes(priceId) ? 'pro_notetaker' : 'pro';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  const session = event.data.object;

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const customerEmail = session.customer_details?.email;
        const customerId = session.customer;
        const priceId = session.line_items?.data?.[0]?.price?.id || '';
        const tier = getTierFromPriceId(priceId);
        if (customerEmail) {
          await supabase.from('users').upsert({
            email: customerEmail,
            stripe_customer_id: customerId,
            subscription_status: 'active',
            subscription_tier: tier,
            trial_started_at: new Date().toISOString()
          }, { onConflict: 'email' });
        }
        break;
      }
      case 'customer.subscription.updated': {
        const customerId = session.customer;
        const status = session.status;
        const priceId = session.items?.data?.[0]?.price?.id || '';
        const tier = getTierFromPriceId(priceId);
        await supabase.from('users').update({ subscription_status: status, subscription_tier: tier }).eq('stripe_customer_id', customerId);
        break;
      }
      case 'customer.subscription.deleted': {
        await supabase.from('users').update({ subscription_status: 'canceled', subscription_tier: null }).eq('stripe_customer_id', session.customer);
        break;
      }
      case 'invoice.payment_failed': {
        await supabase.from('users').update({ subscription_status: 'past_due' }).eq('stripe_customer_id', session.customer);
        break;
      }
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal error' });
  }
};
