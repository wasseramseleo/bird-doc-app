import {Ring} from './ring.model';
import {Species} from './species.model';
import {Scientist} from './scientist.model';
import {RingingStation} from './ringing-station.model';
import {Project} from './project.model';

export enum Direction {
  Left = 'L',
  Right = 'R',
}

export enum BirdStatus {
  FirstCatch = 'e',
  ReCatch = 'w',
}

export enum AgeClass {
  Nest = 1,
  Unknown = 2,
  ThisYear = 3,
  NotThisYear = 4,
  LastYear = 5,
  NotLastYear = 6,
}

export enum Sex {
  Unknown = 0,
  Male = 1,
  Female = 2,
}

export enum SmallFeatherIntMoult {
  None = 0,
  Some = 1,
  Many = 2,
}

export enum SmallFeatherAppMoult {
  Juvenile = 'J',
  Unmoulted = 'U',
  Mixed = 'M',
  New = 'N',
}

export enum HandWingMoult {
  None = 0,
  NoneOld = 1,
  AtLeastOne = 2,
  All = 3,
  Part = 4,
}

export enum MuscleClass {
  Null = 0,
  One = 1,
  Two = 2,
  Three = 3,
}

// Parasit (ADR 0027): the fixed, app-wide vocabulary of parasite types, identical
// for every Organisation. The multi-valued `parasites` field carries a list of
// these codes. Ships with Milben; further concrete types (feedback #7b) are added
// here as the user finalises the list — no other change needed.
export enum Parasit {
  Mites = 'mites',
}

export enum FatClass {
  Null = 0,
  One = 1,
  Two = 2,
  Three = 3,
  Four = 4,
  Five = 5,
  Six = 6,
  Seven = 7,
  Eight = 8,
}

export interface DataEntry {
  id: string;
  species: Species;
  ring: Ring;
  staff: Scientist;
  ringing_station: RingingStation;
  project: Project | null;
  net_location: number | null;
  net_height: number | null;
  net_direction: Direction | null;
  feather_span: number | null;
  wing_span: number | null;
  tarsus: number | null;
  notch_f2: number | null;
  inner_foot: number | null;
  weight_gram: number | null;
  bird_status: BirdStatus;
  fat_deposit: number | null;
  muscle_class: MuscleClass | null;
  age_class: AgeClass;
  sex: Sex;
  small_feather_int: SmallFeatherIntMoult | null;
  small_feather_app: SmallFeatherAppMoult | null;
  hand_wing: HandWingMoult | null;
  date_time: string;
  created: string;
  updated: string;
  comment: string | null;
  // #155: the client-generated idempotency key set on create; absent on
  // captures recorded before this field existed. Read-only from the client's
  // perspective — see DataEntryFormComponent for where it is minted.
  idempotency_key?: string | null;
  // Parasit (ADR 0027): a multi-valued selection of parasite types, replacing the
  // former single `has_mites` boolean. A list of vocabulary codes (e.g.
  // ['mites']); an empty list means no parasites recorded.
  parasites: Parasit[];
  has_hunger_stripes: boolean;
  has_brood_patch: boolean;
  has_cpl_plus: boolean;
  // Fangmarker (ADR 0026): two independent booleans that flag a special capture
  // situation (Tot-Fund, Nicht-Standard-Fang) without replacing the real Art or
  // Ring. Serialized on both read and write, so they ride the offline outbox.
  is_dead_recovery: boolean;
  is_non_standard: boolean;
}

export interface SelectOption<T> {
  value: T;
  viewValue: string;
  key?: string;
}

// The Parasit vocabulary as label-bearing options for the Mehrfachauswahl, and a
// code -> label map for read-only views (ADR 0027). One source of truth for the
// Parasit type labels across the form and the detail dialog.
export const PARASIT_OPTIONS: readonly SelectOption<Parasit>[] = [
  {value: Parasit.Mites, viewValue: 'Milben'},
];

export const PARASIT_LABELS: Readonly<Record<Parasit, string>> = PARASIT_OPTIONS.reduce(
  (labels, option) => ({...labels, [option.value]: option.viewValue}),
  {} as Record<Parasit, string>,
);
