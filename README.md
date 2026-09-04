# The Ballot — simple event voting app

A static site (no server, no database to manage) where anyone can:
- Add a heading (e.g. "Saturday Night") and activities under it
- Vote **Yes / No** on each activity
- Add and vote on **suggestions** under each activity
- Add and vote on **dress code** options

Voter names are only visible to the **admin** — everyone else just sees vote counts.
The admin can also see who added each item, and delete activities or dress options.

Everything is 3 files: `index.html`, `app.js`, `config.js`. No build step.

---

## 1. Get a free shared "storage" bin (2 minutes)

Netlify only hosts static files — it can't remember votes on its own. So this app
stores its data in a tiny free JSON store called **jsonbin.io**, instead of a real
database.

1. Go to https://jsonbin.io and create a free account.
2. Click **Create Bin**, and paste this exact starting content:
   ```json
   {"events":[],"dressCode":{"options":[]}}
   ```
3. Save it. Copy the **Bin ID** shown in the URL / bin details.
4. Go to **Account → API Keys** and copy your **X-Master-Key**.

## 2. Fill in `config.js`

Open `config.js` and paste in your values:

```js
JSONBIN_BIN_ID: "your bin id here",
JSONBIN_API_KEY: "your X-Master-Key here",
ADMIN_PASSWORD: "pick any password",
```

That's it — no other code needs to change.

> Note on the admin password: it's checked in the browser, not on a server.
> That's fine for a casual private event ballot among friends/coworkers, but
> don't reuse a real password and don't use this for anything sensitive.

## 3. Deploy to Netlify

**Easiest way (drag and drop):**
1. Go to https://app.netlify.com/drop
2. Drag the whole folder (`index.html`, `app.js`, `config.js`) onto the page.
3. Netlify gives you a live URL immediately. Share it with everyone.

**Or via Git:**
1. Push this folder to a GitHub repo.
2. In Netlify: **Add new site → Import an existing project** → pick the repo.
3. Leave the build command empty and set the publish directory to `/` (the
   repo root, since there's nothing to build).
4. Deploy.

## How it works

- Everyone who visits is asked for their name once (saved in their browser).
- Their name tags anything they add, and is recorded against their vote —
  but it's only ever shown to whoever is logged in as admin.
- Votes and additions are saved straight to your jsonbin bin, and every
  visitor's screen auto-refreshes every few seconds, so results stay live
  for everyone.
- Click **Admin** in the top right and enter the password from `config.js`
  to see who added/voted for what, and to delete activities or dress options.

## Limits to know about

- Photos are picked straight from the visitor's device (camera roll or
  camera) and are automatically resized/compressed in the browser before
  being saved, to keep the shared JSON store reasonably small. Even so,
  photos take up real space — jsonbin's free tier has a per-bin size cap,
  so a very photo-heavy event could bump into it. If that happens, delete
  a few photos as admin, or ask people to keep photo count modest.
- jsonbin's free tier has a request limit (generous for a single event, but
  not built for huge scale) — fine for a team, a party, a wedding, etc.
- Voting identity is just "whatever name you typed," stored in your browser —
  there's no login/password per voter, so it's an honor system, not
  tamper-proof. This matches the "keep it simple" brief; swap in real auth
  later if you ever need it.
- If two people save at almost the same instant, the very last save wins —
  fine at normal event scale, just not built for heavy concurrent traffic.
