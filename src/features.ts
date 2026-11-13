// Every feature of the app, by area: the Features page shows it, and `npm run features:export` writes FEATURES.md
// for GitHub from it (a test fails when FEATURES.md is out of date). Add new features here.
import type { IconName } from './components/Icon';


export interface Area {
  title: string;
  icon: IconName;
  /** Where it lives in the app. */
  to?: string;
  items: [string, string][];
}

/** Everything the app does, by area. Keep this in step with the README when a feature is added. */
export const AREAS: Area[] = [
  {
    title: 'Applications',
    icon: 'briefcase',
    to: '/jobs',
    items: [
      ['Every application in one list', 'Title, company, stage, work type, salary, notes; list or board view; sort by job, company, applied date or stage.'],
      ['Stages and steps', 'Dated steps (Applied, HR interview, Technical interview…), including upcoming interviews. A closed job shows how far it got, e.g. "Ghosted after Technical interview".'],
      ['Ghosted by itself', 'An open application with no update for 60 days moves to Ghosted.'],
      ['Applied via', 'Email, Company website, LinkedIn, Wuzzuf or Other, with the address or link you used.'],
      ['Recruiters', 'Up to 5 per application: pick a contact, type a name, or paste a LinkedIn profile link. Importing a LinkedIn job adds everyone under "Meet the hiring team".'],
      ['Referrers', 'Up to 3 people who referred you; your connections at the company are suggested first.'],
      ['CV sent', 'Which CV version you applied with.'],
      ['Stars', 'Star applications to keep them on top, and filter to starred ones.'],
    ],
  },
  {
    title: 'Importing jobs',
    icon: 'download',
    to: '/jobs',
    items: [
      ['Paste a job link', 'LinkedIn, Workable, Indeed or Wuzzuf: title, company, description and work type are filled in.'],
      ['Recruiter posts', 'A LinkedIn "we\'re hiring" post becomes the job description, with the company it\'s for guessed.'],
      ['New companies on the fly', "A company that isn't in your list yet is created when you save, from its LinkedIn page."],
      ['Closed jobs', 'A posting that no longer accepts applications is flagged (and an applied job moves to Ghosted).'],
    ],
  },
  {
    title: 'Browser extension',
    icon: 'external',
    items: [
      ['Knows the page you\'re on', 'A job imports the job, a post imports a job from it, a company page imports the company with its offices, a profile imports the contact.'],
      ['Reads your logged-in tab', 'So you get what LinkedIn shows you, including the hiring team; Indeed and Wuzzuf pages are sent from the tab too.'],
      ['Small window beside the page', 'The form opens filled in next to the job; saving closes it. Right-click any link to import it.'],
    ],
  },
  {
    title: 'Companies',
    icon: 'building',
    to: '/companies',
    items: [
      ['Fill from LinkedIn', 'Website, industry, size, founded, headquarters, about text, logo and every office.'],
      ['Several offices', 'Each office is pinned on the map; the main one is marked primary.'],
      ['Links', 'LinkedIn (the main link), Wuzzuf company page and careers page.'],
      ['Refresh all from LinkedIn', 'Re-reads every company in the background and fills what is still empty, without overwriting what you typed.'],
      ['Find careers pages', "Searches every company's website for its careers page and how it hires: the hiring system (Workday, Oracle, SuccessFactors, Taleo, Workable…), a careers email, or Wuzzuf. For companies that don't post on LinkedIn."],
      ['Find all jobs on LinkedIn', "Scans every company's open jobs into Openings (LinkedIn and their careers pages), with progress."],
      ['Applied and openings counts', 'Each card shows how many jobs you applied to there and how many are open.'],
      ['Starter companies', 'A new install starts with 228 companies in Egypt and the Gulf, with offices and logos.'],
    ],
  },
  {
    title: 'Openings',
    icon: 'search',
    to: '/openings',
    items: [
      ['Open positions at your companies', "From LinkedIn and careers pages (Greenhouse, Lever, Workday, SmartRecruiters, Workable, Ashby, Recruitee, BambooHR)."],
      ['Search and filter', 'Words like "java cairo", by company or source; star or hide openings; see what is new this week or has closed.'],
      ['I applied', 'Turns an opening into an application in one click.'],
    ],
  },
  {
    title: 'Contacts',
    icon: 'users',
    to: '/contacts',
    items: [
      ['Import your LinkedIn export', 'All your connections from the .zip LinkedIn emails you; importing again never duplicates anyone.'],
      ['Who you talked to', 'Conversation and message counts from your LinkedIn messages (the text is never stored).'],
      ['Status', 'Waiting for connection, Message sent, Chatting or Referred, with a filter.'],
      ['Favourites', 'Star people to keep them on the Favourites tab.'],
      ['Connections at a company', 'Every job and company page lists the people you know there.'],
    ],
  },
  {
    title: 'Map',
    icon: 'map',
    to: '/map',
    items: [
      ['Every office on the map', 'Pinned from its address with OpenStreetMap, or Google with an API key.'],
      ['Highlight a company', "Click a pin and that company's offices light up; \"Show all\" zooms out to fit them."],
      ['Distance from home', 'Set your home location and see how far each office is.'],
      ['Filters', 'Remote companies on or off, and only companies with a job in a given stage.'],
    ],
  },
  {
    title: 'Dashboard',
    icon: 'dashboard',
    to: '/',
    items: [
      ['Where applications went', 'A flow chart from applied to each stage reached and how it ended, by channel and by referral.'],
      ['Charts', 'Jobs by stage, pipeline funnel, applications per week, how you applied, and your latest activity.'],
      ['A boost every day', "A quote of the day and how your week is going (\"3 applications this week. One more today keeps the streak alive.\"); hide it for the day with ✕."],
    ],
  },
  {
    title: 'CVs',
    icon: 'file',
    to: '/cvs',
    items: [['Every version', 'Upload CVs with a label, preview and download them, pick a default, and see which one each application got.']],
  },
  {
    title: 'Quiz (turn on in Settings → Menu)',
    icon: 'quiz',
    to: '/quiz',
    items: [['Interview practice', 'Import question sets, practise by topic, keep your answers and retry the ones you missed.']],
  },
  {
    title: 'Settings and your data',
    icon: 'settings',
    to: '/settings',
    items: [
      ['Your own stages', 'Rename, recolour, reorder, add and delete stages.'],
      ['Backups', 'Export everything to a file and import it back; bulk import companies and jobs from JSON or CSV.'],
      ['Updates', 'The app checks GitHub when it starts and every 6 hours (or when you click Check for updates), shows what an update adds, updates itself in one click, and tells you what is new once it is back.'],
      ['Menu', 'Quiz and Features are off until you turn them on in Settings → Menu.'],
      ['Local only', 'Everything stays in data/jobs.db on your computer.'],
      ['Desktop icon', 'setup.bat installs the app and puts a Job Tracker icon on the desktop.'],
    ],
  },
];

/** FEATURES.md: the same list for GitHub. */
export function featuresMarkdown(): string {
  const total = AREAS.reduce((n, a) => n + a.items.length, 0);
  const lines = [
    '# Features',
    '',
    `Everything Job Tracker can do: ${total} features in ${AREAS.length} areas. In the app, turn on **Settings → Menu → Show Features** to browse and search this list.`,
    '',
    '<!-- Generated from src/features.ts by `npm run features:export`. Edit that file, not this one. -->',
    '',
  ];
  for (const a of AREAS) {
    lines.push(`## ${a.title}`, '');
    for (const [t, d] of a.items) lines.push(`- **${t}**: ${d}`);
    lines.push('');
  }
  return lines.join('\n');
}
