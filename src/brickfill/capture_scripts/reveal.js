// Finds the element that shows one value and, if it is hidden, opens it the way a visitor would: by clicking the
// page's own control (accordion header, tab, <summary>, "show more"). Nothing is forced visible with CSS. The element
// is marked with data-catalog-evidence-target so scroll.js can center it.
(target) => {
  const normalize = text => (text || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const value = normalize(target.value);
  const needle = normalize(target.needle);
  const skip = "script,style,noscript,template,svg";
  // Text of an element with its text nodes joined by spaces, like the text map (table cells stay "Peso 0,600 kg").
  const textOf = element => {
    const parts = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.parentElement.closest(skip)) parts.push(node.textContent);
    }
    return normalize(parts.join(" "));
  };
  // Start at each text node with the value and climb to the smallest element that also holds the quoted excerpt.
  const smallest = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); value && node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest(skip) || !normalize(node.textContent).includes(value)) continue;
    for (let element = parent, depth = 0; element && element !== document.body && depth < 6; element = element.parentElement, depth++) {
      if (!needle || textOf(element).includes(needle)) {
        if (!smallest.includes(element)) smallest.push(element);
        break;
      }
    }
  }
  const hiddenAncestor = element => {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.tagName === "DETAILS" && !node.open && !element.closest("summary")) return node;
      if (node.hidden || style.display === "none" || style.visibility === "hidden" || style.contentVisibility === "hidden") return node;
      if (node.getAttribute("aria-hidden") === "true") return node;
      if (["hidden", "clip"].includes(style.overflowY) && node.getBoundingClientRect().height < 2) return node;
    }
    return null;
  };
  const controlSelector = "[aria-expanded], [aria-controls], button, summary, [role=button], [role=tab]";
  const controlFor = hidden => {
    for (let node = hidden, depth = 0; node && node !== document.body && depth < 3; node = node.parentElement, depth++) {
      if (node.id) {
        const owner = document.querySelector(`[aria-controls~="${CSS.escape(node.id)}"]`);
        if (owner) return owner;
      }
      const labelledBy = (node.getAttribute("aria-labelledby") || "").split(/\s+/)[0];
      if (labelledBy && document.getElementById(labelledBy)) return document.getElementById(labelledBy);
    }
    for (const node of [hidden, hidden.parentElement]) {
      let sibling = node ? node.previousElementSibling : null;
      for (let depth = 0; sibling && depth < 2; depth++, sibling = sibling.previousElementSibling) {
        const control = sibling.matches(controlSelector) ? sibling : sibling.querySelector(controlSelector);
        if (control) return control;
      }
    }
    return null;
  };
  if (!smallest.length) {
    // only in structured data, metadata or attributes: there is nothing a visitor could see
    return JSON.stringify({ found: false, revealedBy: [], href: location.href });
  }
  const element = smallest.find(item => !hiddenAncestor(item)) || smallest[0];
  const revealedBy = [];
  const clicked = new Set();
  for (let attempt = 0; attempt < 4; attempt++) {
    const hidden = hiddenAncestor(element);
    if (!hidden) break;
    if (hidden.tagName === "DETAILS") {
      hidden.open = true;
      revealedBy.push("details");
      continue;
    }
    const control = controlFor(hidden);
    // Never click the same control twice (it would close again) nor a link that leaves the page.
    if (!control || clicked.has(control)) break;
    const href = control.tagName === "A" ? control.getAttribute("href") : null;
    if (href && !href.startsWith("#")) break;
    clicked.add(control);
    control.click();
    revealedBy.push(
      control.getAttribute("role") === "tab" ? "tab" : control.hasAttribute("aria-controls") ? "aria-controls" : "page-control"
    );
  }
  element.setAttribute("data-catalog-evidence-target", String(target.index));
  return JSON.stringify({ found: true, hidden: Boolean(hiddenAncestor(element)), revealedBy, href: location.href });
}
