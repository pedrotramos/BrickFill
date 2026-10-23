// Opens the content a visitor can open without leaving the page: closed <details>, controls marked
// aria-expanded="false" and "show more" buttons. Navigation, menus, forms, carts, logins and cookie banners are
// never touched, and tabs are left alone (only one panel can be shown at a time; the focused capture handles them).
() => {
  const skipZone = "nav,header,footer,form,dialog,[role=menu],[role=menubar],[role=navigation],[role=dialog],[aria-modal=true]";
  const skipText = /carrinho|comprar|compre|adicionar|login|entrar|cadastr|minha conta|cookie|aceitar|menu|cart|buy|sign in|log in|account|checkout|carrito|añadir|agregar|iniciar sesión|mi cuenta|aceptar/i;
  const moreText = /^(mostrar|ver|exibir|leia|ler|leer|show|read|see|view) (mais|more|más)(?![\p{L}\p{N}])/iu;
  const maximumClicks = 40;
  let clicks = 0;
  for (const details of document.querySelectorAll("details:not([open])")) {
    if (clicks >= maximumClicks) break;
    if (details.closest(skipZone)) continue;
    details.open = true;
    clicks += 1;
  }
  for (const element of document.querySelectorAll('[aria-expanded="false"], button, [role=button]')) {
    if (clicks >= maximumClicks) break;
    const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
    const expandable = element.getAttribute("aria-expanded") === "false";
    if (!expandable && !moreText.test(text)) continue;
    if (!text || text.length > 120 || skipText.test(text) || element.closest(skipZone)) continue;
    if (element.matches("input, select, textarea, [type=submit], [role=tab], [role=combobox], [aria-haspopup=menu], [aria-haspopup=listbox], [aria-haspopup=true]")) continue;
    const href = element.tagName === "A" ? element.getAttribute("href") : null;
    if (href && !href.startsWith("#")) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    try {
      element.click();
      clicks += 1;
    } catch (error) {
      // a broken handler on the page must not stop the capture
    }
  }
  return JSON.stringify({ href: location.href, clicks });
}
