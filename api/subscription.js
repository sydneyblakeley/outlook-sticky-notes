
// api/subscription.js
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const TRIAL_DAYS = 14;
const FREE_EMAILS = [
  'szindroski@maverixhealth.com',
  'sydneyblakeley@outlook.com',
  'stickynotes.testuser@outlook.com'
];

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('No token');
  return jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  let user;
  try { user = verifyToken(req); } catch { return res.status(401).json({ error: 'Unauthorized' }); }

  const email = (user.email || '').toLowerCase();
  if (FREE_EMAILS.some(e => e.toLowerCase() === email)) {
    return res.status(200).json({ granted: true, reason: 'free', tier: 'pro_notetaker', daysLeft: 999 });
  }

  try {
    const { data: userData } = await supabase.from('users').select('subscription_status, subscription_tier, trial_started_at').eq('email', email).single();

    if (userData?.subscription_status === 'active') {
      return res.status(200).json({ granted: true, reason: 'paid', tier: userData.subscription_tier || 'pro', daysLeft: 999 });
    }
    if (userData?.subscription_status === 'past_due') {
      return res.status(200).json({ granted: true, reason: 'past_due', tier: userData.subscription_tier || 'pro', daysLeft: 999 });
    }

    let trialStart = userData?.trial_started_at;
    if (!trialStart) {
      trialStart = new Date().toISOString();
      await supabase.from('users').upsert({ email, trial_started_at: trialStart, subscription_status: 'trial' }, { onConflict: 'email' });
    }

    const days = (Date.now() - new Date(trialStart).getTime()) / (1000 * 60 * 60 * 24);
    const daysLeft = Math.max(0, Math.ceil(TRIAL_DAYS - days));
    if (days <= TRIAL_DAYS) return res.status(200).json({ granted: true, reason: 'trial', tier: 'pro_notetaker', daysLeft });
    return res.status(200).json({ granted: false, reason: 'expired', daysLeft: 0 });

  } catch (err) {
    return res.status(200).json({ granted: true, reason: 'error', daysLeft: 999 });
  }
};
