// src/app/service/api.service.ts

import {Injectable, inject} from '@angular/core';
import {HttpClient, HttpParams} from '@angular/common/http';
import {Observable} from 'rxjs';
import {DataEntry} from '../models/data-entry.model';
import {Species} from '../models/species.model';
import {RingSize} from '../models/ring.model';
import {PaginatedApiResponse} from '../models/paginated-api-response.model';
import {RingingStation} from '../models/ringing-station.model';
import {Scientist} from '../models/scientist.model';

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = 'http://localhost:8000/api/birds';

  getDataEntries(): Observable<DataEntry[]> {
    return this.http.get<DataEntry[]>(`${this.apiUrl}/data-entries/`);
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

  getSpecies(searchTerm?: string): Observable<PaginatedApiResponse<Species>> {
    let params = new HttpParams();
    if (searchTerm) {
      params = params.set('search', searchTerm);
    }
    return this.http.get<PaginatedApiResponse<Species>>(`${this.apiUrl}/species/`, {params});
  }

  getNextRingNumber(size: RingSize): Observable<{ next_number: number }> {
    const params = new HttpParams().set('size', size);
    return this.http.get<{ next_number: number }>(`${this.apiUrl}/rings/next-number/`, {params});
  }

  getRingingStations(searchTerm?: string): Observable<PaginatedApiResponse<RingingStation>> {
    let params = new HttpParams();
    if (searchTerm) {
      params = params.set('search', searchTerm);
    }
    return this.http.get<PaginatedApiResponse<RingingStation>>(`${this.apiUrl}/ringing-stations/`, {params});
  }

  getScientists(searchTerm?: string): Observable<PaginatedApiResponse<Scientist>> {
    let params = new HttpParams();
    if (searchTerm) {
      params = params.set('search', searchTerm);
    }
    return this.http.get<PaginatedApiResponse<Scientist>>(`${this.apiUrl}/scientists/`, {params});
  }
}
