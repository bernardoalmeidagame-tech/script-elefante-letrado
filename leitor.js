
 // ==UserScript==
 // @name         Auto-Seta, Pesquisa, Biblioteca e Leitura V26 LOOP
 // @namespace    http://tampermonkey.net/
 // @version      26.0
 // @description  Pesquisa, lê, finaliza, abre Biblioteca e repete enquanto estiver ativo.
 // @match        *://*/*
 // @run-at       document-idle
 // @grant        GM_setValue
 // @grant        GM_getValue
 // ==/UserScript==

 (function () {
     'use strict';

     const CHAVES = {
         ativo: 'autoSeta_executando',
         tempo: 'autoSeta_tempo',
         x: 'autoSeta_posX',
         y: 'autoSeta_posY',
         etapa: 'autoSeta_etapa'
     };

     const MENU_ID = 'tm-menu-automacao-v24';

     let timerSeta = null;
     let timerDetector = null;
     let timerEstado = null;
     let timerEsperaLeitura = null;
     let timerReinicio = null;

     let campoPesquisado = null;
     let livroClicado = null;
     let bibliotecaClicada = null;
     let finalizarClicado = null;

     let menu;
     let entradaTempo;
     let botaoAcao;
     let statusMenu;
     let ultimoTempo = null;

     let etapaAtual = GM_getValue(CHAVES.etapa, 'pesquisa');

     const ETAPAS_VALIDAS = [
         'pesquisa', 'livro', 'leitura', 'biblioteca', 'reiniciar', 'parado'
     ];

     if (!ETAPAS_VALIDAS.includes(etapaAtual)) {
         etapaAtual = 'pesquisa';
     }

     function ativo() {
         return GM_getValue(CHAVES.ativo, false);
     }

     function mudarEtapa(novaEtapa) {
         etapaAtual = novaEtapa;
         GM_setValue(CHAVES.etapa, novaEtapa);
         console.log('[V26 LOOP] Etapa:', novaEtapa);
     }

     function texto(el) {
         return (el?.innerText || el?.textContent || '')
             .replace(/\s+/g, ' ')
             .trim()
             .toLowerCase();
     }

     function visivel(el) {
         if (!el || !el.isConnected) return false;

         const estilo = el.ownerDocument.defaultView.getComputedStyle(el);
         const rect = el.getBoundingClientRect();

         return estilo.display !== 'none' &&
             estilo.visibility !== 'hidden' &&
             Number(estilo.opacity) !== 0 &&
             rect.width > 0 &&
             rect.height > 0;
     }

     // Procura elementos no documento e em Shadow DOMs abertos.
     function todosElementos(raiz = document) {
         const resultado = [];
         const visitados = new Set();

         function percorrer(atual) {
             if (!atual || visitados.has(atual)) return;
             visitados.add(atual);

             let elementos;
             try {
                 elementos = Array.from(atual.querySelectorAll('*'));
             } catch (_) {
                 return;
             }

             for (const el of elementos) {
                 resultado.push(el);
                 if (el.shadowRoot) percorrer(el.shadowRoot);
             }
         }

         percorrer(raiz);
         return resultado;
     }

     function procurar(seletor) {
         return todosElementos().filter(el => {
             try {
                 return el.matches(seletor);
             } catch (_) {
                 return false;
             }
         });
     }

     function elementoClicavel(el) {
         if (!el) return null;
         return el.closest(
             'button, a, [role="button"], [ng-click], [tabindex]'
         ) || el;
     }

     function clicar(el, descricao) {
         if (!el || !visivel(el)) return false;

         const alvo = elementoClicavel(el);
         if (!alvo || !visivel(alvo) || alvo.disabled) return false;

         try {
             alvo.click();
             console.log('[V26 LOOP] Clique:', descricao, alvo);
             mostrarStatus('Clique: ' + descricao);
             return true;
         } catch (erro) {
             console.error('[V26 LOOP] Erro ao clicar:', erro);
             return false;
         }
     }

     // --------------------------------------------------
     // PESQUISA
     // --------------------------------------------------

     function encontrarCampo() {
         const campos = procurar(
             'input[type="search"], ' +
             'input[placeholder*="pesquisar" i], ' +
             'input[placeholder*="buscar" i], ' +
             'input[placeholder*="busca" i], ' +
             'input[aria-label*="pesquisar" i], ' +
             'input[aria-label*="buscar" i], ' +
             'input.search-input'
         );

         return campos.find(el =>
             visivel(el) &&
             !el.disabled &&
             !el.readOnly &&
             !el.closest?.('#' + MENU_ID)
         ) || null;
     }

     function preencherCampo(campo, valor) {
         const janela = campo.ownerDocument.defaultView;
         const prototipo = campo instanceof janela.HTMLTextAreaElement
             ? janela.HTMLTextAreaElement.prototype
             : janela.HTMLInputElement.prototype;

         const descritor = Object.getOwnPropertyDescriptor(
             prototipo, 'value'
         );

         campo.focus();

         if (descritor?.set) {
             descritor.set.call(campo, valor);
         } else {
             campo.value = valor;
         }

         campo.dispatchEvent(new janela.Event('input', {
             bubbles: true, composed: true
         }));

         campo.dispatchEvent(new janela.Event('change', {
             bubbles: true, composed: true
         }));
     }

     function encontrarLupa(campo) {
         const raiz = campo.getRootNode();
         const seletores =
             'button[type="submit"], input[type="submit"], ' +
             'button[aria-label*="pesquisar" i], ' +
             'button[aria-label*="buscar" i], ' +
             '.search-button, .btn-search';

         if (campo.form) {
             const botao = Array.from(
                 campo.form.querySelectorAll(seletores)
             ).find(visivel);

             if (botao) return botao;
         }

         if (raiz?.querySelectorAll) {
             const botoes = Array.from(
                 raiz.querySelectorAll('button, [role="button"]')
             );

             return botoes.find(el => {
                 if (!visivel(el)) return false;

                 const descricao = [
                     el.getAttribute('aria-label'),
                     el.getAttribute('title'),
                     el.className?.baseVal || el.className,
                     el.textContent
                 ].join(' ').toLowerCase();

                 return /pesquisar|buscar|search|lupa/.test(descricao);
             }) || null;
         }

         return null;
     }

     function enviarPesquisa(campo) {
         const janela = campo.ownerDocument.defaultView;

         try {
             campo.focus();

             for (const tipo of ['keydown', 'keypress', 'keyup']) {
                 campo.dispatchEvent(new janela.KeyboardEvent(tipo, {
                     key: 'Enter',
                     code: 'Enter',
                     keyCode: 13,
                     which: 13,
                     bubbles: true,
                     cancelable: true,
                     composed: true
                 }));
             }

             if (
                 campo.form &&
                 typeof campo.form.requestSubmit === 'function'
             ) {
                 campo.form.requestSubmit();
                 return true;
             }

             const lupa = encontrarLupa(campo);
             if (lupa) return clicar(lupa, 'Pesquisar');

             console.warn('[V26 LOOP] Enter enviado; aguardando resultados.');
             return true;
         } catch (erro) {
             console.error('[V26 LOOP] Erro na pesquisa:', erro);
             return false;
         }
     }

     function pesquisar() {
         if (!ativo() || etapaAtual !== 'pesquisa') return;

         const campo = encontrarCampo();

         if (!campo) {
             mostrarStatus('Aguardando a caixa de pesquisa...');
             return;
         }

         if (campo === campoPesquisado) return;
         campoPesquisado = campo;

         try {
             preencherCampo(campo, 'letra a');
             mostrarStatus('Pesquisa preenchida; aguardando envio...');

             setTimeout(() => {
                 if (!ativo() || etapaAtual !== 'pesquisa') return;

                 if (!campo.isConnected) {
                     campoPesquisado = null;
                     return;
                 }

                 if (enviarPesquisa(campo)) {
                     mudarEtapa('livro');
                     mostrarStatus('Pesquisa enviada; procurando o livro...');
                 } else {
                     campoPesquisado = null;
                     mostrarStatus('Falha ao enviar pesquisa; tentando novamente...');
                 }
             }, 600);
         } catch (erro) {
             campoPesquisado = null;
             console.error('[V26 LOOP] Erro ao preencher pesquisa:', erro);
         }
     }

     // --------------------------------------------------
     // LIVRO
     // --------------------------------------------------

     function encontrarLivro() {
         const candidatos = procurar(
             'span.book-search-title, ' +
             '[data-ng-bind-html*="BookTitle"], ' +
             '[class*="book-search-title"]'
         );

         return candidatos.find(el => {
             const t = texto(el);
             return visivel(el) &&
                 t.includes('alfabeto') &&
                 t.includes('letra a');
         }) || null;
     }

     function clicarLivro() {
         if (!ativo() || etapaAtual !== 'livro') return;

         const livro = encontrarLivro();

         if (!livro) {
             livroClicado = null;
             mostrarStatus('Aguardando o livro Alfabeto Ilustrado. Letra A...');
             return;
         }

         if (livro === livroClicado) return;

         if (clicar(livro, 'Alfabeto Ilustrado. Letra A')) {
             livroClicado = livro;
             mudarEtapa('leitura');
             mostrarStatus('Livro aberto; preparando a leitura...');

             if (timerEsperaLeitura) clearTimeout(timerEsperaLeitura);

             timerEsperaLeitura = setTimeout(() => {
                 timerEsperaLeitura = null;
                 if (!ativo() || etapaAtual !== 'leitura') return;
                 mostrarStatus('Leitura iniciada; avançando as páginas...');
             }, 1500);
         }
     }

     // --------------------------------------------------
     // FINALIZAR LEITURA
     // --------------------------------------------------

     function encontrarFinalizar() {
         const candidatos = procurar(
             'button, a, [role="button"], [tabindex], ' +
             'input[type="button"], input[type="submit"]'
         );

         return candidatos.find(el => {
             if (!visivel(el) || el.disabled) return false;

             const descricao = [
                 texto(el),
                 el.getAttribute('aria-label') || '',
                 el.getAttribute('title') || '',
                 el.getAttribute('value') || ''
             ].join(' ').toLowerCase();

             return /finalizar leitura|finalizar a leitura/.test(descricao);
         }) || null;
     }

     function clicarFinalizar() {
         if (!ativo() || etapaAtual !== 'leitura') return;

         const botao = encontrarFinalizar();
         if (!botao) return;

         const alvo = elementoClicavel(botao);
         if (!alvo || alvo === finalizarClicado) return;

         if (clicar(alvo, 'Finalizar leitura')) {
             finalizarClicado = alvo;
             mudarEtapa('biblioteca');
             mostrarStatus('Leitura finalizada; procurando Biblioteca...');
         }
     }

     // --------------------------------------------------
     // BIBLIOTECA
     // --------------------------------------------------

     function encontrarBiblioteca() {
         const candidatos = procurar(
             'button, a, [role="button"], [tabindex], [ng-click], img'
         );

         return candidatos.find(el => {
             if (!visivel(el)) return false;

             const t = texto(el);
             const descricao = [
                 el.getAttribute('aria-label') || '',
                 el.getAttribute('title') || '',
                 el.getAttribute('alt') || '',
                 el.getAttribute('src') || '',
                 el.getAttribute('class') || ''
             ].join(' ').toLowerCase();

             const textoBiblioteca =
                 t === 'biblioteca' ||
                 t === 'minha biblioteca' ||
                 t === 'voltar à biblioteca' ||
                 t === 'voltar para biblioteca';

             const iconeBiblioteca =
                 /lib-icon\.svg|biblioteca/.test(descricao);

             return textoBiblioteca || iconeBiblioteca;
         }) || null;
     }

     function limparReferencias() {
         campoPesquisado = null;
         livroClicado = null;
         bibliotecaClicada = null;
         finalizarClicado = null;
     }

     // Reinicia o ciclo, inclusive se a página recarregar ao abrir Biblioteca.
     function programarReinicio() {
         if (!ativo() || etapaAtual !== 'reiniciar' || timerReinicio) return;

         mostrarStatus('Biblioteca aberta; preparando a próxima rodada...');

         timerReinicio = setTimeout(() => {
             timerReinicio = null;

             if (!ativo() || etapaAtual !== 'reiniciar') return;

             limparReferencias();
             mudarEtapa('pesquisa');
             mostrarStatus('Novo ciclo iniciado; procurando a pesquisa...');
             pesquisar();
         }, 2500);
     }

     function clicarBiblioteca() {
         if (!ativo() || etapaAtual !== 'biblioteca') return;

         const biblioteca = encontrarBiblioteca();

         if (!biblioteca) {
             mostrarStatus('Leitura finalizada; aguardando o botão Biblioteca...');
             bibliotecaClicada = null;
             return;
         }

         const alvo = elementoClicavel(biblioteca);
         if (!alvo || alvo === bibliotecaClicada) return;

         if (clicar(alvo, 'Biblioteca')) {
             bibliotecaClicada = alvo;

             // NÃO desativa a automação: começa uma nova rodada.
             mudarEtapa('reiniciar');
             programarReinicio();
         }
     }

     // --------------------------------------------------
     // SETA DIREITA
     // --------------------------------------------------

     function setaDireita() {
         if (!ativo() || etapaAtual !== 'leitura') return;

         const alvo = document.activeElement;

         if (
             !alvo ||
             alvo === document.body ||
             alvo === document.documentElement
         ) return;

         if (alvo.closest?.('#' + MENU_ID)) return;

         const tag = (alvo.tagName || '').toLowerCase();

         if (
             ['input', 'textarea', 'select'].includes(tag) ||
             alvo.isContentEditable
         ) return;

         try {
             const janela = alvo.ownerDocument.defaultView;

             alvo.dispatchEvent(new janela.KeyboardEvent('keydown', {
                 key: 'ArrowRight',
                 code: 'ArrowRight',
                 keyCode: 39,
                 which: 39,
                 bubbles: true,
                 cancelable: true,
                 composed: true
             }));

             setTimeout(() => {
                 try {
                     if (!alvo.isConnected) return;

                     alvo.dispatchEvent(new janela.KeyboardEvent('keyup', {
                         key: 'ArrowRight',
                         code: 'ArrowRight',
                         keyCode: 39,
                         which: 39,
                         bubbles: true,
                         cancelable: true,
                         composed: true
                     }));
                 } catch (_) {}
             }, 50);
         } catch (erro) {
             console.error('[V26 LOOP] Erro na seta:', erro);
         }
     }

     // --------------------------------------------------
     // CONTROLE
     // --------------------------------------------------

     function mostrarStatus(mensagem) {
         if (statusMenu) statusMenu.textContent = 'Status: ' + mensagem;
     }

     function lerIntervalo() {
         return Number(
             String(entradaTempo?.value ?? '')
                 .trim()
                 .replace(',', '.')
         );
     }

     function atualizarSeta() {
         const valorSalvo = String(
             GM_getValue(CHAVES.tempo, '5')
         ).replace(',', '.');

         const segundos = Number(valorSalvo);

         if (!Number.isFinite(segundos) || segundos <= 0) return;
         if (timerSeta && segundos === ultimoTempo) return;

         if (timerSeta) clearInterval(timerSeta);

         ultimoTempo = segundos;
         timerSeta = setInterval(setaDireita, Math.max(100, segundos * 1000));
     }

     function iniciarDetector() {
         if (timerDetector) return;

         timerDetector = setInterval(() => {
             if (!ativo()) return;

             switch (etapaAtual) {
                 case 'pesquisa':
                     pesquisar();
                     break;
                 case 'livro':
                     clicarLivro();
                     break;
                 case 'leitura':
                     clicarFinalizar();
                     break;
                 case 'biblioteca':
                     clicarBiblioteca();
                     break;
                 case 'reiniciar':
                     programarReinicio();
                     break;
             }
         }, 800);
     }

     function pararTudo() {
         if (timerSeta) clearInterval(timerSeta);
         if (timerDetector) clearInterval(timerDetector);
         if (timerEsperaLeitura) clearTimeout(timerEsperaLeitura);
         if (timerReinicio) clearTimeout(timerReinicio);

         timerSeta = null;
         timerDetector = null;
         timerEsperaLeitura = null;
         timerReinicio = null;
         ultimoTempo = null;

         limparReferencias();
     }

     // --------------------------------------------------
     // MENU ORIGINAL
     // --------------------------------------------------

     function criarMenu() {
         if (window !== window.top) return;
         if (document.getElementById(MENU_ID)) return;

         menu = document.createElement('div');
         menu.id = MENU_ID;

         Object.assign(menu.style, {
             position: 'fixed',
             top: GM_getValue(CHAVES.y, '10px'),
             left: GM_getValue(CHAVES.x, '10px'),
             zIndex: '2147483647',
             padding: '14px',
             background: '#151515',
             color: '#fff',
             border: '2px solid #28a745',
             borderRadius: '9px',
             boxShadow: '0 6px 20px #0009',
             font: '13px Arial,sans-serif',
             minWidth: '210px'
         });

         const cabecalho = document.createElement('div');
         cabecalho.textContent = 'Auto-Seta + Pesquisa V24';

         Object.assign(cabecalho.style, {
             cursor: 'move',
             fontWeight: 'bold',
             textAlign: 'center',
             padding: '7px',
             marginBottom: '10px',
             background: '#292929',
             borderRadius: '5px'
         });

         const rotulo = document.createElement('label');
         rotulo.textContent = 'Intervalo da seta (segundos)';

         entradaTempo = document.createElement('input');
         entradaTempo.type = 'text';
         entradaTempo.inputMode = 'decimal';
         entradaTempo.placeholder = 'Ex.: 1,7';
         entradaTempo.value = String(
             GM_getValue(CHAVES.tempo, '5')
         ).replace('.', ',');

         Object.assign(entradaTempo.style, {
             display: 'block',
             boxSizing: 'border-box',
             width: '100%',
             margin: '6px 0 10px',
             padding: '5px'
         });

         botaoAcao = document.createElement('button');
         botaoAcao.textContent = 'Iniciar';

         Object.assign(botaoAcao.style, {
             padding: '7px 14px',
             color: '#fff',
             background: '#28a745',
             border: 'none',
             borderRadius: '5px',
             cursor: 'pointer',
             fontWeight: 'bold'
         });

         statusMenu = document.createElement('div');
         statusMenu.textContent = 'Status: Parado';

         Object.assign(statusMenu.style, {
             marginTop: '9px',
             color: '#ccc',
             overflowWrap: 'anywhere'
         });

         rotulo.appendChild(entradaTempo);
         menu.append(cabecalho, rotulo, botaoAcao, statusMenu);

         (document.body || document.documentElement).appendChild(menu);

         entradaTempo.addEventListener('change', () => {
             const segundos = lerIntervalo();

             if (!Number.isFinite(segundos) || segundos <= 0) {
                 mostrarStatus('Digite um intervalo válido, como 1,7 ou 1.7.');
                 return;
             }

             GM_setValue(CHAVES.tempo, String(segundos));
             entradaTempo.value = String(segundos).replace('.', ',');

             if (ativo()) atualizarSeta();

             mostrarStatus('Intervalo salvo: ' + segundos + ' segundo(s).');
         });

         botaoAcao.addEventListener('click', () => {
             if (ativo()) {
                 GM_setValue(CHAVES.ativo, false);
                 mudarEtapa('parado');
                 pararTudo();

                 botaoAcao.textContent = 'Iniciar';
                 botaoAcao.style.background = '#28a745';
                 mostrarStatus('Parado');
                 return;
             }

             const segundos = lerIntervalo();

             if (!Number.isFinite(segundos) || segundos <= 0) {
                 mostrarStatus('Digite um intervalo válido, como 1,7 ou 1.7.');
                 return;
             }

             GM_setValue(CHAVES.tempo, String(segundos));
             GM_setValue(CHAVES.ativo, true);

             mudarEtapa('pesquisa');
             limparReferencias();

             botaoAcao.textContent = 'Parar';
             botaoAcao.style.background = '#dc3545';

             mostrarStatus('Ativo (' + segundos + 's); iniciando ciclo...');

             atualizarSeta();
             iniciarDetector();
             pesquisar();
         });

         // Arrastar o menu e salvar sua posição.
         let arrastando = false;
         let inicioX = 0;
         let inicioY = 0;
         let esquerdaInicial = 0;
         let topoInicial = 0;

         cabecalho.addEventListener('pointerdown', e => {
             if (e.button !== 0) return;

             arrastando = true;
             inicioX = e.clientX;
             inicioY = e.clientY;
             esquerdaInicial = menu.offsetLeft;
             topoInicial = menu.offsetTop;

             cabecalho.setPointerCapture(e.pointerId);
             e.preventDefault();
         });

         cabecalho.addEventListener('pointermove', e => {
             if (!arrastando) return;

             menu.style.left =
                 (esquerdaInicial + e.clientX - inicioX) + 'px';

             menu.style.top =
                 (topoInicial + e.clientY - inicioY) + 'px';
         });

         cabecalho.addEventListener('pointerup', () => {
             arrastando = false;
             GM_setValue(CHAVES.x, menu.style.left);
             GM_setValue(CHAVES.y, menu.style.top);
         });

         cabecalho.addEventListener('pointercancel', () => {
             arrastando = false;
         });

         if (ativo()) {
             botaoAcao.textContent = 'Parar';
             botaoAcao.style.background = '#dc3545';
             mostrarStatus('Ativo; etapa: ' + etapaAtual);

             atualizarSeta();
             iniciarDetector();

             if (etapaAtual === 'reiniciar') {
                 programarReinicio();
             }
         }
     }

     function iniciar() {
         if (window === window.top) criarMenu();

         if (ativo()) {
             atualizarSeta();
             iniciarDetector();

             // Recupera o ciclo se a página recarregar ao abrir Biblioteca.
             if (etapaAtual === 'reiniciar') {
                 programarReinicio();
             }
         }

         timerEstado = setInterval(() => {
             if (!ativo()) {
                 pararTudo();

                 if (botaoAcao) {
                     botaoAcao.textContent = 'Iniciar';
                     botaoAcao.style.background = '#28a745';
                     mostrarStatus('Parado');
                 }
             } else {
                 atualizarSeta();
                 iniciarDetector();

                 if (botaoAcao) {
                     botaoAcao.textContent = 'Parar';
                     botaoAcao.style.background = '#dc3545';
                 }

                 if (etapaAtual === 'reiniciar') {
                     programarReinicio();
                 }
             }
         }, 1000);
     }

     if (document.readyState === 'loading') {
         document.addEventListener('DOMContentLoaded', iniciar, { once: true });
     } else {
         iniciar();
     }

     window.addEventListener('pagehide', () => {
         if (timerEstado) clearInterval(timerEstado);
         pararTudo();
     });
 })();
