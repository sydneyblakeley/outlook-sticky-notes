import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { microsoft_token } = req.body;
    if (!microsoft_token) return res.status(400).json({ error: 'Missing token' });

    const graphResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${microsoft_token}` }
    });
    if (!graphResponse.ok) return res.status(401).json({ error: 'Invalid Microsoft token' });

    const msUser = await graphResponse.json();
    const microsoft_id = msUser.id;
    const email = msUser.mail || msUser.userPrincipalName;
    const display_name = msUser.displayName;

    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('microsoft_id', microsoft_id)
      .single();

    if (!user) {
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          microsoft_id,
          email,
          display_name,
          trial_started_at: new Date().toISOString(),
          subscription_status: 'trial',
          subscription_tier: 'pro_notetaker'
        })
        .select()
        .single();
      if (createError) throw createError;
      user = newUser;
    }

    const trialStart = new Date(user.trial_started_at);
    const daysSinceTrial = (Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24);
    const trialExpired = daysSinceTrial > 7 && user.subscription_status === 'trial';

    const sessionToken = jwt.sign(
      {
        user_id: user.id,
        microsoft_id,
        email,
        display_name,
        subscription_tier: user.subscription_tier,
        subscription_status: trialExpired ? 'expired' : user.subscription_status
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      token: sessionToken,
      user: {
        id: user.id,
        email,
        display_name,
        subscription_tier: user.subscription_tier,
        subscription_status: trialExpired ? 'expired' : user.subscription_status,
        trial_days_remaining: trialExpired ? 0 : Math.max(0, Math.ceil(7 - daysSinceTrial))
      }
    });
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}
