import { SMTPServer } from 'smtp-server';
import * as http from 'http';

interface StoredEmail {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  html: string;
}

const inbox: StoredEmail[] = [];

const smtpServer = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  onData(stream, session, callback) {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
    });
    stream.on('end', () => {
      const from = session.envelope.mailFrom ? session.envelope.mailFrom.address : 'noreply@meetifyy.app';
      const to = session.envelope.rcptTo.map((r: any) => r.address).join(', ');

      let subject = 'No Subject';
      const subjectMatch = buffer.match(/^Subject:\s*(.*)$/im);
      if (subjectMatch) {
        subject = subjectMatch[1].trim();
      }

      let html = '';
      const htmlStart = buffer.indexOf('<html');
      const htmlEnd = buffer.lastIndexOf('</html>');
      if (htmlStart !== -1 && htmlEnd !== -1) {
        html = buffer.substring(htmlStart, htmlEnd + 7);
      } else {
        html = `<pre style="font-family:monospace;padding:20px;">${buffer}</pre>`;
      }

      const email: StoredEmail = {
        id: Date.now().toString() + '_' + Math.floor(Math.random() * 1000),
        from,
        to,
        subject,
        date: new Date().toLocaleTimeString(),
        html,
      };

      inbox.unshift(email);
      console.log(`[Mailpit 1025] Received: "${subject}" -> ${to}`);
      callback();
    });
  },
});

const httpServer = http.createServer((req, res) => {
  const reqUrl = req.url || '/';

  if (reqUrl === '/api/emails') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(inbox));
    return;
  }

  if (reqUrl.startsWith('/email/')) {
    const id = reqUrl.replace('/email/', '');
    const email = inbox.find((e) => e.id === id);
    if (email) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(email.html);
      return;
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Mailpit - Local Mail Server</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { display: flex; height: 100vh; background: #0f172a; color: #f8fafc; }
    #sidebar { width: 340px; background: #1e293b; border-right: 1px solid #334155; display: flex; flex-direction: column; }
    #header { padding: 18px 20px; background: #0f172a; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; }
    #header h1 { font-size: 18px; color: #38bdf8; font-weight: 700; }
    #header span { font-size: 12px; background: #0284c7; color: #fff; padding: 2px 8px; border-radius: 12px; }
    #list { flex: 1; overflow-y: auto; }
    .email-card { padding: 16px 20px; border-bottom: 1px solid #334155; cursor: pointer; transition: background 0.15s; }
    .email-card:hover { background: #334155; }
    .email-card.active { background: #4f46e5; color: #fff; }
    .email-subject { font-weight: 600; font-size: 14px; margin-bottom: 6px; }
    .email-to { font-size: 12px; opacity: 0.8; }
    .email-date { font-size: 11px; opacity: 0.6; float: right; }
    #main { flex: 1; display: flex; flex-direction: column; background: #f8fafc; }
    #preview-header { padding: 16px 24px; background: #ffffff; border-bottom: 1px solid #e2e8f0; color: #0f172a; display: none; }
    #preview-frame { flex: 1; border: none; width: 100%; height: 100%; background: #ffffff; }
    #empty { flex: 1; display: flex; align-items: center; justify-content: center; color: #64748b; font-size: 16px; }
  </style>
</head>
<body>
  <div id="sidebar">
    <div id="header">
      <h1>📬 Mailpit Server</h1>
      <span id="count">${inbox.length} msgs</span>
    </div>
    <div id="list"></div>
  </div>
  <div id="main">
    <div id="preview-header">
      <h2 id="view-subject" style="font-size: 20px; margin-bottom: 6px; color: #0f172a;"></h2>
      <p id="view-to" style="font-size: 13px; color: #64748b;"></p>
    </div>
    <iframe id="preview-frame" style="display:none;"></iframe>
    <div id="empty">Select an email from the left sidebar to preview</div>
  </div>

  <script>
    let selectedId = null;

    async function loadEmails() {
      try {
        const res = await fetch('/api/emails');
        const emails = await res.json();
        document.getElementById('count').innerText = emails.length + ' msgs';
        const list = document.getElementById('list');
        list.innerHTML = '';

        emails.forEach((e, idx) => {
          const card = document.createElement('div');
          card.className = 'email-card' + (e.id === selectedId || (!selectedId && idx === 0) ? ' active' : '');
          card.innerHTML = '<span class="email-date">' + e.date + '</span><div class="email-subject">' + e.subject + '</div><div class="email-to">To: ' + e.to + '</div>';
          card.onclick = () => showEmail(e, card);
          list.appendChild(card);
        });

        if (emails.length > 0 && !selectedId) {
          showEmail(emails[0], list.children[0]);
        }
      } catch (err) {
        console.error(err);
      }
    }

    function showEmail(e, cardEl) {
      selectedId = e.id;
      document.querySelectorAll('.email-card').forEach(c => c.classList.remove('active'));
      if (cardEl) cardEl.classList.add('active');

      document.getElementById('preview-header').style.display = 'block';
      document.getElementById('preview-frame').style.display = 'block';
      document.getElementById('empty').style.display = 'none';

      document.getElementById('view-subject').innerText = e.subject;
      document.getElementById('view-to').innerText = 'From: ' + e.from + ' | To: ' + e.to + ' | Time: ' + e.date;
      document.getElementById('preview-frame').src = '/email/' + e.id;
    }

    setInterval(loadEmails, 2000);
    loadEmails();
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

const SMTP_PORT = parseInt(process.env.SMTP_PORT || '1025', 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '8025', 10);

smtpServer.listen(SMTP_PORT, '0.0.0.0', () => {
  console.log(`Mailpit SMTP Server listening on port ${SMTP_PORT}`);
});

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`Mailpit Web UI server listening on http://localhost:${HTTP_PORT}`);
});
