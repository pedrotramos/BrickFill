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

/** White or BrickFill Ink, whichever contrasts more with the accent. */
export function foregroundFor(hex: string): string {
  const light = luminance(hex);
  const ink = luminance('#1B2A3A');
  const contrastWhite = 1.05 / (light + 0.05);
  const contrastInk = (Math.max(light, ink) + 0.05) / (Math.min(light, ink) + 0.05);
  return contrastWhite >= contrastInk ? '#FFFFFF' : '#1B2A3A';
}

const ACCENT_TOKENS = ['--primary', '--ring', '--sidebar-primary', '--sidebar-ring', '--chart-1'];

export function applyAccentColor(hex: string | null | undefined) {
  const root = document.documentElement;
  if (!isHexColor(hex)) {
    for (const token of [...ACCENT_TOKENS, '--primary-foreground', '--sidebar-primary-foreground']) {
      root.style.removeProperty(token);
    }
    return;
  }
  for (const token of ACCENT_TOKENS) root.style.setProperty(token, hex);
  const foreground = foregroundFor(hex);
  root.style.setProperty('--primary-foreground', foreground);
  root.style.setProperty('--sidebar-primary-foreground', foreground);
}
