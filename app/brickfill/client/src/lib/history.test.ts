import { describe, expect, it } from 'vitest';
import { groupEvents, isRealChange, listDiff } from './history';
import type { SettingsEvent } from './settings';

const event = (id: number, patch: Partial<SettingsEvent>): SettingsEvent => ({
  id,
  scope: 'template',
  scopeId: 'dryer',
  fieldKey: 'name',
  before: null,
  after: null,
  reason: null,
  actor: 'a@x.com',
  revision: 1,
  createdAt: '2026-11-04T18:19:44.000Z',
  ...patch,
});

describe('change history', () => {
  it('groups the fields of one save by record and revision', () => {
    const groups = groupEvents([
      event(3, { revision: 2, fieldKey: 'active' }),
      event(2, { revision: 1, fieldKey: 'name', reason: 'first' }),
      event(1, { revision: 1, fieldKey: 'overrides.title_order' }),
      event(0, { scope: 'global', scopeId: '1', revision: null, fieldKey: 'market' }),
    ]);
    expect(groups.map((group) => [group.scopeId, group.revision, group.events.length, group.reason])).toEqual([
      ['dryer', 2, 1, null],
      ['dryer', 1, 2, 'first'],
      ['1', null, 1, null],
    ]);
  });

  it('shows what a list gained and lost', () => {
    expect(listDiff(['a', 'b'], ['b', 'c'])).toEqual([
      { value: 'b', change: 'kept' },
      { value: 'c', change: 'added' },
      { value: 'a', change: 'removed' },
    ]);
    expect(listDiff(null, ['a'])).toEqual([{ value: 'a', change: 'added' }]);
    expect(listDiff([{ section: 'x' }], [])).toBeNull();
  });

  it('hides events that changed nothing', () => {
    expect(isRealChange(null, [])).toBe(false);
    expect(isRealChange([{ fields: ['a'], section: 's' }], [{ section: 's', fields: ['a'] }])).toBe(false);
    expect(isRealChange(null, 'Dryer')).toBe(true);
  });
});
