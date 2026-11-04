// Closes the notices that cover a product page besides the cookie banner: welcome tours, location or region prompts,
// newsletters, notification requests and stacked dialogs (only with the dismiss_overlays job parameter). It answers
// like a cautious visitor, choosing from a closed list of labels in this order: refuse, skip, not now, confirm skipping
// the tour, cancel the location request, continue (a region notice), close. Nothing is ever accepted or subscribed.
// A cookie layer with no answer button is hidden for the capture only; no consent is recorded or sent.
// Safeguards: never acts on <html>, <body>, <main> or on a layer holding most of the page text; a "large" layer is
// measured against a screen of at most 1920x1080, never against the (possibly 100000 px tall) window; links that leave
// the page are never clicked. The capture runs it a few times, because answering a notice can open another one.
() => {
  const screenWidth = Math.min(innerWidth, 1920);
  const screenHeight = Math.min(innerHeight, 1080);
  const NOTICE = /cookie|privacidad|privacidade|privacy|consent|lgpd|gdpr|rgpd|localiza|location|ubicaci|geoloc|regi[aãoó]n?|region|\bcep\b|c[oó]digo postal|zip ?code|postcode|bem-vind|bienvenid|welcome|tutorial|\btour\b|newsletter|bolet[ií]n|inscreva|suscr[ií]b|subscribe|notifica|notification|alerta|ofertas? (por|no) e-?mail/i;
  const COOKIE = /cookie|privacidad|privacidade|privacy|consent|lgpd|gdpr|rgpd/i;
  const LAYER_CLASS = /modal|popup|pop-up|overlay|consent|banner|dialog|lightbox|interstitial|drawer|toast/i;
  const LABELS = [
    // refuse
    /^(recusar|rejeitar|negar|bloquear|n[aã]o permitir)( tudo| todos| todas| cookies)?$|^(reject|decline|refuse|block|deny|don'?t allow)( all)?( cookies)?$|^(rechazar|denegar|bloquear|no permitir)( todo| todas| cookies)?$|^(usar |aceitar )?(apenas|somente) (os )?(cookies )?(necess[aá]rios|essenciais|obrigat[oó]rios)$|^(use )?only (necessary|essential|required)( cookies)?$|^(usar |aceptar )?(solo|solamente) (las )?(cookies )?(necesarias|esenciales)$|^continuar sem aceitar$|^continuar sin aceptar$|^continue without accepting$/i,
    // skip
    /^(pular|ignorar|skip|omitir|saltar)( (tutorial|tour|introdu[cç][aã]o|intro|introducci[oó]n|etapa|step|paso))?$/i,
    // not now
    /^(agora n[aã]o|depois|mais tarde|talvez depois|n[aã]o,? obrigad[oa]|not now|later|maybe later|no,? thanks|no thank you|ahora no|m[aá]s tarde|quiz[aá]s m[aá]s tarde|no,? gracias)$/i,
    // confirm skipping a tour
    /^(sim,? (pular|sair|encerrar)|sair do (tutorial|tour)|encerrar (tutorial|tour)|yes,? (skip|exit|end)|exit (the )?(tutorial|tour)|end (the )?tour|s[ií],? (omitir|saltar|salir)|salir del (tutorial|tour))$/i,
    // cancel a location request
    /^(cancelar|cancel|agora n[aã]o permitir|usar outra localiza[cç][aã]o|escolher depois|elegir despu[eé]s|choose later)$/i,
    // continue (a region or store notice)
    /^(continuar|continue|seguir|continuar comprando|continue shopping|seguir comprando|ok,? entendi|entendi|got it|entendido)$/i,
    // close
    /^(fechar|close|cerrar|dismiss|×|✕|✖|x)$/i,
  ];
  // never clicked, whatever the layer: these accept, subscribe, sign in or leave
  const NEVER = /aceit|accept|acept|permitir|allow|concordo|agree|autorizo|inscrev|subscrib|suscrib|cadastr|registr|sign ?up|sign ?in|log ?in|entrar|ingresar|comprar|buy|adicionar|add to|ativar|activate|enable|habilitar|ver ofertas|quero/i;
  const PROTECTED = new Set([document.documentElement, document.body, document.querySelector("main")].filter(Boolean));
  const pageText = (document.body && document.body.innerText || "").length || 1;

  const roots = [document];
  const elements = [];
  for (let index = 0; index < roots.length && index < 200; index++) {
    for (const element of roots[index].querySelectorAll("*")) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
      elements.push(element);
    }
  }
  const visible = element => {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const screenShare = element => {
    const rect = element.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, screenWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, screenHeight) - Math.max(rect.top, 0));
    return (width * height) / (screenWidth * screenHeight);
  };
  // a layer that holds most of the page (or the page itself) is never touched
  const isProtected = element =>
    PROTECTED.has(element) ||
    [...PROTECTED].some(item => element.contains(item) && item !== document.documentElement && item !== document.body) ||
    (element.innerText || "").length > 0.5 * pageText;
  const text = element =>
    (element.innerText || element.textContent || element.value || element.getAttribute("aria-label") || element.getAttribute("title") || "")
      .replace(/\s+/g, " ")
      .trim();

  const layers = [];
  for (const element of elements) {
    // cheap checks first: innerText forces a layout
    const role = element.getAttribute("role") || "";
    const modal = element.tagName === "DIALOG" || /^(alert)?dialog$/.test(role) || element.getAttribute("aria-modal") === "true";
    const named = LAYER_CLASS.test(`${element.id} ${typeof element.className === "string" ? element.className : ""}`);
    const position = getComputedStyle(element).position;
    const floating = position === "fixed" || position === "sticky";
    if (!(modal || named || floating)) continue;
    if (!visible(element) || isProtected(element)) continue;
    const content = (element.innerText || "").slice(0, 3000);
    // a floating element counts when it is large, or when it is a short cookie notice (a bottom banner)
    const cookieBar = floating && COOKIE.test(content) && content.length < 600;
    if (!(modal || named || cookieBar || screenShare(element) >= 0.25)) continue;
    if (!NOTICE.test(content) && !(modal && screenShare(element) >= 0.25)) continue;
    // keep the outermost layer only (a dialog inside an overlay is handled with it)
    if (layers.some(layer => layer.contains(element))) continue;
    for (let index = layers.length - 1; index >= 0; index--) if (element.contains(layers[index])) layers.splice(index, 1);
    layers.push(element);
  }

  const actions = [];
  for (const layer of layers.slice(0, 5)) {
    const controls = [...layer.querySelectorAll("button, [role=button], a, input[type=button], input[type=submit]")]
      .filter(visible)
      .map(control => ({ control, label: text(control).slice(0, 80) }))
      .filter(({ control, label }) => {
        if (!label || NEVER.test(label)) return false;
        const href = control.tagName === "A" ? control.getAttribute("href") : null;
        return !href || href.startsWith("#") || href.startsWith("javascript:");
      });
    let chosen = null;
    for (const pattern of LABELS) {
      chosen = controls.find(({ label }) => pattern.test(label));
      if (chosen) break;
    }
    if (chosen) {
      try {
        chosen.control.click();
        actions.push({ kind: "click", label: chosen.label });
      } catch (error) {
        // a broken handler on the page must not stop the capture
      }
      continue;
    }
    const answers = layer.querySelectorAll("button, [role=button], input[type=button], input[type=submit]").length;
    if (COOKIE.test(layer.innerText || "") && answers === 0) {
      layer.setAttribute("data-catalog-hidden-notice", "cookie");
      layer.style.setProperty("visibility", "hidden", "important");
      actions.push({ kind: "hide", label: text(layer).slice(0, 80) });
    }
  }
  return JSON.stringify({ href: location.href, layers: layers.length, actions });
}
