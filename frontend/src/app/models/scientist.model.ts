export interface Scientist {
  id: string; // This will be the user ID
  handle: string;
  full_name: string;
}

export interface ScientistCreatePayload {
  first_name: string;
  last_name: string;
  handle: string;
}
