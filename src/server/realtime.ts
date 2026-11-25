import type { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { loadUserById, verifyToken } from './auth.ts';
import { db } from './db.ts';

const userSockets = new Map<number, Set<WebSocket>>();

export function getOnlineUserIds(): number[] {
  return Array.from(userSockets.keys());
}

export function isUserOnline(userId: number): boolean {
  const set = userSockets.get(userId);
  return Boolean(set && set.size > 0);
}

export function pushRealtimeToUser(userId: number, event: string, payload: any): void {
  const set = userSockets.get(userId);
  if (!set || set.size === 0) return;
  const serialized = JSON.stringify({ event, payload });
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
    }
  }
}

function broadcastPresence(): void {
  const onlineIds = getOnlineUserIds();
  const msg = JSON.stringify({ event: 'presence:update', payload: { onlineUserIds: onlineIds } });
  for (const set of userSockets.values()) {
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }
}

export function createNotification(params: {
  userId: number;
  type: string;
  title: string;
  body: string;
  titleAm?: string;
  bodyAm?: string;
  link?: string;
}): void {
  const res = db
    .prepare(
      `INSERT INTO notifications (user_id, type, title, body, title_am, body_am, link)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.userId,
      params.type,
      params.title,
      params.body,
      params.titleAm || params.title,
      params.bodyAm || params.body,
      params.link || ''
    );
  const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(Number(res.lastInsertRowid));
  pushRealtimeToUser(params.userId, 'notification:new', notif);
}

export function attachWebSocketServer(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    try {
      const parsed = new URL(req.url || '/', 'http://localhost');
      if (parsed.pathname === '/ws') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      }
    } catch {
      // Allow other upgrade listeners to process non-/ws requests
    }
  });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/ws', 'http://localhost');
    const ticket = url.searchParams.get('ticket') || '';
    const decoded = verifyToken(ticket);
    if (!decoded || typeof decoded.uid !== 'number' || decoded.type !== 'ws') {
      ws.close(4001, 'Unauthorized WebSocket');
      return;
    }

    const userId = decoded.uid;
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)!.add(ws);
    broadcastPresence();

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString('utf8'));
        const { event, payload } = msg;
        if (!event || !payload) return;

        // Typing indicator
        if (event === 'chat:typing' && payload.conversationId && payload.targetUserId) {
          pushRealtimeToUser(Number(payload.targetUserId), 'chat:typing', {
            conversationId: Number(payload.conversationId),
            userId,
            isTyping: Boolean(payload.isTyping),
          });
          return;
        }

        // WebRTC Signaling: verify active service pass & check block list before relaying
        if (event === 'call:initiate' && payload.calleeId) {
          const callerUser = loadUserById(userId);
          if (!callerUser || !callerUser.subscription_active) {
            ws.send(
              JSON.stringify({
                event: 'call:error',
                payload: {
                  code: 'SUBSCRIPTION_REQUIRED',
                  error: 'An active 50 ETB monthly AZ RENTAL service pass is required to make calls.',
                },
              })
            );
            return;
          }
          const calleeId = Number(payload.calleeId);
          const blocked = db
            .prepare(`SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`)
            .get(userId, calleeId, calleeId, userId);
          if (blocked) {
            ws.send(JSON.stringify({ event: 'call:error', payload: { error: 'User unavailable' } }));
            return;
          }

          const callType = payload.callType === 'video' ? 'video' : 'audio';
          const convId = payload.conversationId ? Number(payload.conversationId) : null;
          const callRes = db
            .prepare(
              `INSERT INTO calls (conversation_id, caller_id, callee_id, call_type, status)
               VALUES (?, ?, ?, ?, 'ringing')`
            )
            .run(convId, userId, calleeId, callType);
          const callId = Number(callRes.lastInsertRowid);
          const caller = db
            .prepare('SELECT id, full_name, avatar_url FROM users WHERE id = ?')
            .get(userId) as any;

          ws.send(JSON.stringify({ event: 'call:created', payload: { callId, calleeId, callType } }));

          if (isUserOnline(calleeId)) {
            pushRealtimeToUser(calleeId, 'call:incoming', {
              callId,
              callerId: userId,
              callerName: caller?.full_name || 'AZ User',
              callType,
              conversationId: convId,
              offer: payload.offer,
            });
          } else {
            db.prepare(`UPDATE calls SET status = 'missed', ended_at = datetime('now') WHERE id = ?`).run(callId);
            createNotification({
              userId: calleeId,
              type: callType === 'video' ? 'incoming_video_call' : 'incoming_audio_call',
              title: `Missed ${callType} call from ${caller?.full_name || 'User'}`,
              body: `You missed a ${callType} call on AZ RENTAL.`,
              titleAm: `ያመለጠዎት የ${callType === 'video' ? 'ቪዲዮ' : 'ድምፅ'} ጥሪ`,
              bodyAm: `ከ ${caller?.full_name || 'ተጠቃሚ'} የቀረበልዎት ጥሪ አምልጦዎታል።`,
              link: '/messages',
            });
            ws.send(JSON.stringify({ event: 'call:unavailable', payload: { callId, reason: 'User offline' } }));
          }
          return;
        }

        if (event === 'call:answer' && payload.callId && payload.callerId) {
          const callId = Number(payload.callId);
          db.prepare(`UPDATE calls SET status = 'active', answered_at = datetime('now') WHERE id = ?`).run(callId);
          pushRealtimeToUser(Number(payload.callerId), 'call:answered', {
            callId,
            answer: payload.answer,
          });
          return;
        }

        if (event === 'call:ice-candidate' && payload.targetUserId) {
          pushRealtimeToUser(Number(payload.targetUserId), 'call:ice-candidate', {
            callId: Number(payload.callId),
            candidate: payload.candidate,
            fromUserId: userId,
          });
          return;
        }

        if (event === 'call:reject' && payload.callId && payload.callerId) {
          const callId = Number(payload.callId);
          db.prepare(`UPDATE calls SET status = 'rejected', ended_at = datetime('now') WHERE id = ?`).run(callId);
          pushRealtimeToUser(Number(payload.callerId), 'call:rejected', { callId });
          return;
        }

        if (event === 'call:end' && payload.callId) {
          const callId = Number(payload.callId);
          const row = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId) as any;
          if (row) {
            const wasActive = row.status === 'active' && row.answered_at;
            const newStatus = wasActive ? 'completed' : 'missed';
            db.prepare(
              `UPDATE calls SET status = ?, ended_at = datetime('now'),
               duration_seconds = CASE WHEN answered_at IS NOT NULL THEN CAST((julianday('now') - julianday(answered_at)) * 86400 AS INTEGER) ELSE 0 END
               WHERE id = ?`
            ).run(newStatus, callId);
            const otherId = row.caller_id === userId ? row.callee_id : row.caller_id;
            pushRealtimeToUser(otherId, 'call:ended', { callId, status: newStatus });
            if (newStatus === 'missed' && row.caller_id === userId) {
              createNotification({
                userId: row.callee_id,
                type: 'missed_call',
                title: 'Missed Call',
                body: 'You have a missed call on AZ RENTAL.',
                titleAm: 'ያመለጠዎት ጥሪ',
                bodyAm: 'በ AZ RENTAL ላይ ያመለጠዎት ጥሪ አለ።',
                link: '/messages',
              });
            }
          }
        }
      } catch {
        // ignore malformed websocket payload
      }
    });

    ws.on('close', () => {
      const set = userSockets.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          userSockets.delete(userId);
        }
      }
      broadcastPresence();
    });
  });
}
