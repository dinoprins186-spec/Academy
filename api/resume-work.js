// api/resume-work.js
// GET /api/resume-work

import { getUserId, getResumeData } from './_lib/db.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-user-id, x-academy-user',
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET')     { res.status(405).end(); return; }

  try {
    const userId = getUserId(req);
    const data   = await getResumeData(userId);

    res.status(200).json({
      last_document: data.last_document,
      last_session:  data.last_session,
      last_action:   data.last_action,
      last_state:    data.last_state,
    });
  } catch (e) {
    console.error('[resume-work]', e.message);
    res.status(500).json({
      last_document: null,
      last_session:  null,
      last_action:   null,
      last_state:    null,
    });
  }
}
