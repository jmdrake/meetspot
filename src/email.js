// Email delivery. With RESEND_API_KEY set, mail goes out through Resend (resend.com);
// otherwise it is printed to the server log, which is enough for local testing.
export async function sendEmail({ to, subject, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`\n--- email to ${to} ---\n${subject}\n${text}\n---------------------\n`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || 'MeetSpot <login@meetspot.app>', to, subject, text }),
  });
  if (!res.ok) throw new Error(`Email failed: ${res.status} ${await res.text()}`);
}
