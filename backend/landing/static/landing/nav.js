/* BirdDoc landing — the single light JavaScript file (issues #141, #144).
 *
 * Progressive enhancement of the marketing home, in two parts, and nothing
 * else: vanilla JS, no framework, no dependencies, no requests.
 *
 * 1. The header nav (issue #141): without this file the server-rendered nav
 *    stays fully expanded and the page works unchanged; with it, narrow
 *    viewports collapse the section links behind the server-rendered (but
 *    hidden-until-now) Menü toggle. Anmelden and the DE/EN language toggle
 *    live outside the collapsible group and are never touched. The CSS in
 *    landing.css only collapses anything once this script marks the nav as
 *    enhanced, so the enhancement can never strand a visitor.
 *
 * 2. Motion (issue #144): quiet scroll reveals for the page sections, plus
 *    exactly ONE orchestrated moment on arrival — the hero Fang-Karte fills
 *    in field by field, ending on the Ringserie ticking to the next number.
 *    Every bit of it keys on js-* classes this script adds at runtime, so
 *    without JavaScript nothing is ever hidden; under prefers-reduced-motion
 *    the whole part refuses to run. */
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

/* Motion (issue #144). The nav enhancement above runs for everyone — it is
 * not motion. Everything below IS, so it sits behind the reduced-motion
 * gate: under prefers-reduced-motion the script adds no class at all and the
 * server-rendered page — including the CSS-guarded Ringserie load reveal,
 * itself suppressed by the same media query — stays entirely still. */
(function () {
    "use strict";

    if (!window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
    }

    /* Quiet scroll reveals, the secondary layer: the page sections below the
       hero ease in as they scroll into view. Feature-checked and hidden only
       at the instant observing begins, so no browser is ever stranded on an
       invisible section. The hero is deliberately NOT a target — it belongs
       to the orchestrated moment alone. */
    if ("IntersectionObserver" in window) {
        var targets = document.querySelectorAll(
            ".fork, .audience, .formular-proof, .compare, .hosting, .pricing"
        );
        var observer = new IntersectionObserver(
            function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("js-reveal--in");
                        observer.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.12 }
        );
        targets.forEach(function (el) {
            el.classList.add("js-reveal");
            observer.observe(el);
        });
    }

    /* The ONE orchestrated moment: on arrival the hero Fang-Karte fills in
       field by field, ending on the Ringserie ticking from the last consumed
       number to the suggested next one — die nächste Nummer ist die letzte
       verbrauchte + 1, performed once, in motion. */
    var karte = document.querySelector(".hero .fang-karte");
    var ringserie = document.querySelector(".ringserie");
    if (!karte || !ringserie) {
        return;
    }

    var fills = karte.querySelectorAll(
        ".fang-karte__ring, .fang-karte__species, .fang-karte__sci," +
            " .fang-karte__cell, .fang-karte__foot"
    );

    /* Take the thread's CSS load reveal over: remove the animation class and
       stage the thread hidden, so it lands as the moment's finale instead of
       racing the card fill. (Under reduced motion this code never runs and
       the CSS-guarded load reveal is equally suppressed — coordinated.) */
    ringserie.classList.remove("ringserie--reveal");
    ringserie.classList.add("js-stage");

    fills.forEach(function (el) {
        el.classList.add("js-fill");
    });

    /* Build the tick on the server-rendered next-number element: the real
       next number (kept as the accessible text) rolls in over a purely
       decorative copy of the last consumed one. */
    var next = ringserie.querySelector(".ringserie__next");
    var nums = ringserie.querySelectorAll(".ringserie__num");
    var tick = null;
    if (next && nums.length) {
        var to = document.createElement("span");
        to.className = "js-tick__to";
        while (next.firstChild) {
            to.appendChild(next.firstChild);
        }
        var from = document.createElement("span");
        from.className = "js-tick__from";
        from.setAttribute("aria-hidden", "true");
        from.textContent = nums[nums.length - 1].textContent;
        next.classList.add("js-tick");
        next.appendChild(from);
        next.appendChild(to);
        tick = next;
    }

    var step = 160;
    fills.forEach(function (el, i) {
        window.setTimeout(function () {
            el.classList.add("js-fill--in");
        }, 250 + i * step);
    });
    var filled = 250 + fills.length * step;
    window.setTimeout(function () {
        ringserie.classList.add("js-stage--in");
    }, filled + 150);
    if (tick) {
        window.setTimeout(function () {
            tick.classList.add("js-tick--now");
        }, filled + 850);
    }
})();
