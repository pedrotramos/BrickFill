// Scrolls the page: "bottom" triggers lazy-loaded content and "top" returns to the start.
(position) => {
  if (position === "bottom") {
    window.scrollTo(0, Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  } else {
    window.scrollTo(0, 0);
  }
  return JSON.stringify({ href: location.href, scrollX, scrollY });
}
