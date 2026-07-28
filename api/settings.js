// api/settings.js
// Saves and retrieves user settings including Fireflies API key

const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('No token');
  const token = auth.split(' ')[1];
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch(e) {
    try {
      return JSON.parse(atob(token));
    } catch(e2) {
      throw new Error('Invalid token');
    }
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let user;
  try { user = verifyToken(req); } catch { return res.status(401).json({ error: 'Unauthorized' }); }

  const email = (user.email || '').toLowerCase();

  // GET — retrieve user settings
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('fireflies_api_key')
        .eq('email', email)
        .single();

      if (error && error.code !== 'PGRST116') {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({
        fireflies_api_key: data?.fireflies_api_key || null,
        has_fireflies: !!data?.fireflies_api_key
      });
    } catch(err) {
      return res.status(500).json({ error: 'Failed to retrieve settings' });
    }
  }

  // POST — save user settings
  if (req.method === 'POST') {
    const { fireflies_api_key } = req.body;

    try {
      const { error } = await supabase
        .from('users')
        .upsert({
          email,
          fireflies_api_key: fireflies_api_key || null
        }, { onConflict: 'email' });

      if (error) return res.status(500).json({ error: error.message });

      return res.status(200).json({ success: true });
    } catch(err) {
      return res.status(500).json({ error: 'Failed to save settings' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
