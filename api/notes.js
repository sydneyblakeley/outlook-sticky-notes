const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('No token');
  return jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let user;
  try { user = verifyToken(req); } catch { return res.status(401).json({ error: 'Unauthorized' }); }

  if (req.method === 'GET') {
    const { meeting_key } = req.query;
    if (!meeting_key) return res.status(400).json({ error: 'Missing meeting_key' });
    const { data, error } = await supabase
      .from('notes').select('*')
      .eq('user_id', user.user_id).eq('meeting_key', meeting_key).single();
    if (error && error.code !== 'PGRST116') return res.status(500).json({ error: error.message });
    return res.status(200).json({ note: data || null });
  }

  if (req.method === 'POST') {
    const { meeting_key, meeting_title, meeting_date, content_html, color } = req.body;
    if (!meeting_key) return res.status(400).json({ error: 'Missing meeting_key' });
    const { data, error } = await supabase
      .from('notes')
      .upsert({
        user_id: user.user_id,
        meeting_key, meeting_title, meeting_date,
        content_html: content_html || '',
        color: color || 'yellow',
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,meeting_key' })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ note: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
