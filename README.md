# MeetSpot

An activity-first social app: people find a plan, go, and meet there. This is **milestone 1** of the working prototype for the invite-only Nashville test group. The product spec lives in the MeetSpot Product Spec doc.

## What works in milestone 1

- **Invite-only sign-up.** Every member has an invite link; whoever invited a member is recorded permanently (the referral record).
- **No passwords.** Sign in with a 6-digit email code (expires in 10 minutes, works once, locks after 5 wrong tries), or with Google/Apple through Supabase.
- **Profiles:** first name, birth date, gender, intents, photo, bio, interests.
- **Activities:** create, edit, cancel (with reason), and delete when nobody is confirmed yet.
- **Discover** matches each activity's audience (intents, gender, age range). Hosts appear only as "F · 30s" until they invite you.
- **Request → review → invite → accept.** Hosts see requesters' photos but not names. Hosts can send more invites than spots; the first to accept get them.
- **First-come activities** confirm people instantly.
- **Waitlist** with timed offers: 6 hours when the activity is 2+ days away, 1 hour within 2 days, 15 minutes within 6 hours. An expired offer passes to the next person.
- **Re-confirm** when the host changes the time, place or cost; guests can then drop out with no penalty.
- **Check-in** by QR code, typed code, or the host tapping "Mark here". Confirmed guests not checked in 2 hours after the end become no-shows.
- **Late cancellations** (within 48 hours) and no-shows are counted per member.
- **Public places only** during testing. Home activities are switched off (`ALLOW_HOME_ACTIVITIES`) and come back later as friends-only.
- **Mail** for invites, offers, requests, changes and cancellations; **group chat** per activity.

Friends, Venues, Events, Moments and admin tools are the next milestones; their tabs show "coming soon".

## Run it on your computer

Needs Node.js 20+ and PostgreSQL 15+.

```bash
npm install
cp .env.example .env          # then set DATABASE_URL to your local database
createdb meetspot
npm run seed -- you@example.com --demo
npm run dev
```

Open http://localhost:3000/signin and sign in with that email. With `DEV_SHOW_CODES=1` the sign-in code appears on screen, so no email service is needed. `--demo` adds four sample hosts and activities.

Run the tests (they use a separate database, `meetspot_test`, which they wipe):

```bash
createdb meetspot_test
TEST_DATABASE_URL=postgres://localhost/meetspot_test npm test
```

## Put it online for testers

The recommended setup costs about $7/month: Render runs the app; Supabase (free tier) holds the database, photos and Google/Apple sign-in; Resend (free tier) sends sign-in emails.

1. **Supabase** (supabase.com): create a project.
   - Project Settings → Database → Connection string → **Session pooler** URI. This is `DATABASE_URL`. Use the pooler, not the direct connection, which needs IPv6.
   - Storage → New bucket → name `photos`, **Public**.
   - Project Settings → API: copy the Project URL (`SUPABASE_URL`), the `anon` public key (`SUPABASE_ANON_KEY`) and the `service_role` key (`SUPABASE_SERVICE_ROLE_KEY`, secret).
2. **Resend** (resend.com): add and verify your domain, create an API key (`RESEND_API_KEY`), and set `EMAIL_FROM`, such as `MeetSpot <login@yourdomain.com>`.
3. **Render** (render.com): New → Blueprint → choose this GitHub repo. Fill in the secrets it asks for. Set `APP_URL` to the Render address (or your own domain).
4. **First admin:** in Render → Shell, run `npm run seed -- you@example.com`. It prints your invite link.
5. **Google and Apple sign-in (optional):** in Supabase → Authentication → Providers, enable Google and Apple with their developer credentials. Under URL Configuration, set Site URL to `APP_URL` and add `APP_URL/auth/callback` as a redirect URL. The buttons appear once `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set.

The database tables are created automatically when the app starts.

## Project layout

```
db/migrations/      SQL schema (runs on any Postgres, including Supabase)
src/server.js       Express app and startup
src/auth.js         email codes, Supabase token exchange, sessions, invite-only rule
src/profile.js      profile, photo storage, invite link and referrals
src/activities.js   activity rules: capacity, invites, waitlist offers, check-in, cancellations, chat, mail
src/util.js         email normalization, codes, age ranges
public/             the web app (plain HTML, CSS and JavaScript modules, no build step)
scripts/seed.js     first admin and optional demo data
tests/              end-to-end API tests against a real database
```
