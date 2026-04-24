import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function verifyToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new Error('No token');
  return jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let user;
  try { user = verifyToken(req); } catch { return res.status(401).json({ error: 'Unauthorized' }); }

  if (req.method === 'GET') {
    const { meeting_key } = req.query;
    if (!meeting_key) return res.status(400).json({ error: 'Missing meeting_key' });
    const { data, error } = await supabase
      .from('actions').select('*')
      .eq('user_id', user.user_id).eq('meeting_key', meeting_key)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ actions: data || [] });
  }

  if (req.method === 'POST') {
    const { meeting_key, text, source, carried_over_from } = req.body;
    if (!meeting_key || !text) return res.status(400).json({ error: 'Missing fields' });
    const { data, error } = await supabase
      .from('actions')
      .insert({ user_id: user.user_id, meeting_key, text, source: source || 'manual', carried_over_from: carried_over_from || null, done: false })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ action: data });
  }

  if (req.method === 'PATCH') {
    const { id, done, text } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const updates = {};
    if (typeof done === 'boolean') updates.done = done;
    if (text) updates.text = text;
    const { data, error } = await supabase
      .from('actions').update(updates)
      .eq('id', id).eq('user_id', user.user_id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ action: data });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const { error } = await supabase
      .from('actions').delete().eq('id', id).eq('user_id', user.user_id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
