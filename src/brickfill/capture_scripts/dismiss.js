// Closes a cookie consent banner the way a privacy-conscious visitor would: by refusing (never accepting) cookies,
// so the banner does not cover the product data. Consent tools often live in shadow DOM, so open shadow roots are
// searched too. Links that leave the page are never clicked.
() => {
  const refuse = /^(recusar|rejeitar|negar)( tudo| todos| todas| cookies)?$|^(reject|decline|refuse)( all)?( cookies)?$|^(usar |aceitar )?(apenas|somente) (os )?(cookies )?(necessários|essenciais|obrigatórios)$|^(use )?only (necessary|essential|required)( cookies)?$|^continuar sem aceitar$|^(rechazar|denegar)( todo| todas| cookies)?$|^(usar |aceptar )?(solo|solamente) (las )?(cookies )?(necesarias|esenciales)$|^continuar sin aceptar$/i;
  const roots = [document];
  const controls = [];
  for (let index = 0; index < roots.length && index < 200; index++) {
    for (const element of roots[index].querySelectorAll("*")) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
      if (element.matches("button, [role=button], a, input[type=button]")) controls.push(element);
    }
  }
  let dismissed = 0;
  for (const control of controls) {
    if (dismissed >= 3) break;
    const text = (control.innerText || control.textContent || control.value || "").replace(/\s+/g, " ").trim();
    if (!refuse.test(text)) continue;
    const href = control.tagName === "A" ? control.getAttribute("href") : null;
    if (href && !href.startsWith("#") && !href.startsWith("javascript:")) continue;
    try {
      control.click();
      dismissed += 1;
    } catch (error) {
      // a broken handler on the page must not stop the capture
    }
  }
  return JSON.stringify({ href: location.href, dismissed });
}
