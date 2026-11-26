/**
 * E68: o molde definitivo do vídeo de animação (26/11/2026). Texto do roteiro em cenas, alinhado à esquerda, sobre a cor da marca afundada no quase preto (cor chapada: comprime bem e não faz
 * faixa no H.264), com uma palavra por cena no destaque e a chamada final segurada com o @ da marca. O provisório (`tipografico-1`) continua para os pedidos feitos antes.
 *
 * As medidas, em pixels da cena de 1080 por 1920:
 * - Área segura do Reels: nada no alto até 220 (o título "Reels" e a câmera), nada nos últimos 380 (a legenda, o nome e a música), nada nos 140 da direita (curtir, comentar, compartilhar). À
 *   esquerda, 96 de margem (a mesma do carrossel). O andamento fica na linha de 220; o texto, na faixa de 300 a 1540, numa coluna de 844.
 * - Letra: a do projeto (Mona Sans, embutida), 800 no texto e 700 no @, numa escala de razão 1,25: 120, 96, 76 e 60, escolhida pelo tamanho da cena e pela palavra mais longa, que tem de caber
 *   inteira na coluna. Entrelinha 1,08, espaço entre letras -0,025 em. Se ainda assim passar da coluna (uma letra mais larga que a conta), a página diminui 8% por vez até caber.
 * - Cor: uma só, a da marca (`cores.ts`): o fundo é a marca afundada no quase preto, o texto quase branco com 7 para 1, e o destaque é a própria cor da marca (clareada sem perder a força, se
 *   precisar) com 4,5 para 1, conferidos por código. O destaque é o único acento: a palavra da cena e a pílula do @.
 * - Tempo: a primeira cena já está inteira no primeiro quadro (o gancho se lê na hora e o quadro serve de capa); nas outras, as palavras sobem e aparecem uma depois da outra (0,45 s cada, com no
 *   máximo 0,9 s de escada), a palavra de destaque acende do branco para a cor 0,2 s depois de aparecer, e a cena sai inteira em 0,3 s subindo um pouco. O fundo nunca muda: nada pisca entre as
 *   cenas. A última não sai: fica até o fim, 2 s a mais que o tempo de leitura (`seguraDoFinalS`), e o @ aparece embaixo dela quando o texto termina de entrar.
 *
 * Tudo depende do tempo: a página não tem relógio próprio, o render chama `irPara(t)` antes de cada foto. Regra que não muda: texto do cliente só passa por `escaparTexto`; em atributo ou CSS vai só
 * número ou cor `#rrggbb` (validada por `montador.ts` e saída das contas de `cores.ts`). Sem rede: a letra é `data:`, e a política de conteúdo fecha o resto.
 */
import { canais, coresDaAnimacao } from "../cores";
import { palavraEmDestaque, separarPontuacao } from "../destaque";
import { escaparTexto } from "../montador";
import type { EntradaDoMolde, Molde } from "../tipos";

/** A área segura do Reels, em pixels da cena de 1080 por 1920 (o que fica fora dela pode ser coberto pela interface do Instagram). */
export const AREA_SEGURA = { topo: 220, base: 380, direita: 140, esquerda: 96 } as const;

/** O andamento (um traço por cena) fica na linha de cima da área segura; o texto começa 72 abaixo dele. */
export const ALTURA_DO_ANDAMENTO = 8;
export const TOPO_DO_TEXTO = AREA_SEGURA.topo + ALTURA_DO_ANDAMENTO + 72;
export const LARGURA_DA_COLUNA = 1080 - AREA_SEGURA.esquerda - AREA_SEGURA.direita;

/** A escala da letra do texto, razão 1,25 a partir de 120 (arredondada a 4). */
export const ESCALA_DA_LETRA = [120, 96, 76, 60] as const;
/** A menor letra que a conta aceita para uma palavra comprida demais (a página ainda pode reduzir, se a letra real for mais larga). */
export const MENOR_LETRA = 44;
/** Largura de uma letra da Mona Sans 800 em "em", com folga: a média medida no Chromium em 26/11/2026 é 0,49 nas palavras do português; 0,62 cobre as palavras cheias de "m" e "w". */
const LARGURA_MEDIA_DA_LETRA = 0.62;

/** O tamanho da letra de uma cena: pelo número de caracteres e, depois, descendo a escala até a palavra mais longa caber inteira na coluna. */
export function tamanhoDaLetra(palavras: readonly string[]): number {
  const caracteres = palavras.join(" ").length;
  const maior = Math.max(1, ...palavras.map((p) => [...p].length));
  let i = caracteres <= 28 ? 0 : caracteres <= 56 ? 1 : caracteres <= 96 ? 2 : 3;
  while (i < ESCALA_DA_LETRA.length && maior * LARGURA_MEDIA_DA_LETRA * ESCALA_DA_LETRA[i] > LARGURA_DA_COLUNA) i += 1;
  if (i < ESCALA_DA_LETRA.length) return ESCALA_DA_LETRA[i];
  return Math.max(MENOR_LETRA, Math.floor(LARGURA_DA_COLUNA / (maior * LARGURA_MEDIA_DA_LETRA)));
}

/** A letra do @ na pílula: 48, ou menos para um @ comprido caber na coluna com os 36 de folga de cada lado. */
export function tamanhoDoArroba(arroba: string): number {
  return Math.min(48, Math.floor((LARGURA_DA_COLUNA - 72) / (arroba.length * LARGURA_MEDIA_DA_LETRA)));
}

/** Os tempos da animação, em segundos. */
export const TEMPOS = {
  /** Quanto cada palavra leva para entrar. */
  entradaDaPalavra: 0.45,
  /** O passo entre uma palavra e a seguinte, e o máximo da escada inteira (cena longa entra mais rápido). */
  passoMaximo: 0.06,
  escadaMaxima: 0.9,
  /** Quanto a palavra de destaque espera depois de começar a entrar e quanto leva para acender. */
  esperaDoDestaque: 0.2,
  acendeDestaque: 0.35,
  /** A saída de cada cena (menos a última). */
  saida: 0.3,
  /** A troca do traço do andamento. */
  andamento: 0.35,
  /** Quanto a última cena fica a mais depois do tempo de leitura. */
  seguraDoFinal: 2,
} as const;

export function passoEntrePalavras(quantas: number): number {
  return quantas > 1 ? Math.min(TEMPOS.passoMaximo, TEMPOS.escadaMaxima / (quantas - 1)) : 0;
}

/** A palavra de destaque: só o miolo acende (`.d`); a pontuação colada fica na cor do texto. Cada parte passa por `escaparTexto`. */
function palavraDestacada(palavra: string): string {
  const [antes, miolo, depois] = separarPontuacao(palavra);
  if (!miolo) return escaparTexto(palavra);
  return `${escaparTexto(antes)}<span class="d">${escaparTexto(miolo)}</span>${escaparTexto(depois)}`;
}

function html({ linha, marca, largura, altura }: EntradaDoMolde): string {
  const cores = coresDaAnimacao(marca.corDestaque);
  const ultima = linha.cenas.length - 1;
  const cenas = linha.cenas
    .map((c, k) => {
      const faixa = palavraEmDestaque(c.palavras);
      const palavras = c.palavras.map((p, i) => `<span class="p">${faixa && i >= faixa[0] && i <= faixa[1] ? palavraDestacada(p) : escaparTexto(p)}</span>`).join(" ");
      const tamanho = tamanhoDaLetra(c.palavras);
      const arroba =
        k === ultima && marca.arroba
          ? `<p class="arroba"><span style="font-size:${tamanhoDoArroba(marca.arroba)}px">${escaparTexto(marca.arroba)}</span></p>`
          : "";
      return `<section class="cena" data-ini="${c.inicioS}" data-fim="${c.fimS}"${k === ultima ? ' data-final="1"' : ""}><div class="bloco"><p class="frase" style="font-size:${tamanho}px">${palavras}</p>${arroba}</div></section>`;
    })
    .join("");
  const tracos = linha.cenas.length > 1 ? `<div id="andamento">${"<i></i>".repeat(linha.cenas.length)}</div>` : "";
  const temFonte = Boolean(marca.fonteBase64);
  const fonte = temFonte
    ? `@font-face{font-family:"Letra";src:url(data:font/woff2;base64,${marca.fonteBase64}) format("woff2");font-weight:100 900}`
    : "";
  // CSP: nenhuma rede, nada além de estilo e script embutidos; é a segunda barreira depois do escape do texto.
  const csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; img-src data:";
  const A = AREA_SEGURA;
  const T = TEMPOS;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>
${fonte}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${largura}px;height:${altura}px;overflow:hidden;background:${cores.fundo}}
body{position:relative;font-family:"Letra",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:${cores.texto};-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
#andamento{position:absolute;left:${A.esquerda}px;top:${A.topo}px;display:flex;gap:8px;height:${ALTURA_DO_ANDAMENTO}px}
#andamento i{display:block;width:24px;height:${ALTURA_DO_ANDAMENTO}px;border-radius:${ALTURA_DO_ANDAMENTO / 2}px;background:${cores.texto};opacity:.18}
.cena{position:absolute;left:${A.esquerda}px;right:${A.direita}px;top:${TOPO_DO_TEXTO}px;bottom:${A.base}px;display:flex;align-items:center;visibility:hidden}
.bloco{width:100%}
.frase{font-weight:800;line-height:1.08;letter-spacing:-0.025em;text-wrap:pretty}
.p{display:inline-block}
.arroba{margin-top:64px;opacity:0}
.arroba span{display:inline-flex;align-items:center;height:88px;padding:0 36px;border-radius:44px;background:${cores.destaque};color:${cores.sobreDestaque};font-weight:700;letter-spacing:-0.01em;line-height:1;white-space:nowrap}
</style></head><body>${tracos}${cenas}<script>
var ENTRA=${T.entradaDaPalavra},PASSO=${T.passoMaximo},ESCADA=${T.escadaMaxima},ESPERA=${T.esperaDoDestaque},ACENDE=${T.acendeDestaque},SAIDA=${T.saida},TROCA=${T.andamento};
var CT=[${canais(cores.texto).join(",")}],CD=[${canais(cores.destaque).join(",")}],TEM_FONTE=${temFonte ? "true" : "false"},FONTE='800 100px "Letra"';
var cenas=[].slice.call(document.querySelectorAll(".cena"));
var tracos=[].slice.call(document.querySelectorAll("#andamento i"));
if(TEM_FONTE){try{document.fonts.load(FONTE)}catch(e){}}
function lim(x){return x<0?0:x>1?1:x}
function suave(x){return 1-Math.pow(1-x,3)}
function mistura(a,b,p){return "rgb("+Math.round(a[0]+(b[0]-a[0])*p)+","+Math.round(a[1]+(b[1]-a[1])*p)+","+Math.round(a[2]+(b[2]-a[2])*p)+")"}
function ajustar(c){
  var f=c.querySelector(".frase"),b=c.querySelector(".bloco"),ar=c.querySelector(".arroba span");
  for(var i=0;i<14;i++){
    if(f.scrollWidth<=f.clientWidth+1&&b.scrollHeight<=c.clientHeight+1)break;
    f.style.fontSize=Math.floor(parseFloat(f.style.fontSize)*0.92)+"px";
  }
  for(var j=0;ar&&j<14&&ar.offsetWidth>b.clientWidth+1;j++)ar.style.fontSize=Math.floor(parseFloat(ar.style.fontSize)*0.92)+"px";
  c.setAttribute("data-ajustada","1");
}
window.irPara=function(t){
  var pronta=!TEM_FONTE||document.fonts.check(FONTE),atual=-1,iniAtual=0;
  for(var k=0;k<cenas.length;k++){
    var c=cenas[k],ini=+c.getAttribute("data-ini"),fim=+c.getAttribute("data-fim"),final=c.hasAttribute("data-final");
    if(t<ini||t>=fim){c.style.visibility="hidden";continue}
    atual=k;iniAtual=ini;
    c.style.visibility="visible";
    if(pronta&&!c.hasAttribute("data-ajustada"))ajustar(c);
    var instantanea=k===0,local=t-ini;
    var q=final?0:lim((t-(fim-SAIDA))/SAIDA);
    var b=c.querySelector(".bloco");
    b.style.opacity=String(1-q);
    b.style.transform="translateY("+(-q*32)+"px)";
    var tam=parseFloat(c.querySelector(".frase").style.fontSize);
    var ps=c.querySelectorAll(".p"),n=ps.length,passo=n>1?Math.min(PASSO,ESCADA/(n-1)):0;
    for(var i=0;i<n;i++){
      var e=instantanea?1:suave(lim((local-i*passo)/ENTRA));
      ps[i].style.opacity=String(e);
      ps[i].style.transform="translateY("+((1-e)*0.32*tam)+"px)";
      var d=ps[i].querySelector(".d");
      if(d){
        var h=instantanea?1:suave(lim((local-i*passo-ESPERA)/ACENDE));
        d.style.color=mistura(CT,CD,h);
      }
    }
    var ar=c.querySelector(".arroba");
    if(ar){
      var e2=instantanea?1:suave(lim((local-((n-1)*passo+ENTRA+0.25))/ENTRA));
      ar.style.opacity=String(e2);
      ar.style.transform="translateY("+((1-e2)*24)+"px)";
    }
  }
  if(tracos.length&&atual>=0){
    var m=atual===0?1:suave(lim((t-iniAtual)/TROCA));
    for(var j=0;j<tracos.length;j++){
      var w=24,o=0.18;
      if(j<atual-1){o=0.45}
      else if(j===atual-1){w=56-32*m;o=1-0.55*m}
      else if(j===atual){w=24+32*m;o=0.18+0.82*m}
      tracos[j].style.width=w+"px";
      tracos[j].style.opacity=String(o);
    }
  }
};
window.irPara(0);
</script></body></html>`;
}

export const moldeTipografico2: Molde = { nome: "tipografico-2", html, seguraDoFinalS: TEMPOS.seguraDoFinal };
