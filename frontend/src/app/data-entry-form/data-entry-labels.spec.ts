import { AgeClass, BirdStatus, Sex } from '../models/data-entry.model';
import { getAgeClassLabel, getBirdStatusLabel, getSexLabel } from './data-entry-labels';

// #469: genau ein Ort macht aus einem codierten Wert ein Wort. Die drei
// Funktionen dieses Moduls sind die Naht, an der jede Fang-Oberfläche ihre
// Beschriftungen holt — hier wird sie geprüft, und nur hier.
describe('data-entry-labels', () => {
  describe('getBirdStatusLabel', () => {
    it('names the two Ringstatus values', () => {
      expect(getBirdStatusLabel(BirdStatus.FirstCatch)).toBe('Erstfang');
      expect(getBirdStatusLabel(BirdStatus.ReCatch)).toBe('Wiederfang');
    });

    // CONTEXT.md („Erstfang / Wiederfang"): das Paar ist **nicht erschöpfend**.
    // Ein Ring vernichtet trägt keinen Ringstatus — das Backend leert ihn
    // vorsätzlich —, und eine Oberfläche zeigt diese Abwesenheit als solche,
    // statt sie zu „Wiederfang" zu ergänzen.
    it('reads a missing Ringstatus as a dash, never as Wiederfang', () => {
      expect(getBirdStatusLabel(null)).toBe('—');
      expect(getBirdStatusLabel(undefined)).toBe('—');
    });

    // Ein Wert, den diese Fassung nicht kennt (ein neuerer Server, ein Bundle
    // mitten im Rollout), erscheint roh — nie stillschweigend als der andere
    // Zweig, wie es die kopierte Ternäre tat.
    it('falls back to the raw value for a status it does not know', () => {
      expect(getBirdStatusLabel('x' as BirdStatus)).toBe('x');
    });
  });

  describe('getAgeClassLabel', () => {
    it('names every Alter of the vocabulary', () => {
      expect(getAgeClassLabel(AgeClass.Nest)).toBe('1 – Nestling');
      expect(getAgeClassLabel(AgeClass.Unknown)).toBe('2 – Fängling (unbekannt)');
      expect(getAgeClassLabel(AgeClass.ThisYear)).toBe('3 – Diesjährig');
      expect(getAgeClassLabel(AgeClass.NotThisYear)).toBe('4 – Nicht Diesjährig');
      expect(getAgeClassLabel(AgeClass.LastYear)).toBe('5 – Vorjährig');
      expect(getAgeClassLabel(AgeClass.NotLastYear)).toBe('6 – Nicht Vorjährig');
    });

    it('reads a missing Alter as a dash', () => {
      expect(getAgeClassLabel(null)).toBe('—');
      expect(getAgeClassLabel(undefined)).toBe('—');
    });

    it('falls back to the raw value for an Alter it does not know', () => {
      expect(getAgeClassLabel(9 as AgeClass)).toBe('9');
    });
  });

  describe('getSexLabel', () => {
    it('names every Geschlecht of the vocabulary', () => {
      expect(getSexLabel(Sex.Unknown)).toBe('0 – Unbekannt');
      expect(getSexLabel(Sex.Male)).toBe('1 – Männlich');
      expect(getSexLabel(Sex.Female)).toBe('2 – Weiblich');
    });

    // `Sex.Unknown` ist 0 — der Wert, den eine Wahrheitsprüfung verschluckt.
    // Deshalb steht hier eine eigene Zusicherung: 0 ist ein erfasstes
    // Geschlecht, kein fehlendes.
    it('tells the recorded 0 apart from a missing Geschlecht', () => {
      expect(getSexLabel(Sex.Unknown)).toBe('0 – Unbekannt');
      expect(getSexLabel(null)).toBe('—');
      expect(getSexLabel(undefined)).toBe('—');
    });

    it('falls back to the raw value for a Geschlecht it does not know', () => {
      expect(getSexLabel(7 as Sex)).toBe('7');
    });
  });
});
