// api/fireflies.js
// Fetches action items and meeting notes from Fireflies
// Matches meetings by title and date to Outlook calendar events

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

// Strip timestamps like (09:46) or [09:46] from text
function stripTimestamps(text) {
  if (!text) return '';
  return text
    .replace(/\(\d{2}:\d{2}(:\d{2})?\)/g, '')
    .replace(/\[\d{2}:\d{2}(:\d{2})?\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse action items from Fireflies format into structured array per person
function parseActionItems(actionItemsText, userEmail) {
  if (!actionItemsText) return { mine: [], all: {} };

  const all = {};
  const lines = actionItemsText.split('\n');
  let currentPerson = null;

  lines.forEach(line => {
    line = line.trim();
    if (!line) return;

    // Bold name header like **John Lynch** or **Sydney Zindroski**
    const nameMatch = line.match(/^\*\*(.+?)\*\*$/);
    if (nameMatch) {
      currentPerson = nameMatch[1].trim();
      if (!all[currentPerson]) all[currentPerson] = [];
      return;
    }

    // Action item line
    if (currentPerson && line.length > 3) {
      const cleaned = stripTimestamps(line);
      if (cleaned.length > 3) {
        all[currentPerson].push(cleaned);
      }
    }
  });

  // Find my action items by matching email name to person name
  const myName = userEmail ? userEmail.split('@')[0].replace('.', ' ').toLowerCase() : '';
  let mine = [];

  Object.entries(all).forEach(([person, items]) => {
    const personLower = person.toLowerCase();
    // Match by first name, last name, or full name
    const nameParts = myName.split(' ');
    const matches = nameParts.some(part =>
      part.length > 2 && personLower.includes(part)
    );
    if (matches) {
      mine = items;
    }
  });

  return { mine, all };
}

// Parse notes sections from summary into structured format
function parseNotes(summary) {
  if (!summary) return [];

  const sections = [];

  // Try to extract overview/bullet points
  if (summary.short_summary) {
    sections.push({
      heading: 'Meeting Summary',
      content: stripTimestamps(summary.short_summary)
    });
  }

  // Extract action items by person for the email
  if (summary.action_items) {
    sections.push({
      heading: 'ACTION_ITEMS_RAW',
      content: summary.action_items
    });
  }

  return sections;
}

// Find best matching Fireflies transcript for a meeting
function findBestMatch(transcripts, meetingTitle, meetingDate) {
  if (!transcripts || !transcripts.length) return null;

  const titleLower = (meetingTitle || '').toLowerCase();
  const targetDate = meetingDate ? new Date(meetingDate) : null;

  // Score each transcript
  const scored = transcripts.map(t => {
    let score = 0;
    const tTitle = (t.title || '').toLowerCase();
    const tDate = t.dateString ? new Date(t.dateString) : null;

    // Title similarity
    const titleWords = titleLower.split(' ').filter(w => w.length > 3);
    titleWords.forEach(word => {
      if (tTitle.includes(word)) score += 2;
    });

    // Date proximity (within 1 day = high score)
    if (targetDate && tDate) {
      const daysDiff = Math.abs((targetDate - tDate) / (1000 * 60 * 60 * 24));
      if (daysDiff < 1) score += 10;
      else if (daysDiff < 3) score += 5;
      else if (daysDiff < 7) score += 2;
    }

    return { transcript: t, score };
  });

  // Sort by score
  scored.sort((a, b) => b.score - a.score);

  // Return best match if score is good enough
  return scored[0].score > 2 ? scored[0].transcript : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let user;
  try { user = verifyToken(req); } catch { return res.status(401).json({ error: 'Unauthorized' }); }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { meeting_title, meeting_date } = req.query;
  if (!meeting_title) return res.status(400).json({ error: 'Missing meeting_title' });

  try {
    const apiKey = process.env.FIREFLIES_API_KEY;
    if (!apiKey) return res.status(200).json({ found: false, reason: 'Fireflies not configured' });

    // Search Fireflies for recent transcripts matching this meeting
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
            action_items
            keywords
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

    // Find best matching transcript
    const match = findBestMatch(transcripts, meeting_title, meeting_date);

    if (!match) {
      return res.status(200).json({ found: false, reason: 'No matching meeting found in Fireflies' });
    }

    // Parse action items
    const { mine, all } = parseActionItems(
      match.summary?.action_items,
      user.email
    );

    // Build attendees list for email
    const attendees = (match.meeting_attendees || [])
      .filter(a => a.email)
      .map(a => a.displayName ? `${a.displayName} <${a.email}>` : a.email)
      .join('; ');

    // Build notes sections
    const notes = parseNotes(match.summary);

    return res.status(200).json({
      found: true,
      transcript_id: match.id,
      meeting_title: match.title,
      meeting_date: match.dateString,
      my_actions: mine,
      all_actions: all,
      summary: stripTimestamps(match.summary?.short_summary || ''),
      keywords: match.summary?.keywords || [],
      attendees,
      notes,
      raw_action_items: match.summary?.action_items || ''
    });

  } catch (err) {
    console.error('Fireflies error:', err);
    return res.status(500).json({ error: 'Failed to fetch Fireflies data' });
  }
};
