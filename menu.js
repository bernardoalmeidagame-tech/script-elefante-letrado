```javascript
// ==UserScript==
// @name         Elefante Letrado - Manter Menu Visível
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Mantém visível o menu original da automação V26.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const MENU_ID = 'tm-menu-automacao-v24';

    function manterMenuVisivel() {
        const menu = document.getElementById(MENU_ID);
        if (!menu) return;

        menu.style.setProperty('display', 'block', 'important');
        menu.style.setProperty('visibility', 'visible', 'important');
        menu.style.setProperty('opacity', '1', 'important');
        menu.style.setProperty('position', 'fixed', 'important');
        menu.style.setProperty('z-index', '2147483647', 'important');
        menu.style.setProperty('pointer-events', 'auto', 'important');

        if (!menu.isConnected) {
            (document.body || document.documentElement)
                .appendChild(menu);
        }
    }

    manterMenuVisivel();

    const observador = new MutationObserver(manterMenuVisivel);
    observador.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    setInterval(manterMenuVisivel, 1000);
})();
```