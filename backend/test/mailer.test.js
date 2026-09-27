// The SMTP path of lib/mailer.js (Gmail app passwords), against a tiny fake
// SMTP server, so the real nodemailer code runs without any network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

const received = { auth: null, from: null, to: [], data: '' };
let server;

before(async () => {
  server = net.createServer((sock) => {
    let inData = false;
    let buf = '';
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; sock.write('250 queued\r\n'); } else received.data += `${line}\n`;
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') sock.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (cmd === 'AUTH') { received.auth = Buffer.from(line.split(' ')[2] || '', 'base64').toString(); sock.write('235 ok\r\n'); }
        else if (cmd === 'MAIL') { received.from = line; sock.write('250 ok\r\n'); }
        else if (cmd === 'RCPT') { received.to.push(line); sock.write('250 ok\r\n'); }
        else if (cmd === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (cmd === 'QUIT') { sock.end('221 bye\r\n'); }
        else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  delete process.env.RESEND_API_KEY;
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(server.address().port);
  process.env.SMTP_USER = 'aninest.app@gmail.com';
  process.env.SMTP_PASS = 'abcd efgh ijkl mnop';
});

after(() => new Promise((r) => server.close(r)));

test('with SMTP_USER and SMTP_PASS, mail goes out over SMTP from that address', async () => {
  const { isMailEnabled, sendMail } = await import('../src/lib/mailer.js');
  assert.equal(isMailEnabled(), true);
  await sendMail({ to: 'someone@example.com', subject: 'Reset your AniNest password', text: 'Hi there' });
  assert.equal(received.auth, '\u0000aninest.app@gmail.com\u0000abcd efgh ijkl mnop');
  assert.match(received.from, /<aninest\.app@gmail\.com>/);
  assert.deepEqual(received.to.map((l) => l.match(/<(.+)>/)[1]), ['someone@example.com']);
  assert.match(received.data, /Subject: Reset your AniNest password/);
  assert.match(received.data, /From: AniNest <aninest\.app@gmail\.com>/);
  assert.match(received.data, /Hi there/);
});
