// api/_lib/db.js
// Persistência Supabase — raw fetch, sem SDK, sem await no caller.

import crypto from 'crypto';

const SB_URL = process.env.SUPABASE_URL
  ?? 'https://ivvkxgqmvolrrjwfxtzy.supabase.co';

const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── REST helpers ─────────────────────────────────────────────────────────────

async function sbPost(table, data) {
  if (!SB_KEY) return;
  const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method:  'POST',
    headers: {
      'apikey':        SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status} [${table}]: ${text.slice(0, 200)}`);
  }
}

async function sbGet(path) {
  if (!SB_KEY) return [];
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: {
      'apikey':        SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
    },
  });
  if (!res.ok) return [];
  return res.json();
}

// ── User ID ──────────────────────────────────────────────────────────────────

export function getUserId(req) {
  return req.headers['x-user-id'] ||
         req.headers['x-academy-user'] ||
         crypto.randomUUID();
}

// ── Persistência ─────────────────────────────────────────────────────────────

export async function persistRequest({
  requestId,
  userId,
  action,
  payload,
  result,
  modelUsed,
  responseTime,
}) {
  const now = new Date().toISOString();

  // 1. Log IA (todas as actions)
  await sbPost('academy_ai_logs', {
    id:            crypto.randomUUID(),
    user_id:       userId,
    action,
    model_used:    modelUsed  ?? null,
    request_id:    requestId,
    response_time: responseTime,
    payload:       payload    ?? {},
    result:        result     ?? {},
    created_at:    now,
  });

  // 2. Documento (apenas actions relevantes)
  const docTypeMap = {
    gerar_capitulo:       'chapter',
    gerar_capitulo_livro: 'book',
    create_work:          'work',
  };

  const docType = docTypeMap[action];
  if (docType) {
    const title = String(
      payload?.capTitulo ?? payload?.topic ?? payload?.tema ?? action
    );
    await sbPost('academy_documents', {
      id:         crypto.randomUUID(),
      user_id:    userId,
      type:       docType,
      title,
      content:    { payload, result },
      created_at: now,
      updated_at: now,
    });
  }
}

// ── Resume ───────────────────────────────────────────────────────────────────

export async function getResumeData(userId) {
  const uid = encodeURIComponent(userId);

  const [docs, sessions, logs] = await Promise.all([
    sbGet(`academy_documents?user_id=eq.${uid}&order=updated_at.desc&limit=1`),
    sbGet(`academy_sessions?user_id=eq.${uid}&order=last_activity.desc&limit=1`),
    sbGet(`academy_ai_logs?user_id=eq.${uid}&order=created_at.desc&limit=1`),
  ]);

  const lastDoc  = Array.isArray(docs)     ? (docs[0]     ?? null) : null;
  const lastSess = Array.isArray(sessions) ? (sessions[0] ?? null) : null;
  const lastLog  = Array.isArray(logs)     ? (logs[0]     ?? null) : null;

  return {
    last_document: lastDoc,
    last_session:  lastSess,
    last_action:   lastLog?.action ?? null,
    last_state:    lastLog
      ? { action: lastLog.action, payload: lastLog.payload, model: lastLog.model_used }
      : null,
  };
}
