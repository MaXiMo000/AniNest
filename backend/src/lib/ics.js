// Minimal iCalendar (RFC 5545) writer for the airing-calendar feed. Pure.
// The details that calendar apps are strict about: CRLF line endings, TEXT
// values escaped, times in UTC, and lines folded at 75 octets (bytes, not
// characters, so a Japanese title is never cut mid-character).

export function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

export function foldLine(line) {
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    // The first line may hold 75 octets; continuation lines start with a space.
    if (bytes + size > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function icsDate(epochSeconds) {
  return new Date(epochSeconds * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// events: [{ uid, start (epoch s), minutes, summary, description, url }]
export function buildCalendar({ name, events, now = Date.now() }) {
  const stamp = icsDate(Math.floor(now / 1000));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AniNest//Airing calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    // Hints for how often apps should re-fetch (Apple and Outlook honour them).
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(e.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.start + (e.minutes || 24) * 60)}`,
      `SUMMARY:${escapeText(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
