// Text map of the rendered page: every visible text node, the box of its readable context (row, item,
// paragraph...) in document coordinates, and the scroll position, so viewport screenshots can be cropped too.
() => {
  const blocks = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent.replace(/\s+/g, " ").trim();
    const element = node.parentElement;
    if (!text || !element || element.closest("script,style,noscript")) continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) === 0) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rectangles = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
    if (!rectangles.length) continue;
    let rendered = true;
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
      const ancestorStyle = getComputedStyle(ancestor);
      if (Number(ancestorStyle.opacity) < 0.1 || ancestorStyle.display === "none") {
        rendered = false;
        break;
      }
      const bounds = ancestor.getBoundingClientRect();
      const clipsX = ["hidden", "clip", "auto", "scroll"].includes(ancestorStyle.overflowX);
      const clipsY = ["hidden", "clip", "auto", "scroll"].includes(ancestorStyle.overflowY);
      if (rectangles.some(item =>
        clipsX && (item.left < bounds.left - 1 || item.right > bounds.right + 1) ||
        clipsY && (item.top < bounds.top - 1 || item.bottom > bounds.bottom + 1)
      )) {
        rendered = false;
        break;
      }
    }
    if (!rendered) continue;
    let context = element.closest("tr,li,p,dt,dd,h1,h2,h3,h4,label");
    if (!context) {
      context = element;
      for (let depth = 0; depth < 4 && context.parentElement; depth++) {
        const parent = context.parentElement;
        const bounds = parent.getBoundingClientRect();
        // stop at lists and tables built with divs: each row stays its own block ("Peso 0,600 kg")
        const rows = [...parent.children].filter(child => (child.innerText || "").trim()).length;
        if (parent === document.body || parent.innerText.length > 1200 || bounds.height > 300 || rows >= 3) break;
        context = parent;
      }
    }
    const rect = context.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const previousOverflow = context.style.overflow;
    const visible = rectangles.every(item => {
      if (item.bottom <= 0 || item.top >= innerHeight) return true;
      const hit = document.elementFromPoint(
        Math.min(innerWidth - 1, Math.max(0, item.left + item.width / 2)),
        Math.min(innerHeight - 1, Math.max(0, item.top + item.height / 2))
      );
      return hit && (context.contains(hit) || hit.contains(context));
    });
    if (!visible || previousOverflow === "hidden" && rect.height < rectangles[0].height) continue;
    blocks.push({
      text,
      box: [rect.left + scrollX, rect.top + scrollY, rect.width, rect.height]
    });
  }
  const contextText = new Map();
  for (const block of blocks) {
    const key = JSON.stringify(block.box);
    const texts = contextText.get(key) || [];
    texts.push(block.text);
    contextText.set(key, texts);
  }
  for (const block of blocks) {
    block.context = contextText.get(JSON.stringify(block.box)).join(" ");
  }
  return JSON.stringify({
    href: location.href,
    width: document.documentElement.scrollWidth,
    height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    scrollX,
    scrollY,
    blocks
  });
}
