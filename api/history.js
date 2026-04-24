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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let user;
  try { user = verifyToken(req); } catch { return res.status(401).json({ error: 'Unauthorized' }); }

  if (req.method === 'GET') {
    const { search, limit = 20 } = req.query;
    let query = supabase
      .from('notes')
      .select('id, meeting_key, meeting_title, meeting_date, content_html, color, updated_at')
      .eq('user_id', user.user_id)
      .not('content_html', 'eq', '')
      .order('updated_at', { ascending: false })
      .limit(parseInt(limit));
    if (search) {
      query = query.or(`meeting_title.ilike.%${search}%,content_html.ilike.%${search}%`);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    const notes = (data || []).map(n => ({
      ...n,
      preview: n.content_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150)
    }));
    return res.status(200).json({ notes });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
