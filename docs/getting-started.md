# Getting started with Job Tracker

A walk-through for your first half hour: install the app, add your first company and application, then try the parts that save the most typing.

Everything stays on your own computer. There's no account and no cloud, and nobody else can see your data.

## 1. Install it (about 5 minutes)

You need:

- **Node.js 20 or newer** (the LTS version from [nodejs.org](https://nodejs.org) is fine). Check with `node --version` in a terminal.
- **Git**, or download the code as a ZIP instead (on GitHub: **Code → Download ZIP**, then unzip it).
- **Chrome or Edge**, if you want the browser extension.

Then, in a terminal:

```bash
git clone https://github.com/TheCoderOmar/job-applications.git
cd job-applications
npm install
npm run dev
```

> **On Windows PowerShell**, if `npm` says running scripts is disabled, type `npm.cmd install` and `npm.cmd run dev` instead.

Open **http://localhost:5173** in your browser. Keep the terminal open: closing it stops the app. Next time, you only need `npm run dev` from the same folder.

Your data goes into `data/jobs.db`, which is created on the first run. You start with an empty tracker of your own.

## 2. A quick look around

The menu on the left has everything:

| Page | What it's for |
| --- | --- |
| **Dashboard** | Your numbers at a glance and a flow chart of where your applications ended up. |
| **Companies** | Every company you're interested in, with logo, details and location. |
| **Applications** | The jobs you've applied for and the stage each one is at. |
| **CVs** | The versions of your CV, so you know which one you sent where. |
| **Quiz** | Practice interview questions (import your own question sets). |
| **Openings** | Jobs your companies have open right now. |
| **Contacts** | Your LinkedIn connections and who you've talked to. |
| **Map** | Your companies on a map. |
| **Settings** | Stages, imports and backups. |

## 3. Add your first company

1. Go to **Companies → Add company**.
2. Paste the company's LinkedIn page link (for example `https://www.linkedin.com/company/acme`). The form fills itself in: name, website, industry, size, headquarters, about text and logo. You can also click **Fill from LinkedIn**.
3. Optional: paste a **Google Maps link** to the office, and the map pin is set for you. Tick **Remote** for companies without an office near you.
4. Save.

If LinkedIn says it has no company page at that link, open the company on LinkedIn and copy the address from the browser bar. The name after `/company/` is often shorter than you'd guess.

## 4. Log your first application

1. Go to **Applications → Log application** (or use the button on the Dashboard).
2. Pick the company, type the job title and paste the job description or the job link. A LinkedIn job link or a recruiter's LinkedIn post fills the description for you.
3. Choose **Applied via** (email, company website, LinkedIn or other) and which CV you sent (**CV sent**).
4. Save.

As things move along, change the job's **stage**: Screening → HR interview → Technical interview → Final interview, and so on. If a company goes quiet for 60 days, the app marks the job **Ghosted** for you.

Click ☆ on any job you care about most: starred jobs stay at the top.

## 5. Install the browser extension (recommended)

The extension adds the job you're looking at in one click, so you never copy and paste a job again.

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension` folder inside the app's folder.
4. Pin **Job Tracker Importer** to your toolbar.

Now open a job on LinkedIn, Workable, Indeed or Wuzzuf and click the extension's icon → **Import to Job Tracker**. A small **Log application** window opens, already filled in. Check it and save.

The app must be running (`npm run dev`) for this to work. The extension shows a green dot when it can reach the app.

## 6. Bring in your LinkedIn contacts

This shows you who you know at each company and who could refer you.

1. On LinkedIn: **Settings & Privacy → Data privacy → Get a copy of your data**, tick **Connections** and request it. LinkedIn emails you a `.zip` file, usually within minutes.
2. In the app: **Contacts → Import LinkedIn export**, then pick that `.zip` as it is (no need to unzip it).

Each company and job page now lists **your connections there**. People you've messaged with get a green **Talked** tag. Only the counts are kept, never what you wrote. You can import again later; nobody is added twice.

When you log an application, add up to three people under **Referred by**.

## 7. Find open jobs at your companies

Go to **Openings → Find openings**. The app checks each company's LinkedIn jobs and its own careers page, then lists what's open. Search with words like `java cairo`, star the ones you like, and hide the rest.

When you apply to one, click **I applied** and it becomes an application.

## 8. Keep a backup

Your whole tracker is one file, `data/jobs.db`. Every so often, go to **Settings → Export backup (JSON)** and keep the file somewhere safe. **Settings → Import JSON or CSV** loads a backup back in, and also takes CSV if you're moving from a spreadsheet (open **Import formats** on that page to see the columns).

## Something not working?

- **The page won't open:** check the terminal is still open and `npm run dev` is running without errors.
- **The extension shows a red dot:** start the app first. If your app runs at a different address, change it under **App address** in the extension's popup.
- **"Fill from LinkedIn" fails:** LinkedIn sometimes blocks requests for a while. Try again later, or fill the company in by hand.
- **After updating the code:** run `npm install` again, and click **Reload** on the extension's card at `chrome://extensions`.

For every feature in detail, see the [README](../README.md).
