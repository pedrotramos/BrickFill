// Logo exploration for BrickFill. Writes one SVG mark per option (light and dark) and a comparison page.
// Run: node design/logo-options/build.mjs, then open design/logo-options/index.html.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = dirname(fileURLToPath(import.meta.url));

const LIGHT = { ink: '#1B2A3A', kiln: '#C2410C', faint: 'rgba(27,42,58,0.18)', bg: '#F4EDE4' };
const DARK = { ink: '#F4EDE4', kiln: '#E8743F', faint: 'rgba(244,237,228,0.22)', bg: '#1B2A3A' };

// Every mark is drawn on a 64×64 grid so the favicon sizes are comparable.
const options = [
  {
    id: 'encaixe',
    name: '1 · Encaixe',
    concept: 'Parede em amarração com o tijolo que falta sendo assentado, levemente girado. É a evolução do logo atual, sem moldura e sem tracejado, que somem em 16 px.',
    wordmark: 'brick-fill',
    mark: (c) => `
      <rect x="8" y="10" width="22" height="12" rx="2.5" fill="${c.ink}"/>
      <rect x="34" y="10" width="22" height="12" rx="2.5" fill="${c.ink}"/>
      <rect x="8" y="26" width="9" height="12" rx="2.5" fill="${c.ink}"/>
      <rect x="47" y="26" width="9" height="12" rx="2.5" fill="${c.ink}"/>
      <rect x="8" y="42" width="22" height="12" rx="2.5" fill="${c.ink}"/>
      <rect x="34" y="42" width="22" height="12" rx="2.5" fill="${c.ink}"/>
      <rect x="21" y="26" width="22" height="12" rx="2.5" fill="${c.kiln}" transform="rotate(-9 32 32)"/>`,
  },
  {
    id: 'monograma-b',
    name: '2 · Monograma B',
    concept: 'Um "B" feito de dois tijolos vazados, como tijolos de verdade. O de cima é a base existente, o de baixo é o preenchido. Lê como letra e como tijolo.',
    wordmark: 'caps',
    mark: (c) => `
      <path fill-rule="evenodd" fill="${c.ink}" d="M14 8H37A11 11 0 0 1 37 30H14Z M24 15.5H35A3.5 3.5 0 0 1 35 22.5H24Z"/>
      <path fill-rule="evenodd" fill="${c.kiln}" d="M14 34H40A11 11 0 0 1 40 56H14Z M24 41.5H38A3.5 3.5 0 0 1 38 48.5H24Z"/>`,
  },
  {
    id: 'campo',
    name: '3 · Campo',
    concept: 'Colchetes de um campo de dados com o tijolo encaixado dentro: o atributo vazio que passa a ter valor. Pega o lado técnico e de dados do produto.',
    wordmark: 'mono',
    mark: (c) => `
      <path d="M23 11H13V53H23" stroke="${c.ink}" stroke-width="6" fill="none" stroke-linejoin="miter"/>
      <path d="M41 11H51V53H41" stroke="${c.ink}" stroke-width="6" fill="none" stroke-linejoin="miter"/>
      <rect x="21" y="25" width="22" height="14" rx="3" fill="${c.kiln}"/>`,
  },
  {
    id: 'nivel',
    name: '4 · Nível',
    concept: 'Três fiadas que vão sendo preenchidas de baixo para cima: o catálogo ganhando conteúdo. Funciona como indicador de progresso e lembra camadas de dados.',
    wordmark: 'solid',
    mark: (c) => `
      <rect x="10" y="10" width="44" height="12" rx="3" fill="${c.faint}"/>
      <rect x="10" y="26" width="44" height="12" rx="3" fill="${c.faint}"/>
      <rect x="10" y="26" width="28" height="12" rx="3" fill="${c.kiln}"/>
      <rect x="10" y="42" width="44" height="12" rx="3" fill="${c.kiln}"/>`,
  },
  {
    id: 'b-preenchido',
    name: '5 · b preenchido',
    concept: 'Um "b" minúsculo geométrico cujo miolo é um tijolo, e os pingos dos dois "i" no logotipo também. É a opção mais tipográfica e amigável.',
    wordmark: 'tittles',
    mark: (c) => `
      <rect x="13" y="7" width="8" height="49" rx="4" fill="${c.ink}"/>
      <circle cx="34" cy="40" r="13" stroke="${c.ink}" stroke-width="8" fill="none"/>
      <rect x="28" y="35" width="12" height="10" rx="2" fill="${c.kiln}"/>`,
  },
  {
    id: 'pino',
    name: '6 · Tijolo com evidência',
    concept: 'Um tijolo único com um pino de localização no canto: o dado preenchido sempre vem com a fonte. Destaca o diferencial de evidência verificável.',
    wordmark: 'brick-fill',
    mark: (c) => `
      <rect x="6" y="24" width="40" height="24" rx="5" fill="${c.ink}"/>
      <rect x="12" y="30" width="18" height="12" rx="2.5" fill="${c.kiln}"/>
      <path d="M48 6a10 10 0 0 0-10 10c0 7.5 10 18 10 18s10-10.5 10-18A10 10 0 0 0 48 6Z" fill="${c.kiln}" stroke="${c.bg}" stroke-width="3"/>
      <circle cx="48" cy="16" r="3.5" fill="${c.bg}"/>`,
  },
];

const svg = (o, c, size = 64) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none"><title>BrickFill</title>${o.mark(c)}</svg>`;

const tile = (o, c, size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none"><rect width="64" height="64" rx="14" fill="${c.bg}"/><g transform="translate(5.12 5.12) scale(0.84)">${o.mark(c)}</g></svg>`;

const wordmark = (o, c) => {
  switch (o.wordmark) {
    case 'caps':
      return `<span style="font-weight:600;letter-spacing:0.14em;color:${c.ink}">BRICK<span style="color:${c.kiln}">FILL</span></span>`;
    case 'mono':
      return `<span style="font-family:ui-monospace,'SF Mono',Menlo,monospace;font-weight:600;letter-spacing:-0.02em;color:${c.ink}">brick<span style="color:${c.kiln}">fill</span></span>`;
    case 'solid':
      return `<span style="font-weight:800;letter-spacing:-0.03em;color:${c.ink}">BrickFill</span>`;
    case 'tittles': {
      // Dotless i with a square brick as the dot; the second one is filled.
      const i = (fill) =>
        `<span style="position:relative;display:inline-block">ı<span style="position:absolute;left:50%;top:0.08em;width:0.22em;height:0.17em;transform:translateX(-50%);border-radius:0.03em;background:${fill}"></span></span>`;
      return `<span style="font-weight:700;letter-spacing:-0.02em;font-variant-ligatures:none;color:${c.ink}">br${i(c.ink)}ckf${i(c.kiln)}ll</span>`;
    }
    default:
      return `<span style="font-weight:700;letter-spacing:-0.02em;color:${c.ink}">Brick<span style="color:${c.kiln}">Fill</span></span>`;
  }
};

const lockup = (o, c) =>
  `<div class="lockup" style="background:${c.bg}">${svg(o, c, 44)}<span class="wm">${wordmark(o, c)}</span></div>`;

const header = (o, c, dark) =>
  `<div class="header ${dark ? 'dark' : ''}">${svg(o, c, 28)}<span class="hwm">${wordmark(o, c)}</span><span class="nav">Overview&nbsp;&nbsp;Catalog&nbsp;&nbsp;Settings</span></div>`;

const tabs = (o) =>
  `<div class="tabs">
    <div class="tab">${tile(o, DARK, 16)}<span>BrickFill</span></div>
    <div class="tab light">${svg(o, LIGHT, 16)}<span>BrickFill</span></div>
    <div class="sizes">${[16, 24, 32, 48].map((s) => tile(o, DARK, s)).join('')}${[16, 32].map((s) => svg(o, LIGHT, s)).join('')}</div>
  </div>`;

const card = (o) => `
  <section class="card" id="${o.id}">
    <h2>${o.name}</h2>
    <p>${o.concept}</p>
    <div class="row">
      <div class="big" style="background:${LIGHT.bg}">${svg(o, LIGHT, 120)}</div>
      <div class="big" style="background:${DARK.bg}">${svg(o, DARK, 120)}</div>
      <div class="big plain">${tile(o, DARK, 120)}</div>
    </div>
    ${lockup(o, LIGHT)}
    ${lockup(o, DARK)}
    ${header(o, LIGHT, false)}
    ${tabs(o)}
  </section>`;

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>BrickFill · opções de logo</title>
<style>
  body { margin: 0; padding: 32px; background: #ECE7E1; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1B2A3A; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .lead { margin: 0 0 24px; color: #5b6673; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(440px, 1fr)); gap: 20px; }
  .card { background: #fff; border-radius: 16px; padding: 20px; box-shadow: 0 1px 2px rgba(0,0,0,.06); display: flex; flex-direction: column; gap: 12px; }
  .card h2 { margin: 0; font-size: 17px; }
  .card p { margin: 0; font-size: 13px; line-height: 1.45; color: #4a5562; min-height: 56px; }
  .row { display: flex; gap: 10px; }
  .big { flex: 1; display: flex; align-items: center; justify-content: center; border-radius: 12px; padding: 14px 0; }
  .big.plain { background: #fff; border: 1px dashed #d8d2ca; }
  .lockup { display: flex; align-items: center; gap: 12px; border-radius: 12px; padding: 14px 18px; }
  .wm { font-size: 30px; line-height: 1; }
  .header { display: flex; align-items: center; gap: 9px; height: 52px; padding: 0 16px; border-radius: 10px; background: #fff; border: 1px solid #e6e1da; }
  .hwm { font-size: 18px; line-height: 1; }
  .nav { margin-left: auto; font-size: 13px; color: #6b7480; }
  .tabs { display: flex; align-items: center; gap: 8px; background: #DAD4CC; border-radius: 10px; padding: 8px; flex-wrap: wrap; }
  .tab { display: flex; align-items: center; gap: 6px; background: #2a2f36; color: #e9e6e1; font-size: 12px; padding: 6px 10px; border-radius: 8px; }
  .tab.light { background: #fff; color: #333; }
  .sizes { display: flex; align-items: center; gap: 10px; margin-left: auto; }
</style>
</head>
<body>
<h1>BrickFill · opções de logo</h1>
<p class="lead">Cada card mostra o símbolo em fundo claro, escuro e como ícone de app; o logotipo nos dois fundos; o header do app; e o favicon em tamanho real (16, 24, 32 e 48 px).</p>
<div class="grid">${options.map(card).join('')}</div>
</body>
</html>`;

writeFileSync(join(out, 'index.html'), html);
for (const o of options) {
  writeFileSync(join(out, `${o.id}.svg`), svg(o, LIGHT));
  writeFileSync(join(out, `${o.id}-dark.svg`), svg(o, DARK));
}
console.log(`wrote index.html and ${options.length * 2} SVGs to ${out}`);
