# Getting started with Job Tracker

A walk-through for your first half hour: install the app, add your first company and application, then try the parts that save the most typing.

Everything stays on your own computer. There's no account and no cloud, and nobody else can see your data.

## 1. Install it (about 5 minutes)

You need:

- **Node.js 20 or newer** (the LTS version from [nodejs.org](https://nodejs.org) is fine). Check with `node --version` in a terminal.
- **Git**, or download the code as a ZIP instead (on GitHub: **Code → Download ZIP**, then unzip it).
- **Chrome or Edge**, if you want the browser extension.

Then get the code:

```bash
git clone https://github.com/TheCoderOmar/job-applications.git
```

**On Windows:** open the `job-applications` folder and double-click **`setup.bat`**. It installs what the app needs and puts a **Job Tracker** icon on your desktop. From then on, just open the app from that icon: it starts the app if needed and opens it in your browser. (The small "Job Tracker server" window on the taskbar is the app running; closing it stops the app.)

**On Mac or Linux** (or if you prefer a terminal):

```bash
cd job-applications
npm install
npm run dev
```

Then open **http://localhost:5173**. Keep the terminal open: closing it stops the app.

Your data goes into `data/jobs.db`, which is created on the first run. You start with **228 companies** already in (tech companies, banks and Egypt's biggest employers, plus the Gulf, with their offices and logos) and nothing else: your applications and contacts are yours alone.

**Updates come by themselves:** when there's a new version on GitHub, a card in the corner says **Update available**. Click **Update now** and the app restarts with it. It checks when it starts and every 6 hours; **Settings → Check for updates** checks right away. (Use `git clone`, not the ZIP download, for this to work.)

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

The quickest way is the browser extension (step 5): open the company's LinkedIn page and click **Import company**. By hand:

1. Go to **Companies → Add company**.
2. Paste the company's LinkedIn page link (for example `https://www.linkedin.com/company/acme`). The form fills itself in: name, website, industry, size, headquarters, about text, logo, and every office LinkedIn lists. You can also click **Fill from LinkedIn**.
3. Each office is put on the map from its address when you save. To pin one exactly, paste its **Google Maps link**. Tick **Remote** for companies without an office near you.
4. Save.

If LinkedIn says it has no company page at that link, open the company on LinkedIn and copy the address from the browser bar. The name after `/company/` is often shorter than you'd guess.

## 4. Log your first application

1. Go to **Applications → Log application** (or use the button on the Dashboard).
2. Pick the company (or **+ New company…** to type one you don't have yet), type the job title and paste the job description or the job link. A LinkedIn job link or a recruiter's LinkedIn post fills the description for you.
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

Now click the extension's icon on:

- **a job** on LinkedIn, Workable, Indeed or Wuzzuf → **Import job**: a small **Log application** window opens, already filled in;
- **a recruiter's LinkedIn post** → **Import job from post**: the post becomes the job description, with the company it's for;
- **a LinkedIn company page** → **Import company**: the company and all its offices;
- **someone's LinkedIn profile** → **Import contact**: the person, plus their company if you don't have it.

Check the window and save. Companies you don't have yet are added for you.

The app must be running for this to work (open it from the desktop icon). The extension shows a green dot when it can reach the app.

## 6. Bring in your LinkedIn contacts

This shows you who you know at each company and who could refer you.

1. On LinkedIn: **Settings & Privacy → Data privacy → Get a copy of your data**, tick **Connections** and request it. LinkedIn emails you a `.zip` file, usually within minutes.
2. In the app: **Contacts → Import LinkedIn export**, then pick that `.zip` as it is (no need to unzip it).

Each company and job page now lists **your connections there**. People you've messaged with get a green **Talked** tag. Only the counts are kept, never what you wrote. You can import again later; nobody is added twice.

Keep track of where you stand with each person: set their **Status** (Message sent, Chatting, Referred) in the list, and click ☆ to put the people who matter most on the **Favourites** tab.

When you log an application, add up to three people under **Referred by**.

## 7. Find open jobs at your companies

Go to **Openings → Find openings**. The app checks each company's LinkedIn jobs and its own careers page, then lists what's open. Search with words like `java cairo`, star the ones you like, and hide the rest.

When you apply to one, click **I applied** and it becomes an application.

## 8. Keep a backup

Your whole tracker is one file, `data/jobs.db`. Every so often, go to **Settings → Export backup (JSON)** and keep the file somewhere safe. **Settings → Import JSON or CSV** loads a backup back in, and also takes CSV if you're moving from a spreadsheet (open **Import formats** on that page to see the columns).

## Something not working?

- **The page won't open:** open it from the desktop icon again. If it still won't, look at the "Job Tracker server" window on the taskbar (or your terminal) for an error.
- **A pin is in the wrong place:** open the company, click **Find on Google Maps** next to that office, copy the place's link and paste it into the office's **Google Maps link**.
- **The extension shows a red dot:** start the app first. If your app runs at a different address, change it under **App address** in the extension's popup.
- **"Fill from LinkedIn" fails:** LinkedIn sometimes blocks requests for a while. Try again later, or fill the company in by hand.
- **After an update:** click **Reload** on the extension's card at `chrome://extensions`, so it picks up the new version too.

For every feature in detail, see the [README](../README.md).
