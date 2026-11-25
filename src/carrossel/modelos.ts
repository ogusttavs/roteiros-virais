/**
 * E65 PR 1: o modelo visual PROVISÓRIO do carrossel: um modelo por tipo de slide, em HTML e CSS, que vira PNG no Chromium (`render.ts`). O desenho final do designer entra no PR 2 trocando só este
 * arquivo (e a fonte, se mudar): o texto, as fotos e a cor entram por `DadosDoModelo`, e nada fora daqui conhece HTML de slide. Cor de destaque vem da marca; claro e escuro se alternam
 * de um slide para o outro. Toda caixa de texto leva `data-caixa`, que o render mede no navegador antes de fotografar (`ajustarCaixas`).
 */
import { ALTURA_DO_SLIDE, LARGURA_DO_SLIDE, type SlideDoCarrossel, type TipoDeSlide } from "@/config/carrossel";
import { escaparHtml } from "@/lib/chromium-de-impressao";

export type FotoParaOModelo = { tipo: string; base64: string };

export type DadosDoModelo = {
  slide: SlideDoCarrossel;
  /** A posição do slide (1 a N) e o total. */
  numero: number;
  total: number;
  cor: string;
  foto?: FotoParaOModelo | null;
  fotoDepois?: FotoParaOModelo | null;
  /** A fonte da letra, em base64 (woff2), ou nula: sem ela, a letra do sistema. */
  fonteBase64: string | null;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export function corValida(cor: string): boolean {
  return HEX.test(cor);
}

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function misturar(hex: string, com: string, parte: number): string {
  const a = rgb(hex);
  const b = rgb(com);
  const c = a.map((v, i) => Math.round(v * (1 - parte) + b[i] * parte));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Luminância relativa (0 a 1), para escolher o texto que lê bem em cima da cor. */
function luminancia(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** A razão de contraste entre duas cores (4,5 é o mínimo de leitura de texto comum; o teste confere os pares do modelo). */
export function contraste(a: string, b: string): number {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export type Paleta = { fundo: string; texto: string; suave: string; destaque: string; sobreDestaque: string };

/** Claro e escuro a partir da cor da marca. O destaque é a própria cor, escurecida no fundo claro e clareada no escuro, até ler bem. */
export function paletaDoSlide(cor: string, escuro: boolean): Paleta {
  const fundo = escuro ? misturar(cor, "#0b0b0d", 0.86) : misturar(cor, "#ffffff", 0.93);
  const texto = escuro ? "#f7f5f2" : "#17151a";
  let destaque = cor;
  for (let i = 0; i < 12 && contraste(destaque, fundo) < 4.5; i += 1) destaque = misturar(destaque, escuro ? "#ffffff" : "#000000", 0.15);
  return { fundo, texto, suave: escuro ? "#c9c5c0" : "#4a4650", destaque, sobreDestaque: contraste("#17151a", destaque) >= contraste("#ffffff", destaque) ? "#17151a" : "#ffffff" };
}

const ROTULO_DO_TIPO: Partial<Record<TipoDeSlide, string>> = { passo: "Passo", item: "Dica", dado: "Dado", prova: "Na prática", resumo: "Para guardar" };

function imagem(foto: FotoParaOModelo | null | undefined, classe: string): string {
  return foto ? `<div class="foto ${classe}" style="background-image:url('data:${foto.tipo};base64,${foto.base64}')"></div>` : "";
}

function corpoDoSlide(d: DadosDoModelo): string {
  const { slide } = d;
  const t = escaparHtml(slide.titulo);
  const c = escaparHtml(slide.corpo);
  const n = `${String(d.numero).padStart(2, "0")}/${String(d.total).padStart(2, "0")}`;
  const rotulo = ROTULO_DO_TIPO[slide.tipo];
  switch (slide.tipo) {
    case "capa":
      return `${imagem(d.foto, "cheia")}<div class="velo ${d.foto ? "" : "sem"}"></div>
        <div class="miolo capa"><div class="faixa"></div><h1 data-caixa data-base="96">${t}</h1>${c ? `<p data-caixa data-base="44">${c}</p>` : ""}<span class="desliza">deslize</span></div>`;
    case "antes_depois": {
      const [antes, depois] = c.includes("Depois:") ? c.split("Depois:") : [c, ""];
      return `<div class="miolo"><span class="selo">${n}</span><h2 data-caixa data-base="64">${t}</h2>
        <div class="par">${d.foto ? imagem(d.foto, "metade") : ""}${d.fotoDepois ? imagem(d.fotoDepois, "metade") : ""}</div>
        <div class="lados"><p data-caixa data-base="38" data-max="260"><b>Antes</b> ${antes.replace(/^Antes:\s*/, "")}</p>${depois ? `<p data-caixa data-base="38" data-max="260"><b>Depois</b> ${depois.trim()}</p>` : ""}</div></div>`;
    }
    case "dado":
      return `<div class="miolo centro"><span class="selo">${n}</span><span class="rotulo">${rotulo}</span><h2 class="grande" data-caixa data-base="104">${t}</h2><p data-caixa data-base="46">${c}</p>${slide.fonte ? `<small class="fonte">Fonte: ${escaparHtml(slide.fonte)}</small>` : ""}</div>`;
    case "chamada":
      return `<div class="miolo centro"><span class="selo">${n}</span><div class="bloco-cor"><h2 data-caixa data-base="88">${t}</h2>${c ? `<p data-caixa data-base="44">${c}</p>` : ""}</div></div>`;
    default:
      return `<div class="miolo"><span class="selo">${n}</span>${rotulo ? `<span class="rotulo">${rotulo}${slide.tipo === "passo" ? ` ${d.numero - 1}` : ""}</span>` : ""}<h2 data-caixa data-base="72">${t}</h2>${imagem(d.foto, "faixa-foto")}<p data-caixa data-base="42">${c}</p></div>`;
  }
}

/** O documento HTML completo de um slide, com as caixas marcadas para o render medir. */
export function htmlDoSlide(d: DadosDoModelo): string {
  const escuro = d.slide.tipo === "capa" || d.slide.tipo === "chamada" ? true : d.numero % 2 === 0;
  const p = paletaDoSlide(d.cor, escuro);
  const fonte = d.fonteBase64 ? `@font-face{font-family:"Letra";src:url(data:font/woff2;base64,${d.fonteBase64}) format("woff2");font-weight:100 900;}` : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
${fonte}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${LARGURA_DO_SLIDE}px;height:${ALTURA_DO_SLIDE}px;overflow:hidden}
body{background:${p.fundo};color:${p.texto};font-family:"Letra",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;position:relative}
.miolo{position:absolute;inset:0;padding:96px 88px;display:flex;flex-direction:column;gap:36px;justify-content:center}
.miolo.centro{justify-content:center}
h1,h2{font-weight:800;line-height:1.08;letter-spacing:-0.02em;overflow-wrap:break-word}
p{line-height:1.3;color:${p.suave};overflow-wrap:break-word}
.selo{position:absolute;top:64px;right:88px;font-size:28px;color:${p.suave};font-variant-numeric:tabular-nums}
.rotulo{display:inline-block;align-self:flex-start;background:${p.destaque};color:${p.sobreDestaque};font-weight:700;font-size:30px;padding:10px 26px;border-radius:999px}
.fonte{font-size:28px;color:${p.suave}}
.grande{color:${p.destaque}}
.bloco-cor{background:${p.destaque};color:${p.sobreDestaque};border-radius:48px;padding:72px 64px;display:flex;flex-direction:column;gap:28px}
.bloco-cor p{color:${p.sobreDestaque}}
.foto{background-size:cover;background-position:center;border-radius:36px}
.foto.cheia{position:absolute;inset:0;border-radius:0}
.foto.faixa-foto{height:420px;flex:none}
.par{display:flex;gap:24px;height:520px;flex:none}
.foto.metade{flex:1;height:100%}
.lados{display:flex;gap:24px}
.lados p{flex:1}
.lados b{display:block;color:${p.destaque};font-size:30px;margin-bottom:6px}
.velo{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.05) 0%,rgba(0,0,0,.78) 100%)}
.velo.sem{background:none}
.capa{justify-content:flex-end}
.capa h1,.capa p{color:#fff;text-shadow:0 2px 24px rgba(0,0,0,.35)}
.capa p{color:#f1eeea}
.faixa{width:120px;height:14px;border-radius:7px;background:${p.destaque}}
.desliza{font-size:30px;color:${p.destaque};font-weight:700}
</style></head><body>${corpoDoSlide(d)}</body></html>`;
}

/**
 * O script que roda no navegador antes da foto: para cada caixa `data-caixa`, encolhe a letra (até 55% do tamanho base) enquanto o texto passa da caixa; se ainda passar, tira palavras do fim
 * e põe reticências. Devolve a lista do que teve de ser cortado (o servidor registra). É um texto de script, não uma função do servidor: roda dentro da página.
 */
export const AJUSTAR_CAIXAS = `(() => {
  const cortados = [];
  const MAXIMO = { H1: 760, H2: 520, P: 480 };
  document.querySelectorAll('[data-caixa]').forEach((el, i) => {
    const base = Number(el.getAttribute('data-base')) || 48;
    const max = Number(el.getAttribute('data-max')) || MAXIMO[el.tagName] || 480;
    let tam = base;
    const estoura = () => el.getBoundingClientRect().height > max || el.scrollWidth > el.clientWidth + 1;
    el.style.fontSize = tam + 'px';
    while (estoura() && tam > base * 0.55) { tam -= 2; el.style.fontSize = tam + 'px'; }
    if (estoura()) {
      const palavras = el.textContent.trim().split(/\\s+/);
      while (estoura() && palavras.length > 1) { palavras.pop(); el.textContent = palavras.join(' ') + '...'; }
      cortados.push(el.tagName.toLowerCase() + ':' + i);
    }
  });
  return JSON.stringify(cortados);
})()`;
