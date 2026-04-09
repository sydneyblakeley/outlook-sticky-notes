# 📌 Outlook Sticky Notes Add-in

Private sticky notes attached to your Outlook calendar meetings — visible only to you, synced across desktop and web via OneDrive.

---

## How it works

- Every calendar event (including individual occurrences of recurring series) gets its own private note
- Notes are saved to a single file in your **OneDrive app folder** (`outlookStickyNotes.json`) — hidden from your regular OneDrive files, no clutter
- If you're offline, notes fall back to local browser storage automatically
- Nobody else can see your notes — they never touch the meeting invite

---

## Setup Instructions

### Step 1 — Host the add-in files

You need to serve these files over HTTPS. The easiest free option:

#### Option A: GitHub Pages (recommended, free)
1. Create a free GitHub account at github.com if you don't have one
2. Create a new repository (e.g. `outlook-sticky-notes`), set it to **Public**
3. Upload all files from this folder into the repo
4. Go to **Settings → Pages → Source → Deploy from branch (main)**
5. Your add-in URL will be: `https://YOUR-USERNAME.github.io/outlook-sticky-notes/`
6. Open `manifest.xml` and replace every `https://localhost:3000` with your GitHub Pages URL

#### Option B: Any static hosting (Netlify, Vercel, Azure Static Web Apps)
Same idea — upload files, get an HTTPS URL, update manifest.xml.

---

### Step 2 — Register the app in Azure (for OneDrive sync)

This lets the add-in access your OneDrive to save notes.

1. Go to https://portal.azure.com → **Azure Active Directory → App registrations → New registration**
2. Name: `Outlook Sticky Notes`
3. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
4. Redirect URI: `https://YOUR-HOSTED-URL/taskpane.html`
5. Click **Register**
6. Copy the **Application (client) ID**
7. Go to **API permissions → Add a permission → Microsoft Graph → Delegated**
   - Add: `Files.ReadWrite.AppFolder`, `offline_access`
8. Click **Grant admin consent** (or ask your IT admin)

> **Personal Microsoft accounts (Outlook.com):** Azure registration is still needed but you can skip the admin consent step.

---

### Step 3 — Sideload the manifest into Outlook

#### Outlook on the Web (OWA)
1. Open https://outlook.office.com
2. Go to **Settings (gear icon) → View all Outlook settings → Mail → Customize actions**
   — OR go to any calendar event → **... More options → Get Add-ins**
3. Click **My add-ins → Add a custom add-in → Add from file**
4. Upload `manifest.xml`
5. Done! Open any calendar event and you'll see a **📌 Sticky Note** button in the ribbon

#### Outlook Desktop (Windows)
1. Open Outlook
2. Go to **File → Manage Add-ins** (opens OWA settings in browser)
3. Follow the same OWA steps above — it applies to desktop too

#### Outlook Desktop (Mac)
1. Open Outlook → **Tools → Add-ins**
2. Click **+** → **Add from file** → select `manifest.xml`

---

## Files in this package

| File | Purpose |
|------|---------|
| `manifest.xml` | Tells Outlook about the add-in (name, icons, URLs) |
| `taskpane.html` | The sticky note UI + all logic |
| `commands.html` | Required placeholder for ribbon commands |
| `README.md` | This file |

---

## Updating the manifest URL

Every `https://localhost:3000` in `manifest.xml` needs to be replaced with your hosted URL before sideloading. Example:

```
https://localhost:3000/taskpane.html
→
https://yourusername.github.io/outlook-sticky-notes/taskpane.html
```

---

## Notes on recurring meetings

Each **occurrence** of a recurring series gets its own independent note, identified by Outlook's unique item ID for that occurrence. So your Monday standup on April 14 and April 21 each have separate sticky notes — no overlap.

---

## Privacy & data

- Notes are stored in your **OneDrive app folder** — a hidden system folder only accessible by this add-in
- Nobody else can read them
- The meeting invite is never modified
- To delete all notes: delete the file `outlookStickyNotes.json` from OneDrive → Apps → Outlook Sticky Notes
