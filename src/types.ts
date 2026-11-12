export type StageKind = 'active' | 'closed_won' | 'closed_lost';
export type LocationType = 'onsite' | 'hybrid' | 'remote' | 'unknown';

export const WORK_TYPE_LABELS: Record<LocationType, string> = {
  onsite: 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
  unknown: 'Unknown',
};
export type ApplyChannel = 'email' | 'website' | 'linkedin' | 'wuzzuf' | 'other';

export const CHANNEL_LABELS: Record<ApplyChannel, string> = {
  email: 'Email',
  website: 'Company website',
  linkedin: 'LinkedIn',
  wuzzuf: 'Wuzzuf',
  other: 'Other',
};

export interface Contact {
  id: number;
  full_name: string;
  company: string | null;
  position: string | null;
  linkedin_url: string | null;
  email: string | null;
  connected_on: string | null;
  source: 'linkedin_import' | 'manual';
  created_at: string;
  referral_count: number;
  conversations: number;
  messages: number;
  messages_from_them: number;
  last_message_at: string | null;
  /** Date you marked "talked to" by hand, or null. */
  talked_at: string | null;
  /** Where you stand with them; null = no status yet. */
  status: ContactStatus | null;
  favorite: number;
}

export type ContactStatus = 'waiting_connection' | 'message_sent' | 'chatting' | 'referred';
export const CONTACT_STATUS: Record<ContactStatus, { label: string; color: string }> = {
  // A connection request you sent that they haven't accepted yet.
  waiting_connection: { label: 'Waiting for connection', color: '#a78bfa' },
  message_sent: { label: 'Message sent', color: '#60a5fa' },
  chatting: { label: 'Chatting', color: '#fbbf24' },
  referred: { label: 'Referred', color: '#34d399' },
};

export interface Stage {
  id: number;
  name: string;
  color: string;
  sort_order: number;
  kind: StageKind;
  job_count: number;
}

export interface Company {
  id: number;
  name: string;
  website: string | null;
  linkedin: string | null;
  /** The company's Wuzzuf page (wuzzuf.net/jobs/careers/…); LinkedIn stays the main link. */
  wuzzuf: string | null;
  careers_url: string | null;
  industry: string | null;
  company_size: string | null;
  founded: string | null;
  headquarters: string | null;
  notes: string | null;
  description: string | null;
  logo_at: string | null;
  careers_found_url: string | null;
  openings_scanned_at: string | null;
  openings_note: string | null;
  is_remote: 0 | 1;
  is_current: 0 | 1;
  address: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  maps_link: string | null;
  created_at: string;
  job_count: number;
  /** Applications you sent there (past the first stage). */
  applied_count: number;
  /** Open positions found there (not hidden or closed). */
  opening_count: number;
  locations: CompanyLocation[];
}

export interface Job {
  id: number;
  company_id: number;
  company_name: string;
  title: string;
  description: string | null;
  url: string | null;
  location_type: LocationType;
  salary: string | null;
  stage_id: number;
  stage_name: string;
  stage_color: string;
  stage_kind: StageKind;
  stage_order: number;
  applied_date: string | null;
  notes: string | null;
  apply_channel: ApplyChannel | null;
  apply_contact: string | null;
  /** The CV you applied with. */
  cv_id: number | null;
  cv_label: string | null;
  /** The recruiter (from LinkedIn's "Meet the hiring team", or picked by hand): one of your contacts. */
  recruiter_id: number | null;
  recruiter_name: string | null;
  recruiter_linkedin: string | null;
  recruiter_position: string | null;
  referrer_count: number;
  starred: 0 | 1;
  /** Furthest stage reached that isn't a closed-lost one, e.g. "HR interview" for "ghosted after HR interview". */
  reached_stage: string | null;
  logo_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Someone from a posting's "Meet the hiring team". */
export interface HiringPerson {
  name: string;
  linkedin_url: string | null;
  headline: string | null;
}

export interface Cv {
  id: number;
  label: string;
  /** The original file name, kept for downloads (often the same for every version). */
  file_name: string;
  mime: string;
  size: number;
  notes: string | null;
  is_default: 0 | 1;
  created_at: string;
  /** Applications sent with this CV. */
  job_count: number;
}

export interface QuizTopic {
  topic: string;
  topic_order: number;
  total: number;
  mcq: number;
  card: number;
  /** Questions answered at least once; of those, latest answer right / wrong. */
  answered: number;
  got_right: number;
  missed: number;
}

export interface QuizSet {
  id: number;
  role: string;
  imported_at: string;
  topics: QuizTopic[];
}

export interface QuizQuestion {
  id: number;
  set_id: number;
  topic: string;
  type: 'mcq' | 'card';
  question: string;
  /** Multiple choice only, already shuffled. */
  options: string[] | null;
  answer: string;
  attempts: number;
  last_correct: 0 | 1 | null;
}

export type QuizWhich = 'all' | 'missed' | 'new';
export type QuizTypes = 'all' | 'mcq' | 'card';

export interface HistoryEntry {
  id: number;
  stage_id: number;
  changed_at: string;
  stage_name: string;
  stage_color: string;
}

export interface JobDetail extends Job {
  history: HistoryEntry[];
  referrers: Contact[];
}

export interface SankeyData {
  nodes: { name: string; color: string; count: number; kind: 'root' | 'stage' | 'open' | 'none' | 'lost' }[];
  links: { source: number; target: number; value: number }[];
}

export interface ChannelTally {
  key: string;
  applied: number;
  responded: number;
}

export interface Stats {
  stages: Stage[];
  funnel: { id: number; name: string; color: string; count: number }[];
  totals: {
    companies: number;
    remote_companies: number;
    jobs: number;
    applied: number;
    in_progress: number;
    won: number;
    lost: number;
  };
  perWeek: { week: string; count: number }[];
  byLocationType: { type: LocationType; count: number }[];
  sankey: SankeyData;
  byChannel: ChannelTally[];
  byReferral: ChannelTally[];
}

export interface LinkedInCompany {
  linkedin: string;
  name: string | null;
  description: string | null;
  website: string | null;
  industry: string | null;
  company_size: string | null;
  headquarters: string | null;
  founded: string | null;
  logo_url: string | null;
  locations: FoundLocation[];
  existing: { id: number; name: string; location_count?: number } | null;
}

/** A company as sent to the server: its locations may be new (no id) or found on LinkedIn. */
export type LocationDraft = Partial<Omit<CompanyLocation, 'is_primary'>> & { is_primary?: boolean | number };
export type CompanyInput = Partial<Omit<Company, 'locations'>> & { locations?: LocationDraft[] };

/** An office read from LinkedIn, before it's saved. */
export interface FoundLocation {
  label: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  is_primary: boolean;
}

/** A saved office. The primary one is also the company's own address/lat/lng. */
export interface CompanyLocation {
  id: number;
  company_id: number;
  label: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  maps_link: string | null;
  /** exact | street | area | city | manual */
  precision: string | null;
  /** null = not looked up yet */
  geocode_status: 'found' | 'not_found' | null;
  is_primary: number;
  sort_order: number;
}

export interface Opening {
  id: number;
  company_id: number;
  company_name: string;
  logo_at: string | null;
  source: 'linkedin' | 'website';
  title: string;
  location: string | null;
  url: string | null;
  posted_at: string | null;
  first_seen: string;
  last_seen: string;
  closed_at: string | null;
  starred: 0 | 1;
  hidden: 0 | 1;
  job_id: number | null;
  job_stage_name: string | null;
  job_stage_color: string | null;
}

export interface ScanStatus {
  running: boolean;
  done: number;
  total: number;
  found: number;
  current: string | null;
  last_scan: string | null;
}

export interface LogoStatus {
  running: boolean;
  done: number;
  found: number;
  total: number;
  missing: number;
}

export interface Home {
  lat: number;
  lng: number;
  label: string;
  link: string | null;
}
