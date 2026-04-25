import {Ring} from './ring.model';
import {Species} from './species.model';
import {Scientist} from './scientist.model';
import {RingingStation} from './ringing-station.model';

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
  net_location: number;
  net_height: number;
  net_direction: Direction;
  feather_span: number;
  wing_span: number;
  tarsus: number;
  notch_f2: number;
  inner_foot: number;
  weight_gram: number;
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
  comment: string;
  has_mites: boolean;
  has_hunger_stripes: boolean;
  has_brood_patch: boolean;
  has_cpl_plus: boolean;
}

export interface SelectOption<T> {
  value: T;
  viewValue: string;
  key?: string;
}
