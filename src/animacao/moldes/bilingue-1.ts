/**
 * E68: o molde bilíngue do vídeo de animação (27/11/2026, nascido do uso real numa marca que posta em dois idiomas). Cada cena tem a frase no idioma principal, grande, e a mesma frase no segundo
 * idioma (`traducao`), menor e mais apagada, com um selo opcional da sigla ("PT"). No alto de toda cena fica o símbolo da marca sobre um filete; no fim, um fecho só com a logo completa e o site.
 *
 * Diferente do `tipografico-2`, este molde usa as cores da marca como ela as definiu (`corFundo` e `corTexto`, sem contas a partir de uma cor só) e não acende palavra: a hierarquia vem só do
 * tamanho e do valor (claro contra escuro). Serve à marca que já tem identidade fechada; se o par de cores não passa de 7 para 1, cai no par do produto.
 *
 * As medidas, em pixels da cena de 1080 por 1920:
 * - Área segura que serve ao Story e ao Reels: nada no alto até 250 (a barra do Story e o nome), nada nos últimos 380 (o campo de resposta do Story, a legenda do Reels), nada nos 140 da direita
 *   (os botões do Reels). À esquerda, 96. O símbolo fica na linha de 250, com 48 de altura; o filete, 40 abaixo dele; o texto, na faixa que sobra, centrado na altura e alinhado à esquerda.
 * - Letra: a principal da marca, 700 na frase (escala de razão 1,25: 120, 96, 76 e 60, pelo tamanho da frase e pela palavra mais longa) e 400 na tradução (48, ou 40 quando a frase é pequena);
 *   a segunda letra, se houver, no selo e no site. Entrelinha 1,04 na frase e 1,3 na tradução.
 * - Seta: "→" ou "->" sozinhos viram uma seta desenhada na cor do texto, porque muita letra de marca não traz o desenho da seta e o navegador trocaria por outra letra.
 * - Tempo: a primeira cena já está inteira no primeiro quadro (serve de capa); nas outras, as palavras sobem uma depois da outra e a tradução entra inteira logo depois. A cena sai em 0,3 s. O
 *   fundo nunca muda. O fecho dura `FECHO_S` (o montador estica a última cena com `seguraDoFinalS`): a última frase sai, o símbolo do alto some e a logo entra, com o site embaixo.
 *
 * Regra que não muda: texto do cliente só passa por `escaparTexto`; em atributo ou CSS vai só número, cor `#rrggbb` ou base64 já validados por `montador.ts`. Sem rede: letras e imagens são `data:`.
 */
import { contraste, misturarOklab } from "@/carrossel/modelos";

import { escaparTexto, MARCA_PADRAO } from "../montador";
import type { EntradaDoMolde, MarcaResolvida, Molde } from "../tipos";

/** A área segura que serve ao Story e ao Reels, em pixels da cena de 1080 por 1920. */
export const AREA_SEGURA = { topo: 250, base: 380, direita: 140, esquerda: 96 } as const;
export const ALTURA_DO_SIMBOLO = 48;
export const ESPESSURA_DO_FILETE = 2;
/** O filete fica 40 abaixo do símbolo; o texto começa 72 abaixo do filete. */
export const TOPO_DO_FILETE = AREA_SEGURA.topo + ALTURA_DO_SIMBOLO + 40;
export const TOPO_DO_TEXTO = TOPO_DO_FILETE + ESPESSURA_DO_FILETE + 72;
export const LARGURA_DA_COLUNA = 1080 - AREA_SEGURA.esquerda - AREA_SEGURA.direita;

export const ESCALA_DA_FRASE = [120, 96, 76, 60] as const;
export const MENOR_LETRA = 44;
/** Largura de uma letra em "em", com folga: maiúscula é mais larga que minúscula na maior parte das letras de marca. */
const LARGURA_DA_MAIUSCULA = 0.74;
const LARGURA_DA_MINUSCULA = 0.56;

/** O fecho: quanto tempo a logo fica na tela no fim, e a largura dela (três quartos da coluna). */
export const FECHO_S = 3;
export const LARGURA_DA_LOGO = 640;

export const TEMPOS = {
  entradaDaPalavra: 0.45,
  passoMaximo: 0.06,
  escadaMaxima: 0.6,
  /** A tradução entra inteira, este tanto depois de a última palavra começar a entrar. */
  esperaDaTraducao: 0.3,
  entradaDaTraducao: 0.5,
  saida: 0.3,
  entradaDaLogo: 0.6,
  esperaDoSite: 0.25,
} as const;

const SETAS = new Set(["→", "->"]);

/** A largura estimada de uma palavra em "em". */
function larguraDaPalavra(palavra: string): number {
  let soma = 0;
  for (const letra of palavra) soma += letra !== letra.toLowerCase() ? LARGURA_DA_MAIUSCULA : LARGURA_DA_MINUSCULA;
  return soma;
}

/** O tamanho da frase: pelo número de caracteres e, depois, descendo a escala até a palavra mais larga caber inteira na coluna. */
export function tamanhoDaFrase(palavras: readonly string[]): number {
  const caracteres = palavras.join(" ").length;
  const maior = Math.max(0.5, ...palavras.map(larguraDaPalavra));
  let i = caracteres <= 24 ? 0 : caracteres <= 48 ? 1 : caracteres <= 90 ? 2 : 3;
  while (i < ESCALA_DA_FRASE.length && maior * ESCALA_DA_FRASE[i] > LARGURA_DA_COLUNA) i += 1;
  if (i < ESCALA_DA_FRASE.length) return ESCALA_DA_FRASE[i];
  return Math.max(MENOR_LETRA, Math.floor(LARGURA_DA_COLUNA / maior));
}

/** A tradução fica dois degraus abaixo da frase grande, nunca menor que 40. */
export function tamanhoDaTraducao(tamanhoDaFrase: number): number {
  return tamanhoDaFrase >= 96 ? 48 : 40;
}

export type CoresDoBilingue = { fundo: string; texto: string; secundario: string; filete: string };

/** As cores do molde: as da marca, se o texto passa de 7 para 1 sobre o fundo; senão, o par do produto. A tradução fica entre as duas, com pelo menos 4,5 para 1. */
export function coresDoBilingue(marca: MarcaResolvida): CoresDoBilingue {
  const bom = contraste(marca.corTexto, marca.corFundo) >= 7;
  const fundo = bom ? marca.corFundo : MARCA_PADRAO.corFundo;
  const texto = bom ? marca.corTexto : MARCA_PADRAO.corTexto;
  let parte = 66;
  let secundario = misturarOklab(texto, parte, fundo);
  while (contraste(secundario, fundo) < 4.5 && parte < 100) {
    parte += 4;
    secundario = misturarOklab(texto, Math.min(100, parte), fundo);
  }
  return { fundo, texto, secundario, filete: misturarOklab(texto, 22, fundo) };
}

/** A seta desenhada, na cor do texto, do tamanho da letra em volta. */
const SETA = `<svg class="seta" viewBox="0 0 100 60" aria-hidden="true"><path d="M4 30H88M64 8l24 22-24 22" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;

function palavraOuSeta(palavra: string): string {
  return SETAS.has(palavra) ? SETA : escaparTexto(palavra);
}

/** As palavras em grupos que não se separam na quebra de linha: a seta vai junto da palavra seguinte, para apontar para ela ("China" e, embaixo, "→ USA"), nunca para o vazio no fim da linha. */
export function gruposDePalavras(palavras: readonly string[]): string[][] {
  const grupos: string[][] = [];
  for (let i = 0; i < palavras.length; i += 1) {
    if (SETAS.has(palavras[i]) && i + 1 < palavras.length) {
      grupos.push([palavras[i], palavras[i + 1]]);
      i += 1;
    } else grupos.push([palavras[i]]);
  }
  return grupos;
}

function html({ linha, marca, largura, altura }: EntradaDoMolde): string {
  const cores = coresDoBilingue(marca);
  const A = AREA_SEGURA;
  const T = TEMPOS;
  const ultima = linha.cenas.length - 1;
  const temFecho = Boolean(marca.logoPngBase64 || marca.site);
  // O fecho começa quando acaba o tempo da última frase: o que o montador somou com `seguraDoFinalS` é dele (nunca antes de a frase ter 1,2 s de tela).
  const ultimaCena = linha.cenas[ultima];
  const inicioDoFecho = temFecho ? Math.max(ultimaCena.inicioS + 1.2, ultimaCena.fimS - FECHO_S) : linha.duracaoS + 1;

  const cenas = linha.cenas
    .map((c) => {
      const palavras = gruposDePalavras(c.palavras)
        .map((g) => `<span class="p">${g.map(palavraOuSeta).join(" ")}</span>`)
        .join(" ");
      const tamanho = tamanhoDaFrase(c.palavras);
      const selo = marca.rotuloDaTraducao ? `<span class="selo">${escaparTexto(marca.rotuloDaTraducao)}</span>` : "";
      const traducao = c.traducao
        ? `<p class="traducao" style="font-size:${tamanhoDaTraducao(tamanho)}px">${selo}<span class="t">${gruposDePalavras(c.traducao.split(" "))
            .map((g) => (g.length > 1 ? `<span class="junto">${g.map(palavraOuSeta).join(" ")}</span>` : palavraOuSeta(g[0])))
            .join(" ")}</span></p>`
        : "";
      return `<section class="cena" data-ini="${c.inicioS}" data-fim="${c.fimS}"><div class="bloco"><p class="frase" style="font-size:${tamanho}px">${palavras}</p>${traducao}</div></section>`;
    })
    .join("");

  const simbolo = marca.simboloPngBase64 ? `<img id="simbolo" alt="" src="data:image/png;base64,${marca.simboloPngBase64}">` : "";
  const fecho = temFecho
    ? `<section id="fecho">${marca.logoPngBase64 ? `<img class="logo" alt="" src="data:image/png;base64,${marca.logoPngBase64}">` : ""}${marca.site ? `<p class="site">${escaparTexto(marca.site)}</p>` : ""}</section>`
    : "";

  const faces = [
    marca.fonteBase64 ? `@font-face{font-family:"Letra";src:url(data:font/woff2;base64,${marca.fonteBase64}) format("woff2");font-weight:100 900}` : "",
    marca.fonteRotuloBase64 ? `@font-face{font-family:"Rotulo";src:url(data:font/woff2;base64,${marca.fonteRotuloBase64}) format("woff2");font-weight:100 900}` : "",
  ].join("");
  const temFonte = Boolean(marca.fonteBase64);
  // CSP: nenhuma rede, nada além de estilo e script embutidos; é a segunda barreira depois do escape do texto.
  const csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; img-src data:";

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>
${faces}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${largura}px;height:${altura}px;overflow:hidden;background:${cores.fundo}}
body{position:relative;font-family:"Letra",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:${cores.texto};-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
#topo{position:absolute;left:${A.esquerda}px;right:${A.esquerda}px;top:${A.topo}px;height:${TOPO_DO_FILETE - A.topo + ESPESSURA_DO_FILETE}px}
#simbolo{display:block;height:${ALTURA_DO_SIMBOLO}px;width:auto}
#topo::after{content:"";position:absolute;left:0;right:0;top:${TOPO_DO_FILETE - A.topo}px;height:${ESPESSURA_DO_FILETE}px;background:${cores.filete}}
.cena,#fecho{position:absolute;left:${A.esquerda}px;right:${A.direita}px;top:${TOPO_DO_TEXTO}px;bottom:${A.base}px;display:flex;align-items:center;visibility:hidden}
#fecho{flex-direction:column;justify-content:center;align-items:flex-start}
.bloco{width:100%}
.frase{font-weight:700;line-height:1.04;letter-spacing:-0.03em;text-wrap:balance}
.p{display:inline-block}
.seta{display:inline-block;width:0.92em;height:0.56em;vertical-align:0.06em}
.traducao{display:flex;align-items:baseline;gap:24px;margin-top:48px;font-weight:400;line-height:1.3;color:${cores.secundario};text-wrap:pretty}
.traducao .seta{width:0.86em;height:0.52em;vertical-align:0.02em}
.junto{white-space:nowrap}
.selo{flex:none;position:relative;top:-0.12em;font-family:"Rotulo","Letra",sans-serif;font-weight:600;font-size:0.58em;line-height:1;letter-spacing:0.12em;padding:0.28em 0.42em 0.18em 0.54em;border:2px solid currentColor}
.logo{display:block;width:${LARGURA_DA_LOGO}px;max-width:100%;height:auto}
.site{margin-top:56px;font-family:"Rotulo","Letra",sans-serif;font-weight:600;font-size:48px;line-height:1;letter-spacing:0.06em;color:${cores.texto}}
</style></head><body><div id="topo">${simbolo}</div>${cenas}${fecho}<script>
var ENTRA=${T.entradaDaPalavra},PASSO=${T.passoMaximo},ESCADA=${T.escadaMaxima},ESPERA_T=${T.esperaDaTraducao},ENTRA_T=${T.entradaDaTraducao},SAIDA=${T.saida};
var FECHO=${inicioDoFecho},ENTRA_L=${T.entradaDaLogo},ESPERA_S=${T.esperaDoSite},TEM_FONTE=${temFonte ? "true" : "false"},FONTE='700 100px "Letra"';
var cenas=[].slice.call(document.querySelectorAll(".cena"));
var topo=document.getElementById("topo"),fecho=document.getElementById("fecho");
if(TEM_FONTE){try{document.fonts.load(FONTE)}catch(e){}}
function lim(x){return x<0?0:x>1?1:x}
function suave(x){return 1-Math.pow(1-x,3)}
function ajustar(c){
  var f=c.querySelector(".frase"),b=c.querySelector(".bloco");
  for(var i=0;i<14;i++){
    if(f.scrollWidth<=f.clientWidth+1&&b.scrollHeight<=c.clientHeight+1)break;
    f.style.fontSize=Math.floor(parseFloat(f.style.fontSize)*0.92)+"px";
  }
  c.setAttribute("data-ajustada","1");
}
window.irPara=function(t){
  var pronta=!TEM_FONTE||document.fonts.check(FONTE);
  for(var k=0;k<cenas.length;k++){
    var c=cenas[k],ini=+c.getAttribute("data-ini"),fim=Math.min(+c.getAttribute("data-fim"),k===cenas.length-1?FECHO:1e9);
    if(t<ini||t>=fim){c.style.visibility="hidden";continue}
    c.style.visibility="visible";
    if(pronta&&!c.hasAttribute("data-ajustada"))ajustar(c);
    var primeira=k===0,local=t-ini;
    var q=lim((t-(fim-SAIDA))/SAIDA);
    var b=c.querySelector(".bloco");
    b.style.opacity=String(1-q);
    b.style.transform="translateY("+(-q*32)+"px)";
    var tam=parseFloat(c.querySelector(".frase").style.fontSize);
    var ps=c.querySelectorAll(".p"),n=ps.length,passo=n>1?Math.min(PASSO,ESCADA/(n-1)):0;
    for(var i=0;i<n;i++){
      var e=primeira?1:suave(lim((local-i*passo)/ENTRA));
      ps[i].style.opacity=String(e);
      ps[i].style.transform="translateY("+((1-e)*0.32*tam)+"px)";
    }
    var tr=c.querySelector(".traducao");
    if(tr){
      var e2=primeira?1:suave(lim((local-((n-1)*passo+ESPERA_T))/ENTRA_T));
      tr.style.opacity=String(e2);
      tr.style.transform="translateY("+((1-e2)*20)+"px)";
    }
  }
  if(fecho){
    var dentro=t>=FECHO;
    fecho.style.visibility=dentro?"visible":"hidden";
    topo.style.opacity=String(1-lim((t-FECHO+SAIDA)/SAIDA));
    if(dentro){
      var lg=fecho.querySelector(".logo"),st=fecho.querySelector(".site");
      var el=suave(lim((t-FECHO-0.1)/ENTRA_L));
      if(lg){lg.style.opacity=String(el);lg.style.transform="translateY("+((1-el)*24)+"px)"}
      if(st){var es=suave(lim((t-FECHO-0.1-ESPERA_S)/ENTRA_L));st.style.opacity=String(es);st.style.transform="translateY("+((1-es)*16)+"px)"}
    }
  }
};
window.irPara(0);
</script></body></html>`;
}

export const moldeBilingue1: Molde = { nome: "bilingue-1", html, seguraDoFinalS: FECHO_S };
