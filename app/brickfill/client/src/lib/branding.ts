/** Runtime co-branding: the customer's accent color replaces the BrickFill primary (BRAND_ACCENT_COLOR). */
const HEX = /^#([0-9a-f]{6})$/i;

export function isHexColor(value: string | null | undefined): value is string {
  return Boolean(value && HEX.test(value));
}

/** Relative luminance (WCAG) of a #RRGGBB color. */
export function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White or the near-black text color, whichever contrasts more with the accent. */
export function foregroundFor(hex: string): string {
  const light = luminance(hex);
  const ink = luminance('#11171C');
  const contrastWhite = 1.05 / (light + 0.05);
  const contrastInk = (Math.max(light, ink) + 0.05) / (Math.min(light, ink) + 0.05);
  return contrastWhite >= contrastInk ? '#FFFFFF' : '#11171C';
}

const ACCENT_TOKENS = ['--primary', '--ring', '--sidebar-primary', '--sidebar-ring', '--chart-1'];

export function applyAccentColor(hex: string | null | undefined) {
  const root = document.documentElement;
  if (!isHexColor(hex)) {
    for (const token of [...ACCENT_TOKENS, '--primary-foreground', '--sidebar-primary-foreground', '--primary-hover']) {
      root.style.removeProperty(token);
    }
    return;
  }
  for (const token of ACCENT_TOKENS) root.style.setProperty(token, hex);
  const foreground = foregroundFor(hex);
  root.style.setProperty('--primary-foreground', foreground);
  root.style.setProperty('--sidebar-primary-foreground', foreground);
  // the hover step of the accent, darker for a light text color and lighter for a dark one
  root.style.setProperty(
    '--primary-hover',
    `color-mix(in oklch, ${hex} 78%, ${foreground === '#FFFFFF' ? 'black' : 'white'})`
  );
}
