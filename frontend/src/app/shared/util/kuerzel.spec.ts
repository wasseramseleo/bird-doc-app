import { deriveHandle } from './kuerzel';

describe('deriveHandle', () => {
  it('derives the first initial plus the first two of the surname', () => {
    expect(deriveHandle('Filip', 'Reiter')).toBe('FRE');
  });

  it('folds umlauts to ASCII (Jana Müller -> JMU)', () => {
    expect(deriveHandle('Jana', 'Müller')).toBe('JMU');
  });

  it('normalises to uppercase regardless of typed casing', () => {
    expect(deriveHandle('filip', 'reiter')).toBe('FRE');
  });
});
