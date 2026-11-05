import { describe, expect, it } from 'vitest';
import { categoryOptions, type CategoryTreeRow } from './category-tree';

const ROWS: CategoryTreeRow[] = [
  {
    department_id: '1',
    department: 'Eletroportáteis',
    category_id: '10',
    category: 'Cuidados pessoais',
    subcategory_id: '100',
    subcategory: 'Secadores',
    product_count: 3,
  },
  {
    department_id: '1',
    department: 'Eletroportáteis',
    category_id: '10',
    category: 'Cuidados pessoais',
    subcategory_id: '101',
    subcategory: 'Chapinhas',
    product_count: 1,
  },
];

describe('categoryOptions', () => {
  it('lists each id once per level, with its parents as the path', () => {
    expect(categoryOptions(ROWS, 'category').map((item) => [item.id, item.name, item.path])).toEqual([
      ['10', 'Cuidados pessoais', 'Eletroportáteis'],
    ]);
    expect(categoryOptions(ROWS, 'subcategory').map((item) => item.name)).toEqual(['Chapinhas', 'Secadores']);
    expect(categoryOptions(ROWS, 'subcategory')[1].path).toBe('Eletroportáteis › Cuidados pessoais');
  });

  it('attaches the synonyms of the templates that cover an option by id or name', () => {
    const options = categoryOptions(ROWS, 'subcategory', [
      { subcategory_ids: ['100'], synonyms: ['Hair dryer'] },
      { subcategory_names: ['chapinhas'], synonyms: ['Prancha'] },
    ]);
    expect(options.find((item) => item.id === '100')?.synonyms).toEqual(['Hair dryer']);
    expect(options.find((item) => item.id === '101')?.synonyms).toEqual(['Prancha']);
  });
});
