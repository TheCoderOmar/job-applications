# Job Tracker

Track companies, the jobs they post, and where each application stands. Includes a dark map of company locations and pipeline charts.

## Run

```bash
npm install      # first time only
npm run dev
```

Open http://localhost:5173. The API runs on port 3001, and Vite proxies `/api` to it.

Data is stored in `data/jobs.db` (SQLite). Back it up from **Settings → Export backup**.

## Adding locations

When you add or edit a company, paste a Google Maps link and the pin is set automatically. These link formats work:

- Short share links: `https://maps.app.goo.gl/...`
- Place links: `https://www.google.com/maps/place/.../@24.71,46.67,17z/...!3d24.71!4d46.67`
- Plain coordinates: `24.7114, 46.6744`

If a link has no coordinates, you can type the latitude and longitude yourself.

Mark a company as **Remote** to keep it off the map until **Show remote companies** is turned on.

## Bulk import

Go to **Settings → Import JSON or CSV**. Open **Import formats** on that page for the column names. A jobs CSV needs at least the columns `company` and `title`.

## Stages

You can rename, recolor, reorder, add, and delete stages in Settings. A job counts as **applied** once it moves past the first stage, and the applied date is set to that day automatically.

## Applications: channel, referrers, connections

- **Applied via**: Email, Company website, LinkedIn or Other, plus the address or link you used.
- **Referred by**: up to 3 people per application (optional). Pick from your contacts (connections at that company are listed first) or type a new name.
- **Contacts → Import LinkedIn export**: on LinkedIn go to *Settings & Privacy → Data privacy → Get a copy of your data*, tick **Connections** (or, if it isn't listed, choose the larger archive "including connections"), then pick the `.zip` LinkedIn emails you. Only `Connections.csv` and `messages.csv` are read from it. Import it again any time; nobody is duplicated. Each job and company page then lists **your connections at that company**.
- **Talked to**: from `messages.csv` the app keeps, per connection, how many conversations and messages you had, how many they sent, and the last date. Message text is never stored. People who replied show a green **Talked** tag and are listed first in "Your connections at …" and in the referrer picker.
- **Dashboard → Where applications went**: a flow chart from applications to each stage reached and how it ended. You can filter it by channel and by referred / not referred.

## Your data stays local

Everything is stored in `data/jobs.db` on your own computer. The file is created on first run and is gitignored, so each person who clones this repo starts with an empty database of their own. Set `JOBS_DB=path/to/file.db` to use a different file (handy for testing).

## Tests

```bash
npm test
```

## Companies from LinkedIn, logos, stars

- **Add company → LinkedIn company page**: paste a link like `linkedin.com/company/acme` and click **Fill from LinkedIn** (or just paste). It reads the public page and fills in the name, website, industry, size, founded, headquarters, about text and logo. Fields you already typed are kept.
- **Logos** are saved in your local database. They are looked up from the LinkedIn page, then the company website, then Google's icon cache, which only sees the domain. **Companies → Fetch missing logos** gets them for companies you already have. Click a logo on a company page to look it up again, use your own image, or remove it.
- **Interview stages**: Screening → HR interview → Technical interview → Final interview. When a job is closed (Rejected, Ghosted, Withdrawn), the app shows the furthest stage it reached, e.g. "Ghosted after Technical interview". The dashboard flow chart splits them the same way.
- **Stars**: click ☆ on any job (list, board or job page). Starred jobs sort to the top, and the **Starred** button filters to them.

## Applications vs openings

- **Applications** (the old Jobs page) is your log of what you applied for.
- **Openings** lists positions your companies have open right now. **Find openings** checks each company's public LinkedIn jobs (in the company's country) and its own careers page. Careers pages are read when they use a job board with a public feed (Greenhouse, Lever, Workday, SmartRecruiters, Workable, Ashby, Recruitee, BambooHR) or standard job-posting markup. Other careers pages are linked, not read.
- Search by words ("java cairo"), filter by company or source, star openings, hide ones you don't want, and see "New this week" or ones that have closed since the last check.
- **I applied** turns an opening into an application (Applied today, via LinkedIn or the website) and opens it so you can add referrers.
- If a company only has a LinkedIn *search* link, the check looks for its real company page by exact name and saves it, which also fetches its logo.

## Browser extension (Chrome / Edge)

Import the job you're looking at straight into the app.

1. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, click **Load unpacked** and pick the `extension` folder.
2. Pin **Job Tracker Importer**. With the app running (`npm run dev`), open a LinkedIn job, a LinkedIn post or a Workable job and click the icon → **Import to Job Tracker**.
3. The app opens **Log application** already filled in (title, company, description, how you applied). Check it and save.

You can also right-click a job link (or any page) → **Import this job to Job Tracker**. Other sites get their link and page title filled in. The popup shows a green dot when the app is reachable; change the app address under **App address** if it isn't `http://localhost:5173`. After changing extension files, click **Reload** on its card in the extensions page.
