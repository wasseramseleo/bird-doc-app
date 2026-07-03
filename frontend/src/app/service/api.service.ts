// src/app/service/api.service.ts

import {Injectable, inject} from '@angular/core';
import {HttpClient, HttpParams, HttpResponse} from '@angular/common/http';
import {EMPTY, Observable} from 'rxjs';
import {expand, reduce} from 'rxjs/operators';
import {DataEntry} from '../models/data-entry.model';
import {Species} from '../models/species.model';
import {RingSize} from '../models/ring.model';
import {PaginatedApiResponse} from '../models/paginated-api-response.model';
import {RingingStation, RingingStationCreatePayload} from '../models/ringing-station.model';
import {Scientist, ScientistCreatePayload} from '../models/scientist.model';
import {Beringer} from '../models/beringer.model';
import {Mitgliedschaft} from '../models/mitgliedschaft.model';
import {Organization} from '../models/organization.model';
import {Project, ProjectCreatePayload, ProjectUpdatePayload} from '../models/project.model';
import {ImportPreview, ImportResult} from '../models/iwm-import.model';
import {ProjectStats, ProjectStatsRangeParams} from '../models/project-stats.model';
import {environment} from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/birds`;

  getDataEntries(params: {
    projectId: string;
    page: number;
    pageSize: number;
    search?: string;
  }): Observable<PaginatedApiResponse<DataEntry>> {
    let httpParams = new HttpParams()
      .set('project', params.projectId)
      .set('page', params.page)
      .set('page_size', params.pageSize);
    if (params.search) {
      httpParams = httpParams.set('search', params.search);
    }
    return this.http.get<PaginatedApiResponse<DataEntry>>(`${this.apiUrl}/data-entries/`, {
      params: httpParams,
    });
  }

  getDataEntriesByRing(ringSize: RingSize, ringNumber: string): Observable<PaginatedApiResponse<DataEntry>> {
    const params = new HttpParams()
      .set('ring_size', ringSize)
      .set('ring_number', ringNumber);
    return this.http.get<PaginatedApiResponse<DataEntry>>(`${this.apiUrl}/data-entries/`, {params});
  }

  getDataEntry(id: string): Observable<DataEntry> {
    return this.http.get<DataEntry>(`${this.apiUrl}/data-entries/${id}/`);
  }

  createDataEntry(dataEntry: Partial<DataEntry>): Observable<DataEntry> {
    return this.http.post<DataEntry>(`${this.apiUrl}/data-entries/`, dataEntry);
  }

  updateDataEntry(id: string, dataEntry: Partial<DataEntry>): Observable<DataEntry> {
    return this.http.put<DataEntry>(`${this.apiUrl}/data-entries/${id}/`, dataEntry);
  }

  getSpecies(searchTerm?: string, projectId?: string): Observable<PaginatedApiResponse<Species>> {
    let params = new HttpParams();
    if (searchTerm) {
      params = params.set('search', searchTerm);
    }
    if (projectId) {
      params = params.set('project', projectId);
    }
    return this.http.get<PaginatedApiResponse<Species>>(`${this.apiUrl}/species/`, {params});
  }

  getNextRingNumber(size: RingSize, projectId?: string): Observable<{ next_number: string | null }> {
    let params = new HttpParams().set('size', size);
    if (projectId) {
      params = params.set('project', projectId);
    }
    return this.http.get<{ next_number: string | null }>(`${this.apiUrl}/rings/next-number/`, {params});
  }

  getRingingStations(
    searchTerm?: string,
    organizationHandle?: string,
    includeArchived?: boolean,
  ): Observable<PaginatedApiResponse<RingingStation>> {
    let params = new HttpParams();
    if (searchTerm) {
      params = params.set('search', searchTerm);
    }
    if (organizationHandle) {
      params = params.set('organization', organizationHandle);
    }
    // The management view opts into archived Stationen; the capture picker never
    // does, so the default request stays active-only (the backend default).
    if (includeArchived) {
      params = params.set('include_archived', 'true');
    }
    return this.http.get<PaginatedApiResponse<RingingStation>>(`${this.apiUrl}/ringing-stations/`, {params});
  }

  createRingingStation(payload: RingingStationCreatePayload): Observable<RingingStation> {
    // The handle and organization are server-owned; the client never sends them.
    return this.http.post<RingingStation>(`${this.apiUrl}/ringing-stations/`, payload);
  }

  updateRingingStation(
    handle: string,
    payload: Partial<RingingStationCreatePayload>,
  ): Observable<RingingStation> {
    return this.http.patch<RingingStation>(`${this.apiUrl}/ringing-stations/${handle}/`, payload);
  }

  // Archiving/un-archiving is a reversible flip of the active flag (ADR 0011).
  setRingingStationActive(handle: string, isActive: boolean): Observable<RingingStation> {
    return this.http.patch<RingingStation>(`${this.apiUrl}/ringing-stations/${handle}/`, {
      is_active: isActive,
    });
  }

  // Hard delete is permitted only when the Station owns no Fänge; otherwise the
  // backend refuses with 409 and the caller offers archiving instead.
  deleteRingingStation(handle: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/ringing-stations/${handle}/`);
  }

  getScientists(searchTerm?: string): Observable<PaginatedApiResponse<Scientist>> {
    let params = new HttpParams();
    if (searchTerm) {
      params = params.set('search', searchTerm);
    }
    return this.http.get<PaginatedApiResponse<Scientist>>(`${this.apiUrl}/scientists/`, {params});
  }

  createScientist(payload: ScientistCreatePayload): Observable<Scientist> {
    return this.http.post<Scientist>(`${this.apiUrl}/scientists/`, payload);
  }

  // Admin-only edit of a Beringer's name + Kürzel (PRD #205). A duplicate Kürzel
  // comes back as a clean 400 (the globally-unique handle), which the caller
  // surfaces as the server's German message.
  updateScientist(id: string, payload: Partial<ScientistCreatePayload>): Observable<Scientist> {
    return this.http.patch<Scientist>(`${this.apiUrl}/scientists/${id}/`, payload);
  }

  // The Org-Admin "Beringer verwalten" list (PRD #205). Same /scientists/
  // endpoint as the autocomplete, but the server returns the Admin-aware shape
  // (Mitglied flag + linked-account fields) for an Admin request.
  getBeringer(searchTerm?: string): Observable<PaginatedApiResponse<Beringer>> {
    let params = new HttpParams();
    if (searchTerm) {
      params = params.set('search', searchTerm);
    }
    return this.http.get<PaginatedApiResponse<Beringer>>(`${this.apiUrl}/scientists/`, {params});
  }

  // The Organisation's seats (Mitgliedschaften), Admin-only. Used by the Beringer
  // verwalten link picker to offer the eligible seats — those whose `handle` is
  // null, i.e. whose account is not yet a Beringer (PRD #205, issue #209).
  getMitgliedschaften(): Observable<PaginatedApiResponse<Mitgliedschaft>> {
    return this.http.get<PaginatedApiResponse<Mitgliedschaft>>(`${this.apiUrl}/mitgliedschaften/`);
  }

  // The COMPLETE set of the Organisation's seats, following DRF's `next` link
  // through every page (the collection is paginated ~10/page). The "Mitglieder
  // ohne Beringer-Eintrag" gap panel must list *exactly* all handle==null seats,
  // so a first-page read would miss gaps beyond page one (PRD #205, issue #210).
  getAllMitgliedschaften(): Observable<Mitgliedschaft[]> {
    return this.http
      .get<PaginatedApiResponse<Mitgliedschaft>>(`${this.apiUrl}/mitgliedschaften/`)
      .pipe(
        expand((res) =>
          res.next ? this.http.get<PaginatedApiResponse<Mitgliedschaft>>(res.next) : EMPTY,
        ),
        reduce((acc, res) => acc.concat(res.results), [] as Mitgliedschaft[]),
      );
  }

  // Link a no-account Beringer to a seat, promoting it to a Mitglied — addressed
  // BY SEAT via the write-only, Admin-only `mitgliedschaft_id` on the Beringer
  // PATCH (PRD #205, issue #209).
  linkScientistToSeat(id: string, mitgliedschaftId: string): Observable<Beringer> {
    return this.http.patch<Beringer>(`${this.apiUrl}/scientists/${id}/`, {
      mitgliedschaft_id: mitgliedschaftId,
    });
  }

  // Unlink (detach) a linked Beringer, demoting it back to a no-account Beringer.
  // `mitgliedschaft_id: null` clears `Scientist.user`; the backend refuses (400)
  // if the Beringer already owns captures (freeze-once-captures).
  unlinkScientist(id: string): Observable<Beringer> {
    return this.http.patch<Beringer>(`${this.apiUrl}/scientists/${id}/`, {
      mitgliedschaft_id: null,
    });
  }

  // Delete a Beringer (PRD #205, issue #208). A no-account Beringer is hard-deleted
  // (204), reassigning any owned Fänge to the reserved „Gelöschter Nutzer" at the
  // model layer; a linked Mitglied is refused server-side (409) — the delete is
  // disabled in the UI for those. Mirrors deleteRingingStation.
  deleteScientist(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/scientists/${id}/`);
  }

  getOrganizations(): Observable<PaginatedApiResponse<Organization>> {
    return this.http.get<PaginatedApiResponse<Organization>>(`${this.apiUrl}/organizations/`);
  }

  getProjects(): Observable<PaginatedApiResponse<Project>> {
    return this.http.get<PaginatedApiResponse<Project>>(`${this.apiUrl}/projects/`);
  }

  createProject(payload: ProjectCreatePayload): Observable<Project> {
    return this.http.post<Project>(`${this.apiUrl}/projects/`, payload);
  }

  updateProject(id: string, payload: ProjectUpdatePayload): Observable<Project> {
    return this.http.patch<Project>(`${this.apiUrl}/projects/${id}/`, payload);
  }

  // Projekt-Dashboard stats (PRD #199, ADR 0017): a read-only, online-only
  // composite of one Projekt's totals + Letzter-Tag figures over a date range.
  // The range is a preset (default `week` server-side) or explicit from/to ISO
  // dates; the backend aggregates in SQL and buckets by Europe/Vienna.
  getProjectStats(projectId: string, range?: ProjectStatsRangeParams): Observable<ProjectStats> {
    let params = new HttpParams();
    if (range?.preset) {
      params = params.set('preset', range.preset);
    }
    if (range?.from) {
      params = params.set('from', range.from);
    }
    if (range?.to) {
      params = params.set('to', range.to);
    }
    return this.http.get<ProjectStats>(`${this.apiUrl}/projects/${projectId}/stats/`, {params});
  }

  // Feedback ("Feedback / Fehler melden", issue #81) is not a /birds resource —
  // it posts straight to /api/feedback/, which emails the operator.
  sendFeedback(message: string): Observable<void> {
    return this.http.post<void>(`${environment.apiUrl}/feedback/`, {message});
  }

  exportIwm(projectId: string): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.apiUrl}/projects/${projectId}/export-iwm/`, {
      responseType: 'blob',
      observe: 'response',
    });
  }

  // IWM import (ADR 0013). Both phases POST the same multipart upload to the
  // project's import route; the auth interceptor adds withCredentials + the CSRF
  // header for these unsafe requests. The dry-run omits the commit flag so the
  // backend writes nothing and returns a preview; the commit sets it and creates
  // the importable captures.
  importIwmDryRun(projectId: string, file: File): Observable<ImportPreview> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ImportPreview>(`${this.apiUrl}/projects/${projectId}/import-iwm/`, form);
  }

  importIwmCommit(projectId: string, file: File): Observable<ImportResult> {
    const form = new FormData();
    form.append('file', file);
    form.append('commit', 'true');
    return this.http.post<ImportResult>(`${this.apiUrl}/projects/${projectId}/import-iwm/`, form);
  }
}
