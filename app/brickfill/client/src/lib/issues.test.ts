import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { attributeReason, fieldLabel, issueMessage, issueTitle, parseParams } from './issues';
import { foregroundFor, isHexColor } from './branding';

describe('issue translation', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('interpolates params_json into the localized message', () => {
    const issue = {
      issue_code: 'INVALID_LENGTH',
      field: 'meta_description',
      message: 'Field must have between 70 and 160 characters; it has 12.',
      params_json: '{"min": 70, "max": 160, "actual": 12}',
    };
    expect(issueMessage(issue)).toBe('Meta description must have between 70 and 160 characters; it has 12.');
  });

  it('switches language', async () => {
    await i18n.changeLanguage('pt-BR');
    expect(issueTitle('EMOJI')).toBe('Emoji no conteúdo');
    expect(fieldLabel('fact.Peso')).toBe('Fato “Peso”');
    // field keys of the review history are dotted paths too
    expect(fieldLabel('review.status')).toBe('Status da revisão');
    await i18n.changeLanguage('en');
  });

  it('falls back to the stored message when params are missing or the code is unknown', () => {
    expect(issueMessage({ issue_code: 'INVALID_LENGTH', field: 'faq', message: 'stored text' })).toBe('stored text');
    expect(issueMessage({ issue_code: 'SOMETHING_NEW', message: 'from the pipeline' })).toBe('from the pipeline');
    expect(issueTitle('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('parses params defensively', () => {
    expect(parseParams('{"suffixes": ["Buy now", "Shop now"]}')).toEqual({ suffixes: 'Buy now / Shop now' });
    expect(parseParams('not json')).toEqual({});
    expect(parseParams({ min: 1 })).toEqual({ min: 1 });
    expect(parseParams(null)).toEqual({});
  });

  it('translates attribute reason codes with a text fallback', () => {
    expect(attributeReason('applicability', 'EVIDENCE_FOUND', 'x')).toBe(
      'The research found evidence for this attribute.'
    );
    expect(attributeReason('rejection', 'UNKNOWN', 'English fallback')).toBe('English fallback');
    expect(attributeReason('rejection', null, '  ')).toBeNull();
  });
});

describe('branding', () => {
  it('validates accent colors and picks a readable foreground', () => {
    expect(isHexColor('#C2410C')).toBe(true);
    expect(isHexColor('red')).toBe(false);
    expect(foregroundFor('#C2410C')).toBe('#FFFFFF');
    expect(foregroundFor('#FDE68A')).toBe('#11171C');
  });
});
