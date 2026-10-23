// Scrolls the page: "bottom" triggers lazy-loaded content, "top" returns to the start, and a target index
// centers the element marked by reveal.js so the viewport screenshot shows it.
(position) => {
  if (position === "bottom") {
    window.scrollTo(0, Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  } else if (position === "top") {
    window.scrollTo(0, 0);
  } else {
    const element = document.querySelector(`[data-catalog-evidence-target="${position}"]`);
    if (element) element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  }
  return JSON.stringify({ href: location.href, scrollX, scrollY });
}
