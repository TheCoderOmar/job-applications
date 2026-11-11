import type { Company, CompanyInput, Contact, ContactStatus, Cv, FoundLocation, QuizQuestion, QuizSet, QuizTypes, QuizWhich, LinkedInCompany, LogoStatus, Opening, ScanStatus, Home, Job, JobDetail, Stage, Stats } from './types';

type JobInput = Partial<Job> & { referrer_ids?: number[] };

/** Progress of "Refresh from LinkedIn" over your companies. */
export interface RefreshStatus {
  running: boolean;
  total: number;
  done: number;
  updated: number;
  locations_added: number;
  no_page: number;
  failed: number;
  current: string | null;
  error: string | null;
}

/** Is there a newer version on GitHub, and can it be applied here? */
export interface UpdateInfo {
  supported: boolean;
  behind: number;
  commits: string[];
  needs_restart: boolean;
  /** When GitHub was last checked (null until the first check worked). */
  checked_at: string | null;
  /** Why the last check didn't work (no network, no git…), or null. */
  error: string | null;
  /** Why "Update now" can't run here (null when it can). */
  blocked: string | null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });

export const api = {
  companies: () => request<Company[]>('/api/companies'),
  company: (id: number | string) => request<Company>(`/api/companies/${id}`),
  createCompany: (data: CompanyInput) => request<Company>('/api/companies', json('POST', data)),
  updateCompany: (id: number, data: CompanyInput) => request<Company>(`/api/companies/${id}`, json('PUT', data)),
  addLocations: (id: number, locations: FoundLocation[]) =>
    request<{ added: number; company: Company }>(`/api/companies/${id}/locations`, json('POST', { locations })),
  updateStatus: () => request<UpdateInfo>('/api/update'),
  /** Asks GitHub right now instead of using the last check. */
  checkForUpdates: () => request<UpdateInfo>('/api/update?refresh=1'),
  applyUpdate: () => request<{ updated: number; needs_restart: boolean }>('/api/update', { method: 'POST' }),
  refreshStatus: () => request<RefreshStatus>('/api/refresh-status'),
  refreshCompanies: (ids?: number[]) => request<RefreshStatus>('/api/refresh-companies', json('POST', ids ? { ids } : {})),
  defaultCompanies: () => request<{ total: number; missing: number }>('/api/default-companies'),
  loadDefaultCompanies: () => request<{ added: number }>('/api/default-companies', { method: 'POST' }),
  geocodeStatus: () => request<{ running: boolean; pending: number; done: number; failed: number; error: string | null }>('/api/geocode/status'),
  googleKey: () => request<{ set: boolean; hint: string | null }>('/api/settings/google-key'),
  setGoogleKey: (key: string) => request<{ set: boolean; hint: string | null }>('/api/settings/google-key', json('PUT', { key })),
  deleteCompany: (id: number) => request<void>(`/api/companies/${id}`, { method: 'DELETE' }),
  /** `page`: the post as the extension read it from your logged-in tab. */
  linkedInPost: (url: string, page?: string) =>
    request<{
      text: string | null;
      author: string | null;
      author_url: string | null;
      author_headline: string | null;
      posted_at: string | null;
      description: string;
      /** The company the post is probably for: one you have (id) or a new one (id null). */
      company_guess: { id: number | null; name: string; linkedin: string | null; why: 'author' | 'mentioned' | 'headline' } | null;
    }>('/api/linkedin/post', json('POST', { url, page })),
  /** `page`: an Indeed/Wuzzuf page the browser extension sent (those sites block the app). */
  importJob: (url: string, page?: string) =>
    request<{
      source: 'linkedin' | 'workable' | 'indeed' | 'wuzzuf';
      title: string | null;
      company: string | null;
      company_linkedin: string | null;
      /** The company's Wuzzuf page, on Wuzzuf postings. */
      company_wuzzuf?: string | null;
      location: string | null;
      description: string | null;
      workplace: 'remote' | 'hybrid' | 'onsite' | null;
      closed: boolean;
    }>('/api/import/job', json('POST', { url, page })),
  setCompanyWuzzuf: (id: number, url: string) => request<Company | null>(`/api/companies/${id}/wuzzuf`, json('PATCH', { url })),
  linkedInJob: (url: string) =>
    request<{ title: string | null; company: string | null; location: string | null; description: string | null; workplace: 'remote' | 'hybrid' | 'onsite' | null; closed: boolean }>(
      '/api/linkedin/job',
      json('POST', { url }),
    ),
  /** `page`: the company page as the extension read it from your logged-in tab (its "Locations" cards). */
  linkedInCompany: (url: string, page?: string) => request<LinkedInCompany>('/api/linkedin/company', json('POST', { url, page })),
  logoStatus: () => request<LogoStatus>('/api/logos/status'),
  fetchMissingLogos: () => request<LogoStatus>('/api/logos/fetch-missing', { method: 'POST' }),
  refreshLogo: (id: number) => request<LogoStatus>(`/api/companies/${id}/logo/refresh`, { method: 'POST' }),
  uploadLogo: (id: number, dataUrl: string) => request<Company>(`/api/companies/${id}/logo`, json('PUT', { dataUrl })),
  removeLogo: (id: number) => request<void>(`/api/companies/${id}/logo`, { method: 'DELETE' }),

  jobs: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    return request<Job[]>(`/api/jobs?${qs}`);
  },
  job: (id: number | string) => request<JobDetail>(`/api/jobs/${id}`),
  createJob: (data: JobInput) => request<Job>('/api/jobs', json('POST', data)),
  updateJob: (id: number, data: JobInput) => request<Job>(`/api/jobs/${id}`, json('PUT', data)),
  setJobStage: (id: number, stage_id: number) => request<Job>(`/api/jobs/${id}/stage`, json('PATCH', { stage_id })),
  starJob: (id: number, starred: boolean) => request<Job>(`/api/jobs/${id}/star`, json('PATCH', { starred })),
  addStep: (jobId: number, data: { stage_id: number; date: string }) =>
    request<{ ok: true }>(`/api/jobs/${jobId}/history`, json('POST', data)),
  updateStep: (jobId: number, stepId: number, data: { stage_id?: number; date?: string }) =>
    request<{ ok: true }>(`/api/jobs/${jobId}/history/${stepId}`, json('PUT', data)),
  deleteStep: (jobId: number, stepId: number) => request<void>(`/api/jobs/${jobId}/history/${stepId}`, { method: 'DELETE' }),
  deleteJob: (id: number) => request<void>(`/api/jobs/${id}`, { method: 'DELETE' }),

  cvs: () => request<Cv[]>('/api/cvs'),
  uploadCv: (data: { dataUrl: string; file_name: string; label?: string; notes?: string }) => request<Cv>('/api/cvs', json('POST', data)),
  updateCv: (id: number, data: { label: string; notes: string | null }) => request<Cv>(`/api/cvs/${id}`, json('PUT', data)),
  replaceCvFile: (id: number, data: { dataUrl: string; file_name: string }) => request<Cv>(`/api/cvs/${id}/file`, json('PUT', data)),
  setDefaultCv: (id: number) => request<Cv[]>(`/api/cvs/${id}/default`, { method: 'PATCH' }),
  deleteCv: (id: number) => request<void>(`/api/cvs/${id}`, { method: 'DELETE' }),
  cvFileUrl: (id: number, download = false) => `/api/cvs/${id}/file${download ? '?download=1' : ''}`,

  quizSets: () => request<QuizSet[]>('/api/quiz/sets'),
  importQuiz: (file: string) =>
    request<{ set_id: number; role: string; added: number; updated: number; removed: number }>('/api/quiz/import', json('POST', { file })),
  startQuiz: (setId: number, opts: { topics: string[]; which: QuizWhich; types: QuizTypes; count: number | null }) =>
    request<QuizQuestion[]>(`/api/quiz/sets/${setId}/start`, json('POST', opts)),
  answerQuiz: (question_id: number, correct: boolean) => request<{ ok: true }>('/api/quiz/answers', json('POST', { question_id, correct })),
  resetQuizProgress: (setId: number) => request<QuizSet[]>(`/api/quiz/sets/${setId}/progress`, { method: 'DELETE' }),
  deleteQuizSet: (setId: number) => request<void>(`/api/quiz/sets/${setId}`, { method: 'DELETE' }),

  stages: () => request<Stage[]>('/api/stages'),
  createStage: (data: Partial<Stage>) => request<Stage[]>('/api/stages', json('POST', data)),
  updateStage: (id: number, data: Partial<Stage>) => request<Stage[]>(`/api/stages/${id}`, json('PUT', data)),
  deleteStage: (id: number) => request<Stage[]>(`/api/stages/${id}`, { method: 'DELETE' }),
  reorderStages: (ids: number[]) => request<Stage[]>('/api/stages/reorder', json('PUT', { ids })),

  stats: (params: { channel?: string; referred?: string } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    return request<Stats>(`/api/stats?${qs}`);
  },

  contacts: (q = '') => request<Contact[]>(`/api/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createContact: (data: Partial<Contact>) => request<Contact>('/api/contacts', json('POST', data)),
  updateContact: (id: number, data: Partial<Contact>) => request<Contact>(`/api/contacts/${id}`, json('PUT', data)),
  patchContact: (id: number, data: { status?: ContactStatus | null; favorite?: boolean }) =>
    request<Contact>(`/api/contacts/${id}`, json('PATCH', data)),
  setTalked: (id: number, talked: boolean) => request<Contact>(`/api/contacts/${id}/talked`, json('PATCH', { talked })),
  deleteContact: (id: number) => request<void>(`/api/contacts/${id}`, { method: 'DELETE' }),
  importLinkedIn: (csv: string) =>
    request<{ added: number; updated: number; total: number }>('/api/contacts/import-linkedin', json('POST', { csv })),
  importMessages: (csv: string) =>
    request<{ people: number; matched: number; not_connections: number }>('/api/contacts/import-messages', json('POST', { csv })),

  openings: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    return request<Opening[]>(`/api/openings?${qs}`);
  },
  updateOpening: (id: number, data: { starred?: boolean; hidden?: boolean }) => request<Opening>(`/api/openings/${id}`, json('PATCH', data)),
  appliedToOpening: (id: number) => request<Job>(`/api/openings/${id}/applied`, { method: 'POST' }),
  scanStatus: () => request<ScanStatus>('/api/openings/status'),
  scanOpenings: (company_ids?: number[]) => request<ScanStatus>('/api/openings/scan', json('POST', company_ids ? { company_ids } : {})),
  /** `page`: the profile as the extension read it from your logged-in tab. */
  linkedInProfile: (url: string, page?: string) =>
    request<{
      linkedin_url: string;
      full_name: string | null;
      company: string | null;
      /** The company's LinkedIn page, when the tab showed it. */
      company_linkedin: string | null;
      position: string | null;
      location: string | null;
      existing: { id: number; full_name: string } | null;
      company_match: { id: number; name: string } | null;
    }>('/api/linkedin/profile', json('POST', { url, page })),
  connectionsAt: (companyId: number | string) => request<Contact[]>(`/api/companies/${companyId}/connections`),
  home: () => request<Home | null>('/api/home'),
  setHome: (data: { link?: string; lat?: number | null; lng?: number | null; label?: string }) =>
    request<Home>('/api/home', json('PUT', data)),
  clearHome: () => request<void>('/api/home', { method: 'DELETE' }),
  resolveMapsLink: (link: string) =>
    request<{ lat: number; lng: number; finalUrl: string }>('/api/resolve-maps-link', json('POST', { link })),
  import: (data: unknown) =>
    request<{ companies: number; jobs: number; skipped?: string[] }>('/api/import', json('POST', data)),
};
