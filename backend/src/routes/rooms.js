import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { cached } from '../lib/cache.js';
import { requireAuth } from '../middleware/session.js';
import { anilistTopForGroup } from '../lib/anilist.js';
import { GENRES, affinityFromList, affinityFromGenres, seenBy, rankForGroup } from '../lib/watchRooms.js';

// Watch Together: one person (signed in) opens a room and shares its code;
// friends join signed in or as guests; everyone swipes on candidates; the
// room shows the three picks that suit the whole group (lib/watchRooms.js).
// The code is the room's address (like a meeting link), so reading a room
// needs no account; voting needs the member token handed out on joining.
export const roomsRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const ROOM_HOURS = 24;
const MAX_MEMBERS = 8;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to misread
const CODE_RE = /^[A-Z2-9]{6}$/;
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
const newToken = () => crypto.randomBytes(24).toString('base64url');

let fetchPool = anilistTopForGroup;
// Test hook: the suite never calls AniList.
export function setRoomPoolFetcher(fn) {
  fetchPool = fn || anilistTopForGroup;
}

async function findRoom(code) {
  if (!CODE_RE.test(code)) return null;
  const res = await db.execute({ sql: "SELECT id, code, expires_at FROM watch_rooms WHERE code = ? AND expires_at > datetime('now')", args: [code] });
  return res.rows[0] || null;
}

// The member cap is part of the INSERT itself, so people joining at the same
// moment can't all pass a separate count check. null when the room is full.
async function addMember(roomId, { userId = null, name, genres = null }) {
  const token = newToken();
  const res = await db.execute({
    sql: `INSERT INTO watch_room_members (room_id, user_id, name, genres, token)
          SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM watch_room_members WHERE room_id = ?) < ?`,
    args: [roomId, userId, name, genres ? JSON.stringify(genres) : null, token, roomId, MAX_MEMBERS],
  });
  return res.rowsAffected ? { memberId: Number(res.lastInsertRowid), memberToken: token } : null;
}

roomsRouter.post('/', requireAuth, asyncRoute(async (req, res) => {
  await db.execute("DELETE FROM watch_rooms WHERE expires_at <= datetime('now')");
  let code;
  for (let i = 0; i < 5 && !code; i += 1) {
    const candidate = newCode();
    const clash = await db.execute({ sql: 'SELECT 1 FROM watch_rooms WHERE code = ?', args: [candidate] });
    if (!clash.rows.length) code = candidate;
  }
  if (!code) return res.status(503).json({ error: 'Couldn’t make a room right now — try again.' });
  const room = await db.execute({
    sql: `INSERT INTO watch_rooms (code, created_by, expires_at) VALUES (?, ?, datetime('now', '+${ROOM_HOURS} hours'))`,
    args: [code, req.user.id],
  });
  const member = await addMember(Number(room.lastInsertRowid), { userId: req.user.id, name: req.user.username });
  res.status(201).json({ code, ...member });
}));

const guestSchema = z.object({
  name: z.string().trim().min(1).max(20),
  genres: z.array(z.enum(GENRES)).min(1).max(5),
});

// Signed-in: join as yourself (again returns your existing seat). Guest:
// a display name and 1-5 favourite genres.
roomsRouter.post('/:code/join', asyncRoute(async (req, res) => {
  const room = await findRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'That room doesn’t exist or has expired.' });

  if (req.user) {
    const mine = await db.execute({ sql: 'SELECT id, token FROM watch_room_members WHERE room_id = ? AND user_id = ?', args: [room.id, req.user.id] });
    if (mine.rows[0]) return res.json({ memberId: Number(mine.rows[0].id), memberToken: mine.rows[0].token });
  }
  let seat;
  if (req.user) {
    seat = await addMember(room.id, { userId: req.user.id, name: req.user.username });
  } else {
    const parsed = guestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Pick a name and 1 to 5 genres you like.' });
    seat = await addMember(room.id, { name: parsed.data.name, genres: parsed.data.genres });
  }
  if (!seat) return res.status(409).json({ error: `Rooms hold up to ${MAX_MEMBERS} people.` });
  res.status(201).json(seat);
}));

const voteSchema = z.object({
  memberToken: z.string().min(20).max(64),
  mal_id: z.number().int().positive(),
  vote: z.union([z.literal(1), z.literal(-1)]),
});

roomsRouter.post('/:code/vote', asyncRoute(async (req, res) => {
  const room = await findRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'That room doesn’t exist or has expired.' });
  const parsed = voteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid vote.' });
  const member = await db.execute({ sql: 'SELECT id FROM watch_room_members WHERE token = ? AND room_id = ?', args: [parsed.data.memberToken, room.id] });
  if (!member.rows[0]) return res.status(403).json({ error: 'Join the room first.' });
  await db.execute({
    sql: `INSERT INTO watch_room_votes (member_id, mal_id, vote) VALUES (?, ?, ?)
          ON CONFLICT(member_id, mal_id) DO UPDATE SET vote = excluded.vote`,
    args: [member.rows[0].id, parsed.data.mal_id, parsed.data.vote],
  });
  res.json({ ok: true });
}));

async function memberTaste(m) {
  if (!m.user_id) {
    let genres = [];
    try { genres = JSON.parse(m.genres || '[]'); } catch { /* none */ }
    return { id: Number(m.id), affinity: affinityFromGenres(genres), seen: [] };
  }
  const [favs, reviews] = await Promise.all([
    db.execute({ sql: 'SELECT mal_id, status, genres FROM favorites WHERE user_id = ?', args: [m.user_id] }),
    db.execute({ sql: 'SELECT mal_id, rating FROM reviews WHERE user_id = ?', args: [m.user_id] }),
  ]);
  const favorites = favs.rows.map((f) => {
    let genres = [];
    try { genres = JSON.parse(f.genres || '[]'); } catch { /* none */ }
    return { mal_id: Number(f.mal_id), status: f.status, genres };
  });
  const ratings = new Map(reviews.rows.map((r) => [Number(r.mal_id), Number(r.rating)]));
  return { id: Number(m.id), affinity: affinityFromList(favorites, ratings), seen: seenBy(favorites) };
}

// The pool: well-rated shows overall plus the genres the group leans towards
// most (up to 4), each list cached for 6 hours.
async function candidatePool(members) {
  const weight = new Map();
  members.forEach((m) => [...m.affinity].sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([g, x]) => weight.set(g, (weight.get(g) || 0) + x)));
  const genres = [...weight].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g]) => g);
  const lists = await Promise.all([null, ...genres].map((g) => cached(`room-pool:${g || 'all'}`, 6 * 60 * 60 * 1000, () => fetchPool(g))));
  const byId = new Map();
  lists.flat().forEach((s) => byId.set(s.mal_id, s));
  return [...byId.values()];
}

// Room state for everyone in it (and anyone with the code). `candidates` is
// the swipe deck, best-first; `picks` appear once two people have joined.
roomsRouter.get('/:code', asyncRoute(async (req, res) => {
  const room = await findRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'That room doesn’t exist or has expired.' });
  const rows = (await db.execute({ sql: 'SELECT id, user_id, name, genres FROM watch_room_members WHERE room_id = ? ORDER BY id', args: [room.id] })).rows;
  const votes = (await db.execute({
    sql: 'SELECT v.member_id, v.mal_id, v.vote FROM watch_room_votes v JOIN watch_room_members m ON m.id = v.member_id WHERE m.room_id = ?',
    args: [room.id],
  })).rows.map((v) => ({ member_id: Number(v.member_id), mal_id: Number(v.mal_id), vote: Number(v.vote) }));

  const members = await Promise.all(rows.map(memberTaste));
  const ranked = rankForGroup(members, await candidatePool(members), votes);
  const card = ({ mal_id, title, images, type, episodes, year, score, genres, everyoneLikes, likes }) => ({ mal_id, title, images, type, episodes, year, score, genres, everyoneLikes, likes });

  res.json({
    code: room.code,
    expiresAt: room.expires_at,
    members: rows.map((m) => ({
      id: Number(m.id), name: m.name, guest: !m.user_id, votes: votes.filter((v) => v.member_id === Number(m.id)).length,
    })),
    candidates: ranked.slice(0, 20).map(card),
    picks: rows.length >= 2 ? ranked.slice(0, 3).map(card) : [],
  });
}));
