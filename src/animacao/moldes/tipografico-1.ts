/**
 * E68 A1: o molde tipográfico provisório (nosso, feito do zero). O texto do roteiro em blocos curtos que entram palavra por palavra e saem juntos, sobre um fundo calmo (cor chapada com um brilho
 * fixo do destaque, que comprime bem), com uma barra fina de andamento embaixo. Tudo depende do tempo: a página não tem relógio próprio, o render chama `irPara(t)` antes de cada foto.
 *
 * O molde definitivo vem do desenho da Central e entra trocando só este arquivo (ou somando outro em `moldes/index.ts`). Regra que não muda: texto do cliente só passa por `escaparTexto`, e
 * o que vai em atributo ou em CSS é número ou cor `#rrggbb` já validados por `montador.ts`.
 */
import { LIMITES_DA_ANIMACAO } from "@/config/animacao";

import { escaparTexto } from "../montador";
import type { EntradaDoMolde, Molde } from "../tipos";

/** O tamanho da letra pelo tamanho do bloco: frase curta grita, frase longa cabe. Em pixels da cena de 1080 de largura. */
export function tamanhoDaLetra(caracteres: number): number {
  if (caracteres <= 40) return 104;
  if (caracteres <= 80) return 86;
  return 70;
}

function html({ linha, marca, largura, altura }: EntradaDoMolde): string {
  const { entradaS, saidaS } = LIMITES_DA_ANIMACAO;
  const cenas = linha.cenas
    .map((c) => {
      const palavras = c.palavras
        .map((p, i) => `<span class="p" data-i="${i}">${escaparTexto(p)}</span>`)
        .join(" ");
      return `<section class="cena" data-ini="${c.inicioS}" data-fim="${c.fimS}" style="font-size:${tamanhoDaLetra(c.texto.length)}px"><p>${palavras}</p></section>`;
    })
    .join("");
  const fonte = marca.fonteBase64
    ? `@font-face{font-family:"Letra";src:url(data:font/woff2;base64,${marca.fonteBase64}) format("woff2");font-weight:100 900}`
    : "";
  // CSP: nenhuma rede, nada além de estilo e script embutidos; é a segunda barreira depois do escape do texto.
  const csp =
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; img-src data:";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>
${fonte}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${largura}px;height:${altura}px;overflow:hidden;background:${marca.corFundo}}
body{position:relative;font-family:"Letra",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:${marca.corTexto};background-image:radial-gradient(ellipse 90% 45% at 50% 108%,${marca.corDestaque}33,transparent 70%)}
.cena{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 110px;visibility:hidden;opacity:0}
.cena p{font-weight:800;line-height:1.14;letter-spacing:-0.02em;text-align:center;text-wrap:balance}
.p{display:inline-block;opacity:0}
.cena::before{content:"";position:absolute;left:50%;top:50%;width:96px;height:8px;margin-left:-48px;margin-top:-${Math.round(altura * 0.2)}px;border-radius:4px;background:${marca.corDestaque}}
#barra{position:absolute;left:0;bottom:0;height:10px;width:0;background:${marca.corDestaque}}
</style></head><body>${cenas}<div id="barra"></div><script>
var TOTAL=${linha.duracaoS},ENTRADA=${entradaS},SAIDA=${saidaS};
var cenas=[].slice.call(document.querySelectorAll(".cena"));
function lim(x){return x<0?0:x>1?1:x}
function suave(x){return 1-Math.pow(1-x,3)}
window.irPara=function(t){
  for(var k=0;k<cenas.length;k++){
    var c=cenas[k],ini=+c.getAttribute("data-ini"),fim=+c.getAttribute("data-fim");
    if(t<ini||t>=fim){c.style.visibility="hidden";continue}
    c.style.visibility="visible";
    var q=lim((t-(fim-SAIDA))/SAIDA);
    c.style.opacity=String(1-q);
    c.style.transform="translateY("+(-q*24)+"px)";
    var ps=c.querySelectorAll(".p");
    for(var i=0;i<ps.length;i++){
      var e=suave(lim((t-ini-i*0.07)/ENTRADA));
      ps[i].style.opacity=String(e);
      ps[i].style.transform="translateY("+((1-e)*34)+"px)";
    }
  }
  document.getElementById("barra").style.width=(lim(t/TOTAL)*100)+"%";
};
window.irPara(0);
</script></body></html>`;
}

export const moldeTipografico1: Molde = { nome: "tipografico-1", html };
