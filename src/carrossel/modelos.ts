/**
 * E65 PR 2: os modelos de slide FINAIS do carrossel, os onze tipos do desenho (`entregaveis/design-v2/entrega/carrossel/`, 25/11/2026): um modelo por tipo, em HTML e CSS (`estilo.ts`), que vira PNG no Chromium
 * (`render.ts`). Tudo sai de UMA cor, a da marca (`--marca`), e do modo do slide (claro, escuro ou marca); a tinta sobre a cor cheia é CALCULADA (`tintaSobre`), nunca escolhida; o progresso nasce de
 * `data-pos` e `data-total` (sem progresso quando o total é 1, a capa de notícia). Nada do aplicativo entra no PNG: só a cor e o @ do cliente. As letras (Mona Sans e JetBrains Mono) vêm do disco e vão
 * dentro do HTML em base64, para o PNG ser igual em qualquer máquina.
 *
 * Aqui também moram as contas de cor (mistura em oklab como o `color-mix` do navegador, contraste, a cor que escurece até ler bem) e a ordem dos modos num carrossel. Funções puras, testadas sem navegador.
 */
import { ALTURA_DO_SLIDE, LARGURA_DO_SLIDE, TEXTO_FIXO_DA_AUTORIZACAO, ehCapa, type SlideDoCarrossel, type TipoDeSlide } from "@/config/carrossel";
import { escaparHtml } from "@/lib/chromium-de-impressao";

import { ESTILO_DOS_SLIDES } from "./estilo";

export type FotoParaOModelo = { tipo: string; base64: string };
export type ModoDoSlide = "claro" | "escuro" | "marca";

export type DadosDoModelo = {
  slide: SlideDoCarrossel;
  /** A posição do slide (1 a N) e o total. Total 1 (a capa de notícia) não tem progresso. */
  numero: number;
  total: number;
  /** A cor da marca, "#rrggbb", já passada por `garantirLeitura`. */
  cor: string;
  /** O @ da marca, com o arroba ("@clinica.exemplo"), ou vazio. */
  arroba: string;
  modo: ModoDoSlide;
  foto?: FotoParaOModelo | null;
  fotoDepois?: FotoParaOModelo | null;
  /** As letras em base64 (woff2), ou nulas: sem elas, a letra do sistema. */
  fontes: { mona: string | null; mono: string | null };
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// As contas de cor

const HEX = /^#[0-9a-fA-F]{6}$/;

export function corValida(cor: string): boolean {
  return HEX.test(cor);
}

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

const paraHex = (canais: number[]): string => `#${canais.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gama = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);

function paraOklab(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((v) => linear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function deOklab([L, a, b]: [number, number, number]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return paraHex([
    gama(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255,
    gama(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255,
    gama(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255,
  ]);
}

/** O `color-mix(in oklab, a parteA%, b)` do CSS, para as contas de contraste baterem com o que o navegador desenha. */
export function misturarOklab(a: string, parteA: number, b: string): string {
  const [x, y] = [paraOklab(a), paraOklab(b)];
  const p = parteA / 100;
  return deOklab([x[0] * p + y[0] * (1 - p), x[1] * p + y[1] * (1 - p), x[2] * p + y[2] * (1 - p)]);
}

/** Luminância relativa (0 a 1). */
function luminancia(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => linear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** A razão de contraste entre duas cores (WCAG). */
export function contraste(a: string, b: string): number {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const TINTA_CLARA = "#ffffff";
const TINTA_ESCURA = "#141414";

/** A tinta que vai sobre a cor cheia da marca: branco ou quase preto, o que der mais contraste. Nunca escolhida à mão (desenho, `slides.js`). */
export function tintaSobre(cor: string): string {
  return contraste(cor, TINTA_CLARA) >= contraste(cor, TINTA_ESCURA) ? TINTA_CLARA : TINTA_ESCURA;
}

/** As cores que o CSS tira de `--marca` em cada modo (as mesmas contas de `estilo.ts`, em oklab), para conferir o contraste sem navegador. */
export function coresDoModo(marca: string, modo: ModoDoSlide): { fundo: string; titulo: string; texto: string; suave: string; acento: string; cheio: string; sobreCheio: string } {
  const sobre = tintaSobre(marca);
  if (modo === "claro") {
    return {
      fundo: misturarOklab(marca, 6, "#fbfaf7"),
      titulo: misturarOklab(marca, 30, "#0c0c0e"),
      texto: misturarOklab(marca, 16, "#2a2a2f"),
      suave: misturarOklab(marca, 20, "#55555c"),
      acento: misturarOklab(marca, 88, "#000000"),
      cheio: marca,
      sobreCheio: sobre,
    };
  }
  if (modo === "escuro") {
    return {
      fundo: misturarOklab(marca, 22, "#0a0b0c"),
      titulo: "#fbfbfa",
      texto: misturarOklab(marca, 10, "#e6e6e8"),
      suave: misturarOklab(marca, 16, "#b9b9bf"),
      acento: misturarOklab(marca, 52, "#ffffff"),
      cheio: misturarOklab(marca, 52, "#ffffff"),
      sobreCheio: misturarOklab(marca, 30, "#0c0c0e"),
    };
  }
  return {
    fundo: marca,
    titulo: sobre,
    texto: misturarOklab(sobre, 90, marca),
    suave: misturarOklab(sobre, 78, marca),
    acento: sobre,
    cheio: sobre,
    sobreCheio: marca,
  };
}

/** O piso do apoio (letra a partir de 26 px, "letra grande" para a acessibilidade) sobre a cor cheia. O desenho pede 4,5; com 4,0 o laranja do próprio exemplo dele (4,2) não é repintado. */
export const CONTRASTE_MINIMO_DO_APOIO = 4;
/** O piso do acento no claro, que só aparece em letra de 64 px ou mais ou como forma (desenho, "As variáveis"). */
export const CONTRASTE_MINIMO_DO_ACENTO = 3;

function leBem(cor: string): boolean {
  const claro = coresDoModo(cor, "claro");
  const cheia = coresDoModo(cor, "marca");
  const escuro = coresDoModo(cor, "escuro");
  return (
    contraste(claro.acento, claro.fundo) >= CONTRASTE_MINIMO_DO_ACENTO &&
    contraste(cheia.suave, cheia.fundo) >= CONTRASTE_MINIMO_DO_APOIO &&
    contraste(escuro.acento, escuro.fundo) >= CONTRASTE_MINIMO_DO_ACENTO
  );
}

/**
 * A cor da marca precisa ler bem em todo modo: se o acento do claro (ou do escuro) ficar abaixo de 3:1, ou o apoio da cor cheia abaixo do piso (cor clara demais, um amarelo), escurece 10% por vez até
 * passar. Devolve a cor a usar e se teve de mudar (o serviço guarda um aviso para a pessoa).
 */
export function garantirLeitura(cor: string): { cor: string; escureceu: boolean } {
  let atual = cor;
  let escureceu = false;
  for (let i = 0; i < 40 && !leBem(atual); i += 1) {
    atual = misturarOklab(atual, 90, "#000000");
    escureceu = true;
  }
  return { cor: atual, escureceu };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// A ordem dos modos

/**
 * Os modos de um carrossel (desenho, regra 2): alternam, nunca três iguais. A capa com foto é escura de propósito (a foto manda), a capa sem foto, o dado (se o de antes não é cor cheia) e a chamada vão na
 * cor cheia, o resto alterna claro e escuro a partir do último que não foi cor cheia.
 */
export function modosDosSlides(slides: { tipo: TipoDeSlide; comFoto?: boolean }[]): ModoDoSlide[] {
  const modos: ModoDoSlide[] = [];
  let ultimoLisoEscuro = true;
  slides.forEach((s, i) => {
    let modo: ModoDoSlide;
    if (s.tipo === "capa-foto" && s.comFoto !== false) modo = "escuro";
    else if (ehCapa(s.tipo) || s.tipo === "chamada") modo = "marca";
    else if (s.tipo === "dado" && modos[i - 1] !== "marca") modo = "marca";
    else modo = ultimoLisoEscuro ? "claro" : "escuro";
    if (modo === "claro") ultimoLisoEscuro = false;
    else if (modo === "escuro") ultimoLisoEscuro = true;
    modos.push(modo);
  });
  return modos;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// O HTML de cada tipo

const esc = escaparHtml;

const ICONES: Record<string, string> = {
  arraste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15"/><path d="m13 6 6 6-6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
  salvar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  mandar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4z"/></svg>',
};

const FOCO_VALIDO = /^\d{1,3}% \d{1,3}%$/;

function bloco(classe: string, foto: FotoParaOModelo | null | undefined, foco?: string): string {
  if (!foto) return "";
  const posicao = foco && FOCO_VALIDO.test(foco) ? foco : "50% 50%";
  return `<div class="s-foto ${classe}"><img src="data:${esc(foto.tipo)};base64,${foto.base64}" alt="" style="object-position:${posicao}"></div>`;
}

const topo = (rotulo: string | undefined, direita = ""): string => `<header class="s-topo">${rotulo ? `<span class="s-rotulo">${esc(rotulo)}</span>` : "<span></span>"}${direita}</header>`;

/** O tipo que de fato se desenha: um tipo que pede foto e não tem foto cai no modelo sem foto. O passo e o antes e depois sem foto têm modelo próprio; a capa com foto sem foto vira a capa de texto. */
export function tipoDesenhado(slide: SlideDoCarrossel, temFoto: boolean): TipoDeSlide {
  return slide.tipo === "capa-foto" && !temFoto ? "capa-texto" : slide.tipo;
}

/** O slide precisa de uma foto que não tem (resultado, notícia): a tela avisa a pessoa em vez de desenhar um vazio. */
export function faltaFoto(slide: SlideDoCarrossel, temFoto: boolean): boolean {
  return !temFoto && (slide.tipo === "prova-resultado" || slide.tipo === "noticia");
}

function miolo(d: DadosDoModelo, tipo: TipoDeSlide, fotoTopo: boolean): string {
  const s = d.slide;
  switch (tipo) {
    case "capa-foto":
      return fotoTopo
        ? bloco("topo", d.foto, s.foco) + topo(s.rotulo) + `<div class="s-corpo"><h1 class="s-titulo-capa">${esc(s.titulo)}</h1>${s.sub ? `<p class="s-sub">${esc(s.sub)}</p>` : ""}</div>`
        : bloco("fundo", d.foto, s.foco) + topo(s.rotulo) + `<div class="s-corpo na-base"><h1 class="s-titulo-capa">${esc(s.titulo)}</h1>${s.sub ? `<p class="s-sub">${esc(s.sub)}</p>` : ""}</div>`;
    case "capa-texto":
      return (
        topo(s.rotulo) +
        `<div class="s-corpo"><span class="s-marcador"></span><h1 class="s-titulo-capa">${esc(s.titulo)}</h1>${s.sub ? `<p class="s-sub">${esc(s.sub)}</p>` : ""}<span class="s-arraste">Arraste<span>${ICONES.arraste}</span></span></div>`
      );
    case "passo": {
      const rotulo = s.de ? `Passo ${s.numero ?? 1} de ${s.de}` : `Passo ${s.numero ?? 1}`;
      return (
        topo(rotulo) +
        (d.foto
          ? `<div class="s-corpo">${bloco("", d.foto, s.foco)}<div class="s-linha-passo"><span class="s-numero">${esc(String(s.numero ?? 1))}</span><div style="display:grid;gap:24px"><h2 class="s-titulo">${esc(s.titulo)}</h2><p class="s-texto">${esc(s.texto ?? "")}</p></div></div></div>`
          : `<div class="s-corpo"><span class="s-numero">${esc(String(s.numero ?? 1))}</span><h2 class="s-titulo">${esc(s.titulo)}</h2><p class="s-texto">${esc(s.texto ?? "")}</p></div>`)
      );
    }
    case "item":
      return topo(s.rotulo || "Dica") + `<div class="s-corpo"><h2 class="s-titulo s-com-traco">${esc(s.titulo)}</h2><p class="s-texto">${esc(s.texto ?? "")}</p></div>`;
    case "antes-depois": {
      const lados: { k: "antes" | "depois"; texto: string; foto: FotoParaOModelo | null | undefined }[] = [
        { k: "antes", texto: s.antes ?? "", foto: d.foto },
        { k: "depois", texto: s.depois ?? "", foto: d.fotoDepois },
      ];
      const rodape = s.rodape ? `<p class="s-autorizado">${esc(s.rodape)}</p>` : "";
      const comFotos = Boolean(d.foto && d.fotoDepois);
      return (
        topo("Antes e depois") +
        (comFotos
          ? `<div class="s-corpo"><h2 class="s-titulo">${esc(s.titulo)}</h2><div class="s-par">` +
            lados.map((l) => `<figure class="s-lado ${l.k}"><div style="position:relative;min-height:0;display:grid">${bloco("", l.foto, s.foco)}<span class="s-etiqueta">${l.k === "antes" ? "Antes" : "Depois"}</span></div><figcaption>${esc(l.texto)}</figcaption></figure>`).join("") +
            `</div>${rodape}</div>`
          : `<div class="s-corpo"><h2 class="s-titulo">${esc(s.titulo)}</h2><div class="s-pilha">` +
            lados.map((l) => `<div class="s-bloco ${l.k}"><span class="s-qual">${l.k === "antes" ? "Antes" : "Depois"}</span><p>${esc(l.texto)}</p></div>`).join("") +
            `</div>${rodape}</div>`)
      );
    }
    case "dado":
      return (
        topo("Dado") +
        `<div class="s-corpo"><p class="s-valor">${esc(s.valor ?? "")}${s.unidade ? `<small>${esc(s.unidade)}</small>` : ""}</p><p class="s-frase">${esc(s.frase ?? "")}</p>` +
        `<p class="s-fonte"><b>Fonte: ${esc(s.fonte ?? "")}</b><span>${esc(s.referencia ?? "")}</span></p></div>`
      );
    case "prova-fala":
      return (
        topo("Quem usou") +
        `<div class="s-corpo"><span class="s-aspas" aria-hidden="true">&ldquo;</span><blockquote class="s-citacao">${esc(s.citacao ?? "")}</blockquote><p class="s-quem"><b>${esc(s.quem ?? "")}</b><span>${esc(s.contexto ?? "")}</span></p></div>`
      );
    case "prova-resultado":
      return (
        topo("Resultado") +
        `<div class="s-corpo">${bloco("", d.foto, s.foco)}<h2 class="s-titulo">${esc(s.titulo)}</h2><p class="s-autorizado">${esc(s.rodape ?? TEXTO_FIXO_DA_AUTORIZACAO)}</p></div>`
      );
    case "resumo":
      return (
        topo("Resumo") +
        `<div class="s-corpo"><h2 class="s-titulo">${esc(s.titulo)}</h2><ol class="s-lista">` +
        (s.linhas ?? []).map((l) => `<li><span class="s-check">${ICONES.check}</span><span>${esc(l)}</span></li>`).join("") +
        "</ol></div>"
      );
    case "chamada":
      return (
        topo("Agora é com você") +
        `<div class="s-corpo"><h2 class="s-titulo-capa">${esc(s.titulo)}</h2><p class="s-texto">${esc(s.texto ?? "")}</p>${d.arroba ? `<span class="s-arroba-grande">${esc(d.arroba)}</span>` : ""}` +
        `<div class="s-acoes">${(s.acoes ?? []).map((a, i) => `<span class="s-acao"><span>${i === 0 ? ICONES.salvar : ICONES.mandar}</span>${esc(a)}</span>`).join("")}</div></div>`
      );
    case "noticia": {
      const alto = topo("Notícia", `<span class="s-data">${esc(s.data ?? "")}</span>`);
      const dentro = `<h1 class="s-titulo-capa">${esc(s.titulo)}</h1><p class="s-de-onde"><b>Fonte: ${esc(s.veiculo ?? "")}</b>, ${esc(s.data ?? "")}</p>`;
      return fotoTopo ? bloco("topo", d.foto, s.foco) + alto + `<div class="s-corpo">${dentro}</div>` : bloco("fundo", d.foto, s.foco) + alto + `<div class="s-corpo na-base">${dentro}</div>`;
    }
  }
}

/** O progresso: um traço por slide (o de agora mais longo, os que passaram em meio-tom). Sem nada quando o total é 1. */
function progresso(pos: number, total: number): string {
  if (total <= 1) return '<span class="s-progresso"></span>';
  return `<span class="s-progresso" aria-label="Slide ${pos} de ${total}">${Array.from({ length: total }, (_, i) => `<i class="${i + 1 < pos ? "feito" : i + 1 === pos ? "agora" : ""}"></i>`).join("")}</span>`;
}

/** O slide (o `<article>` com tudo): a moldura comum (modo, rótulo no alto, @ e progresso no pé) em volta do miolo do tipo. */
export function slideHTML(d: DadosDoModelo): string {
  const temFoto = Boolean(d.foto);
  const tipo = tipoDesenhado(d.slide, temFoto);
  const modo: ModoDoSlide = tipo === "capa-texto" && d.slide.tipo === "capa-foto" ? "marca" : d.modo;
  const comFotoNoTopo = (tipo === "capa-foto" || tipo === "noticia") && temFoto;
  const fotoTopo = comFotoNoTopo && modo === "claro";
  const classes = ["slide", comFotoNoTopo && !fotoTopo ? "foto-cheia" : "", fotoTopo ? "foto-topo" : "", tipo === "passo" && temFoto ? "com-foto" : ""].filter(Boolean).join(" ");
  const pe = tipo === "chamada" ? `<footer class="s-pe"><span></span>${progresso(d.numero, d.total)}</footer>` : `<footer class="s-pe"><span class="s-arroba">${esc(d.arroba)}</span>${progresso(d.numero, d.total)}</footer>`;
  const sobre = tintaSobre(d.cor);
  return `<article class="${classes}" data-tipo="${tipo}" data-modo="${modo}" data-pos="${d.numero}" data-total="${d.total}" style="--marca:${d.cor};--sobre-marca:${sobre}">${miolo(d, tipo, fotoTopo)}${pe}</article>`;
}

function letras(fontes: DadosDoModelo["fontes"]): string {
  const faixa = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
  const mona = fontes.mona ? `@font-face{font-family:"Mona Sans";src:url(data:font/woff2;base64,${fontes.mona}) format("woff2");font-weight:200 900;font-stretch:75% 125%;font-style:normal;unicode-range:${faixa}}` : "";
  const mono = fontes.mono ? `@font-face{font-family:"JetBrains Mono";src:url(data:font/woff2;base64,${fontes.mono}) format("woff2");font-weight:400 800;font-style:normal;unicode-range:${faixa}}` : "";
  return mona + mono;
}

/** O documento HTML completo de um slide, pronto para o Chromium fotografar. */
export function htmlDoSlide(d: DadosDoModelo): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${letras(d.fontes)}
html,body{margin:0;padding:0;width:${LARGURA_DO_SLIDE}px;height:${ALTURA_DO_SLIDE}px;overflow:hidden;background:#ffffff}
${ESTILO_DOS_SLIDES}</style></head><body>${slideHTML(d)}</body></html>`;
}

/**
 * O script que roda no navegador antes da foto (desenho, regra 4 do README): se o corpo do slide passa da caixa, desce UM passo na letra (a classe `ajustado`, o mínimo da tabela do CSS); se ainda
 * passa, NUNCA corta o texto: marca o slide (`data-estourou`) e devolve que precisa encurtar. Uma folga de 6 px não conta (o corpo da capa com foto mede 2 px a mais no navegador sem que nada passe). A conferência olha a altura do corpo e a largura do valor do dado (que não quebra linha). É texto de script,
 * não função do servidor: roda dentro da página.
 */
export const CONFERIR_TEXTO = `(() => {
  const s = document.querySelector('.slide');
  const passou = () => {
    const corpo = s.querySelector('.s-corpo');
    if (corpo && corpo.scrollHeight > corpo.clientHeight + 6) return true;
    const valor = s.querySelector('.s-valor');
    return Boolean(valor && valor.scrollWidth > valor.clientWidth + 6);
  };
  let ajustou = false;
  if (passou()) { s.classList.add('ajustado'); ajustou = true; }
  const estourou = passou();
  if (estourou) s.setAttribute('data-estourou', '');
  return JSON.stringify({ ajustou, estourou });
})()`;
