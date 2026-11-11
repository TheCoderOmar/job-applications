import { api } from './api';
import type { Company, CompanyInput } from './types';

/**
 * Adds a company you don't have yet, filled from its LinkedIn page when the link is known (details, offices, logo).
 * If LinkedIn shows you already have it (under its LinkedIn name), that one is returned instead.
 */
export async function createCompanyFromLinkedIn(name: string, linkedin: string | null, page?: string): Promise<Pick<Company, 'id' | 'name'>> {
  let details: CompanyInput = {};
  if (linkedin) {
    try {
      const li = await api.linkedInCompany(linkedin, page);
      if (li.existing) return li.existing;
      const { existing: _e, logo_url: _l, name: liName, locations, ...rest } = li;
      details = { ...rest, name: liName ?? name, locations: locations.map((l) => ({ ...l })) };
    } catch {
      details = { linkedin };
    }
  }
  return api.createCompany({ ...details, name: details.name ?? name });
}
