import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { ApiError, errorText } from './api-errors';

describe('errorText', () => {
  it('names a request that never reached the server', () => {
    expect(errorText(new TypeError('Failed to fetch'), 'errors:REVIEW_SAVE_FAILED')).toBe(
      i18n.t('errors:NETWORK_ERROR')
    );
  });

  it('keeps the localized server message and hides an unreadable answer', () => {
    expect(errorText(new ApiError('Stale', 409, 'REVIEW_STALE'), 'errors:REVIEW_SAVE_FAILED')).toBe('Stale');
    expect(errorText(new SyntaxError('Unexpected token <'), 'errors:REVIEW_SAVE_FAILED')).toBe(
      i18n.t('errors:REVIEW_SAVE_FAILED')
    );
  });
});
