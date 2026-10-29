"use strict";
/* Shared page chrome, matching the Gas Blend Scrap Factor Report header:
   a shadow under the frosted header once the page scrolls, and the Menu button on phones. */
(function () {
  function onScroll() { document.body.classList.toggle("scrolled", window.scrollY > 8); }
  window.addEventListener("scroll", onScroll, { passive: true });

  function wire() {
    onScroll();
    var btn = document.getElementById("menuBtn"), nav = document.getElementById("siteNav");
    if (!btn || !nav) return;
    btn.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", function (e) {
      if (nav.classList.contains("open") && !nav.contains(e.target) && e.target !== btn) {
        nav.classList.remove("open");
        btn.setAttribute("aria-expanded", "false");
      }
    });
  }
  if (document.readyState !== "loading") wire();
  else document.addEventListener("DOMContentLoaded", wire);
})();
