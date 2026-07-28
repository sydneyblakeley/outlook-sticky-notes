// api/fireflies.js
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Only accounts that have szindroski's Fireflies key in the env var
const FREE_EMAILS = [
  'szindroski@maverixhealth.com'
];

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

function stripTimestamps(text) {
  if (!text) return '';
  return text
    .replace(/\(\d{2}:\d{2}(:\d{2})?\)/g, '')
    .replace(/\[\d{2}:\d{2}(:\d{2})?\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatSummary(text) {
  if (!text) return '';
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
  if (sentences.length <= 1) return `<p>${stripTimestamps(text)}</p>`;
  return `<ul>${sentences.map(s => `<li>${stripTimestamps(s)}</li>`).join('')}</ul>`;
}

function formatDetailedNotes(text) {
  if (!text) return '';
  const lines = text.split('\n');
  let html = '';
  let inList = false;

  lines.forEach(line => {
    let stripped = stripTimestamps(line.trim());
    if (!stripped) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<br>';
      return;
    }

    if (stripped.startsWith('## ') || stripped.startsWith('# ')) {
      if (inList) { html += '</ul>'; inList = false; }
      const txt = stripped.replace(/^#+\s*/, '').replace(/\*\*/g, '');
      html += `<div style="font-weight:700;font-size:12px;margin:10px 0 3px;color:#1e4d78">${txt}</div>`;
    }
    else if (stripped.match(/^\*\*[^*]+\*\*:?$/)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<div style="font-weight:700;font-size:12px;margin:10px 0 3px;color:#1e4d78">${stripped.replace(/\*\*/g, '').replace(/:$/, '')}</div>`;
    }
    else if (stripped.match(/^[-•]\s+/)) {
      if (!inList) { html += '<ul style="padding-left:16px;margin:3px 0">'; inList = true; }
      const txt = stripped.replace(/^[-•]\s+/, '').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      html += `<li style="font-size:12px;color:#333;line-height:1.5;margin:2px 0">${txt}</li>`;
    }
    else {
      if (inList) { html += '</ul>'; inList = false; }
      const txt = stripped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      html += `<p style="font-size:12px;color:#333;margin:3px 0;line-height:1.6">${txt}</p>`;
    }
  });

  if (inList) html += '</ul>';
  return html;
}

function parseActionItems(actionItemsText, userEmail, userDisplayName) {
  if (!actionItemsText) return { mine: [], all: {} };

  const all = {};
  const lines = actionItemsText.split('\n');
  let currentPerson = null;

  lines.forEach(line => {
    line = line.trim();
    if (!line) return;
    const nameMatch = line.match(/^\*\*(.+?)\*\*$/);
    if (nameMatch) {
      currentPerson = nameMatch[1].trim();
      if (!all[currentPerson]) all[currentPerson] = [];
      return;
    }
    if (currentPerson && line.length > 3) {
      const cleaned = stripTimestamps(line);
      if (cleaned.length > 3) all[currentPerson].push(cleaned);
    }
  });

  const myEmailName = userEmail ? userEmail.split('@')[0].replace(/[._]/g, ' ').toLowerCase() : '';
  const myDisplayName = (userDisplayName || '').toLowerCase();
  let mine = [];

  Object.entries(all).forEach(([person, items]) => {
    const personLower = person.toLowerCase();
    const emailParts = myEmailName.split(' ').filter(p => p.length > 2);
    const displayParts = myDisplayName.split(' ').filter(p => p.length > 2);
    const allParts = [...emailParts, ...displayParts];
    const matches = allParts.some(part => personLower.includes(part));
    if (matches) mine = items;
  });

  return { mine, all };
}

function findBestMatch(transcripts, meetingTitle, meetingDate) {
  if (!transcripts || !transcripts.length) return null;

  const titleLower = (meetingTitle || '').toLowerCase();
  const targetDate = meetingDate ? new Date(meetingDate) : null;

  const scored = transcripts.map(t => {
    let score = 0;
    const tTitle = (t.title || '').toLowerCase();
    const tDate = t.dateString ? new Date(t.dateString) : null;

    const titleWords = titleLower.split(' ').filter(w => w.length > 3);
    titleWords.forEach(word => { if (tTitle.includes(word)) score += 2; });

    if (targetDate && tDate) {
      const daysDiff = Math.abs((targetDate - tDate) / (1000 * 60 * 60 * 24));
      if (daysDiff < 1) score += 10;
      else if (daysDiff < 3) score += 5;
      else if (daysDiff < 7) score += 2;
    }

    return { transcript: t, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].score > 6 ? scored[0].transcript : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let user;
  try { user = verifyToken(req); } catch { return res.status(401).json({ error: 'Unauthorized' }); }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { meeting_title, meeting_date } = req.query;
  if (!meeting_title) return res.status(400).json({ error: 'Missing meeting_title' });

  try {
    const email = (user.email || '').toLowerCase();
    const isFreeAccount = FREE_EMAILS.some(e => e.toLowerCase() === email);


    // Look up user's own Fireflies API key from Supabase
    let userApiKey = null;
    if (!isFreeAccount) {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('fireflies_api_key')
        .eq('email', email)
        .single();
        // Only use key if record exists and key is set
      if (!userError && userData?.fireflies_api_key) {
        userApiKey = userData.fireflies_api_key;
      }
    }

    // Determine which API key to use
    const apiKey = isFreeAccount ? process.env.FIREFLIES_API_KEY : userApiKey;


    // No API key = no Fireflies connected
    if (!apiKey) {
        return res.status(200).json({ found: false, reason: 'no_api_key' });
    }

    const searchQuery = `
      query {
        transcripts(limit: 20) {
          id
          title
          date
          dateString
          duration
          organizer_email
          participants
          summary {
            short_summary
            overview
            bullet_gist
            action_items
            keywords
            notes
          }
          meeting_attendees {
            displayName
            email
          }
        }
      }
    `;

    const ffResponse = await fetch('https://api.fireflies.ai/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ query: searchQuery })
    });

    if (!ffResponse.ok) {
      return res.status(200).json({ found: false, reason: 'Fireflies API error' });
    }

    const ffData = await ffResponse.json();
    const transcripts = ffData?.data?.transcripts || [];

    const match = findBestMatch(transcripts, meeting_title, meeting_date);

    if (!match) {
      return res.status(200).json({ found: false, reason: 'No matching meeting found in Fireflies' });
    }

    const { mine, all } = parseActionItems(
      match.summary?.action_items,
      user.email,
      user.name
    );

    const attendees = (match.meeting_attendees || [])
      .filter(a => a.email)
      .map(a => a.displayName ? `${a.displayName} <${a.email}>` : a.email)
      .join('; ');

    const detailedNotes = match.summary?.notes || '';
    const summaryFallback = formatSummary(
      match.summary?.bullet_gist || match.summary?.overview || match.summary?.short_summary || ''
    );

    return res.status(200).json({
      found: true,
      transcript_id: match.id,
      meeting_title: match.title,
      meeting_date: match.dateString,
      my_actions: mine,
      all_actions: all,
      summary: summaryFallback,
      detailed_notes: formatDetailedNotes(detailedNotes),
      keywords: match.summary?.keywords || [],
      attendees,
      raw_action_items: match.summary?.action_items || ''
    });

  } catch (err) {
    console.error('Fireflies error:', err);
    return res.status(500).json({ error: 'Failed to fetch Fireflies data' });
  }
};
