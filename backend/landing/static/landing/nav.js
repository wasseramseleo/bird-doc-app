/* BirdDoc landing — the single light JavaScript file (issue #141).
 *
 * Progressive enhancement of the marketing home's header nav, and nothing
 * else: vanilla JS, no framework, no dependencies, no requests. Without this
 * file the server-rendered nav stays fully expanded and the page works
 * unchanged; with it, narrow viewports collapse the section links behind the
 * server-rendered (but hidden-until-now) Menü toggle. Anmelden and the DE/EN
 * language toggle live outside the collapsible group and are never touched.
 * The CSS in landing.css only collapses anything once this script marks the
 * nav as enhanced, so the enhancement can never strand a visitor. */
(function () {
    "use strict";

    var nav = document.querySelector(".site-nav");
    if (!nav) {
        return;
    }
    var toggle = nav.querySelector(".site-nav__toggle");
    var sections = nav.querySelector(".site-nav__sections");
    if (!toggle || !sections) {
        return;
    }

    function setOpen(open) {
        nav.classList.toggle("site-nav--open", open);
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }

    /* Reveal the toggle and hand the collapse over to the CSS. */
    nav.classList.add("site-nav--enhanced");
    toggle.removeAttribute("hidden");

    toggle.addEventListener("click", function () {
        setOpen(!nav.classList.contains("site-nav--open"));
    });

    /* Choosing a section closes the menu — the in-page anchor scrolls, the
       header stays, and the open panel must not keep covering the target. */
    sections.addEventListener("click", function (event) {
        if (event.target.closest("a")) {
            setOpen(false);
        }
    });

    /* Escape closes the menu and returns focus to the toggle. */
    nav.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && nav.classList.contains("site-nav--open")) {
            setOpen(false);
            toggle.focus();
        }
    });
})();
