/*
 * Service worker do painel (V7, itens 6 a 10 do PROXIMO.md). Escrito a mao,
 * sem biblioteca, para caber inteiro na cabeca de quem revisa.
 *
 * LISTA FECHADA do que guarda, e nada alem dela:
 *   - estaticos que a propria pagina pediu (rede primeiro): /_next/static/,
 *     /marca/, os icones e os favicons;
 *   - paginas: /hoje e o ULTIMO roteiro aberto (/roteiros/<id>) junto do
 *     modo gravacao dele (/roteiros/<id>/gravar).
 * Estrategia: rede primeiro; o guardado so entra quando a rede falha.
 *
 * NUNCA guarda: /admin, /api, pedido que nao seja GET, resposta que nao seja
 * 200, resposta redirecionada (sessao vencida cai em /entrar e nao pode virar
 * o "Hoje" guardado), pedido do App Router (cabecalho RSC, ?_rsc=), nada de
 * outra origem.
 *
 * O que fica guardado e dado de cliente. Por isso o nome do cache das paginas
 * leva o usuario e a marca (roteiros-paginas:<usuario>:<marca>); o escopo
 * vigente vem da pagina, que o grava em roteiros-escopo; e a pagina apaga
 * tudo ao sair, ao trocar de marca e ao abrir com outro usuario ou outra
 * marca (src/lib/offline.ts). Sem escopo, nada e guardado (falha fechada).
 *
 * Os nomes abaixo precisam ficar iguais aos de src/lib/offline.ts; o teste
 * src/lib/offline.test.ts confere.
 */
"use strict";

var VERSAO = "v1";
var CACHE_ESTATICOS = "roteiros-estaticos-" + VERSAO;
var PREFIXO_PAGINAS = "roteiros-paginas";
var CACHE_ESCOPO = "roteiros-escopo";
var CHAVE_ESCOPO = "/__escopo";
/** Teto de arquivos no cache dos estaticos: cada versao nova do aplicativo traz arquivos com nome novo, e sem teto o cache so cresceria. */
var LIMITE_ESTATICOS = 300;
var PAGINA_OFFLINE = "/offline.html";
/** Nome da marca em `Server-Timing` que diz a pagina "voce esta vendo o que foi guardado" (src/lib/offline.ts le). */
var MARCA_GUARDADO = "guardado";

var ESTATICOS_FIXOS = [
  "/favicon.svg",
  "/favicon.ico",
  "/favicon-16.png",
  "/favicon-32.png",
  "/favicon-48.png",
  "/apple-touch-icon.png",
  "/icone-192.png",
  "/icone-512.png",
  "/icone-maskable-512.png",
  "/manifest.webmanifest",
  PAGINA_OFFLINE,
];

/** So o que a pagina "Sem conexao" precisa: nada de rota do app entra aqui. */
var PRE_CACHE = [PAGINA_OFFLINE, "/icone-192.png", "/favicon.svg"];

/** /hoje, /roteiros/<id> e /roteiros/<id>/gravar. Nenhuma outra tela. */
function ehPaginaPermitida(pathname) {
  return pathname === "/hoje" || /^\/roteiros\/\d+(\/gravar)?$/.test(pathname);
}

function ehEstaticoPermitido(pathname) {
  return (
    pathname.indexOf("/_next/static/") === 0 ||
    pathname.indexOf("/marca/") === 0 ||
    ESTATICOS_FIXOS.indexOf(pathname) !== -1
  );
}

/** A navegacao interna do Next pede a arvore (cabecalho RSC); esses pedidos nunca passam por aqui. */
function ehPedidoDoAppRouter(request, url) {
  return (
    request.headers.has("rsc") ||
    request.headers.has("next-router-state-tree") ||
    request.headers.has("next-router-prefetch") ||
    url.searchParams.has("_rsc")
  );
}

/** 200, sem redirecionamento, da mesma rota pedida, e HTML: so isso pode ser guardado. */
function podeGuardar(resposta, url) {
  if (!resposta || resposta.status !== 200) return false;
  if (resposta.redirected || resposta.type !== "basic") return false;
  var destino;
  try {
    destino = new URL(resposta.url);
  } catch (erro) {
    return false;
  }
  if (destino.pathname !== url.pathname) return false;
  var tipo = resposta.headers.get("content-type") || "";
  return tipo.indexOf("text/html") !== -1;
}

function lerEscopo() {
  return caches.match(CHAVE_ESCOPO, { cacheName: CACHE_ESCOPO }).then(function (r) {
    return r ? r.text() : null;
  });
}

function nomeDoCacheDePaginas(escopo) {
  return PREFIXO_PAGINAS + ":" + escopo;
}

/** Guarda a pagina no escopo vigente; do roteiro, so o ultimo aberto (o gravar dele vai junto). */
function guardarPagina(pathname, resposta) {
  return lerEscopo().then(function (escopo) {
    if (!escopo) return undefined;
    return caches.open(nomeDoCacheDePaginas(escopo)).then(function (cache) {
      return cache.put(pathname, resposta).then(function () {
        var roteiro = /^\/roteiros\/(\d+)/.exec(pathname);
        if (!roteiro) return undefined;
        return cache.keys().then(function (chaves) {
          return Promise.all(
            chaves.map(function (chave) {
              var outro = /^\/roteiros\/(\d+)/.exec(new URL(chave.url).pathname);
              return outro && outro[1] !== roteiro[1] ? cache["delete"](chave) : undefined;
            }),
          );
        });
      });
    });
  });
}

function lerPaginaGuardada(pathname) {
  return lerEscopo().then(function (escopo) {
    if (!escopo) return undefined;
    return caches.match(pathname, { cacheName: nomeDoCacheDePaginas(escopo) });
  });
}

/**
 * A pagina servida do guardado leva `Server-Timing: guardado`. A pagina le a marca
 * (`performance.getEntriesByType("navigation")[0].serverTiming`) e acende a faixa "Sem conexao" mesmo
 * quando o navegador ainda diz `navigator.onLine === true` (sinal fraco, portal de wifi, e o proprio
 * Chromium recem-recarregado offline).
 */
function marcarComoGuardada(resposta) {
  var cabecalhos = new Headers(resposta.headers);
  cabecalhos.append("Server-Timing", MARCA_GUARDADO);
  return new Response(resposta.body, {
    status: resposta.status,
    statusText: resposta.statusText,
    headers: cabecalhos,
  });
}

function paginaOffline() {
  return caches.match(PAGINA_OFFLINE, { cacheName: CACHE_ESTATICOS }).then(function (r) {
    return (
      r ||
      new Response("Sem conexao.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    );
  });
}

function responderNavegacao(event, request, url) {
  return fetch(request).then(
    function (resposta) {
      if (ehPaginaPermitida(url.pathname) && podeGuardar(resposta, url)) {
        event.waitUntil(guardarPagina(url.pathname, resposta.clone()));
      }
      return resposta;
    },
    function () {
      // Rede caiu. So uma pagina da lista, do escopo vigente, volta do guardado; o resto (inclusive
      // /admin e /referencias) mostra "Sem conexao", nunca dado de outra tela.
      var guardada = ehPaginaPermitida(url.pathname) ? lerPaginaGuardada(url.pathname) : Promise.resolve(undefined);
      return guardada.then(function (g) {
        return g ? marcarComoGuardada(g) : paginaOffline();
      });
    },
  );
}

/**
 * Mantem o cache dos estaticos abaixo do teto: apaga os mais antigos, nunca os fixos (a pagina "Sem
 * conexao" e os icones). `keys()` vem na ordem de insercao e cada `put` refaz a insercao, entao o que
 * sobra no comeco e o que nenhuma pagina pede ha mais tempo (arquivos de versoes antigas).
 */
function podarEstaticos() {
  return caches.open(CACHE_ESTATICOS).then(function (cache) {
    return cache.keys().then(function (chaves) {
      var removiveis = chaves.filter(function (chave) {
        return ESTATICOS_FIXOS.indexOf(new URL(chave.url).pathname) === -1;
      });
      var excesso = removiveis.length - LIMITE_ESTATICOS;
      if (excesso <= 0) return undefined;
      return Promise.all(
        removiveis.slice(0, excesso).map(function (chave) {
          return cache["delete"](chave);
        }),
      );
    });
  });
}

function responderEstatico(event, request) {
  return fetch(request).then(
    function (resposta) {
      if (resposta.status === 200 && resposta.type === "basic") {
        var copia = resposta.clone();
        event.waitUntil(
          caches
            .open(CACHE_ESTATICOS)
            .then(function (cache) {
              return cache.put(request, copia);
            })
            .then(podarEstaticos),
        );
      }
      return resposta;
    },
    function (erro) {
      return caches.match(request, { cacheName: CACHE_ESTATICOS }).then(function (guardado) {
        if (guardado) return guardado;
        throw erro;
      });
    },
  );
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(CACHE_ESTATICOS)
      .then(function (cache) {
        return cache.addAll(PRE_CACHE);
      })
      .then(function () {
        return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (nomes) {
        return Promise.all(
          nomes
            .filter(function (nome) {
              return nome.indexOf("roteiros-estaticos-") === 0 && nome !== CACHE_ESTATICOS;
            })
            .map(function (nome) {
              return caches["delete"](nome);
            }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") === 0) return;
  if (ehPedidoDoAppRouter(request, url)) return;

  if (request.mode === "navigate") {
    event.respondWith(responderNavegacao(event, request, url));
    return;
  }
  if (ehEstaticoPermitido(url.pathname)) {
    event.respondWith(responderEstatico(event, request));
  }
});

/**
 * A pagina pede para guardar (ela conhece o escopo e sabe o que acabou de
 * carregar). Tudo e conferido de novo aqui contra a lista fechada.
 */
function buscarEGuardarPagina(caminho) {
  var url = new URL(caminho, self.location.origin);
  if (url.origin !== self.location.origin || !ehPaginaPermitida(url.pathname)) return Promise.resolve();
  return fetch(url.pathname, { credentials: "same-origin" })
    .then(function (resposta) {
      if (!podeGuardar(resposta, url)) return undefined;
      return guardarPagina(url.pathname, resposta.clone());
    })
    .then(function () {
      // O modo gravacao do roteiro vai junto, mesmo que o cliente nunca o tenha aberto.
      if (/^\/roteiros\/\d+$/.test(url.pathname)) return buscarEGuardarPagina(url.pathname + "/gravar");
      return undefined;
    })
    .catch(function () {
      // Sem rede na hora de guardar: fica para a proxima visita.
    });
}

function guardarEstaticos(caminhos) {
  return caches
    .open(CACHE_ESTATICOS)
    .then(function (cache) {
      return Promise.all(
        caminhos.slice(0, 200).map(function (caminho) {
          var url;
          try {
            url = new URL(caminho, self.location.origin);
          } catch (erro) {
            return undefined;
          }
          if (url.origin !== self.location.origin || !ehEstaticoPermitido(url.pathname)) return undefined;
          return cache.match(url.href).then(function (ja) {
            if (ja) return undefined;
            return fetch(url.href).then(
              function (resposta) {
                if (resposta.status === 200 && resposta.type === "basic") return cache.put(url.href, resposta);
                return undefined;
              },
              function () {
                return undefined;
              },
            );
          });
        }),
      );
    })
    .then(podarEstaticos);
}

self.addEventListener("message", function (event) {
  var dados = event.data || {};
  if (dados.tipo === "guardar-pagina" && typeof dados.caminho === "string") {
    event.waitUntil(buscarEGuardarPagina(dados.caminho));
  } else if (dados.tipo === "guardar-estaticos" && Array.isArray(dados.caminhos)) {
    event.waitUntil(guardarEstaticos(dados.caminhos));
  }
});
