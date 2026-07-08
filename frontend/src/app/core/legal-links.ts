import {environment} from '../../environments/environment';

/**
 * The legal pages live on the public apex (birddoc.eu), server-rendered by the
 * Django landing app — the SPA only links out to them (§ 5 ECG: the Impressum
 * must be easily reachable from the service surface, not just the marketing
 * site). Labels mirror the landing footer.
 */
export const LEGAL_LINKS = [
  {label: 'Impressum', href: `${environment.legalBaseUrl}/impressum/`},
  {label: 'Datenschutz', href: `${environment.legalBaseUrl}/datenschutz/`},
  {label: 'AGB & DPA', href: `${environment.legalBaseUrl}/agb/`},
] as const;
