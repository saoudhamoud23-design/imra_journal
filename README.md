# My Little Journal

A private notebook she can install on her Android phone: thoughts, photos, little wins, moods, and things she doesn't want to forget. Now and then it brings back one of her happy moments.

Everything she writes stays on her phone (no account, no server).

## 1. Customize it (5 minutes)

Open `gift.js` and fill in:

- `herName`, `fromName`, `welcome`: the welcome screen she sees first.
- `entries`: the first one or two entries you're leaving for her. Replace the `REPLACE ME` text with something specific. To add a photo, make a `gift/` folder next to `gift.js`, drop the image in, and set `photo: "gift/first-date.jpg"`.

If you rename the app, also change `name` / `short_name` in `manifest.webmanifest` and `<title>` in `index.html`.

## 2. Try it on your computer

```
cd journal
python3 -m http.server 8000
```

Open http://localhost:8000 in Chrome.

## 3. Put it online (free, needs HTTPS)

Any of these works; the whole folder is the site:

- **Netlify Drop**: go to app.netlify.com/drop and drag the `journal` folder in.
- **Cloudflare Pages** or **GitHub Pages**: upload the folder as a static site.

## 4. Install it on her phone

1. Send her the link and open it in **Chrome**.
2. Chrome menu (⋮) → **Install app** (or *Add to Home screen*).
3. Open it from the home screen. Tap **Yes, please** on the reminders card and allow notifications.

## Things worth knowing

- **Your gift messages are in `gift.js`, which is publicly fetchable** by anyone who has the link. Keep them sweet rather than secret, and don't share the link around. After she has opened the app once, those entries are saved on her phone, so you can re-upload the site with an emptied `entries: []` list.
- **Reminder timing is Android's call.** Reminders use Chrome's background sync for installed apps. They are best-effort: they usually arrive roughly on schedule once the app is installed and used regularly, but not to the minute. There's a "Send me a test" button in the Me tab.
- **If she clears Chrome's data or changes phones, the journal goes with it** unless she's saved a backup (Me → Save a backup).
- **The PIN lock** keeps casual snoops out. It doesn't encrypt the data on the phone.
- Updating the site later: re-upload the folder. She gets the new version the next time she opens the app online.
