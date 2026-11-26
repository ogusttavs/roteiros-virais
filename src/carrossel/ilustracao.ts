/**
 * E69 PR A: as contas da ilustracao por slide, puras e leves (sem navegador), para o render e os testes usarem a mesma regra. Onde a ilustracao entra em cada tipo, qual dos dois estilos o slide leva
 * (a mistura decidida pelo Gustavo em 25/11/2026), quanto veu cada estilo pede e a conta do contraste medido no pixel de verdade.
 *
 * Os dois estilos dos slides de texto: LEVE (a ilustracao bem presente, um veu geral fraco, degrade forte no alto e no pe e um painel arredondado com a cor do modo atras do bloco de texto) e FORTE
 * (a ilustracao como fundo discreto, so um veu, sem painel). Antes e depois e resultado NUNCA recebem ilustracao: la so foto real de paciente.
 */
import { contraste } from "./modelos";

export type EstiloDaIlustracao = "leve" | "forte";

/** Os tipos que nunca recebem ilustracao (regra do conselho adotada pelo Gustavo: so foto real de paciente, com autorizacao). */
export const TIPOS_SEM_ILUSTRACAO: ReadonlySet<string> = new Set(["antes-depois", "prova-resultado"]);
/** Os tipos de foto: sem foto da pessoa, a ilustracao entra no lugar dela, como foto. */
export const TIPOS_ILUSTRADOS_COMO_FOTO: ReadonlySet<string> = new Set(["capa-foto", "noticia"]);
/** Os tipos de texto: a ilustracao (ou a foto da pessoa, que vence) entra como fundo do slide inteiro. O passo com foto da pessoa usa o modelo de foto e fica de fora. */
export const TIPOS_ILUSTRADOS_COMO_FUNDO: ReadonlySet<string> = new Set(["item", "passo", "capa-texto", "dado", "resumo", "chamada"]);

/** Os tipos em que a imagem e o assunto: estilo leve. */
const ASSUNTO: ReadonlySet<string> = new Set(["item", "passo", "capa-texto"]);
/** Os tipos que sempre levam o estilo forte, venha a ilustracao generica ou nao. */
const SEMPRE_FORTE: ReadonlySet<string> = new Set(["resumo", "chamada", "dado"]);

export function aceitaIlustracao(tipo: string): boolean {
  return !TIPOS_SEM_ILUSTRACAO.has(tipo) && (TIPOS_ILUSTRADOS_COMO_FOTO.has(tipo) || TIPOS_ILUSTRADOS_COMO_FUNDO.has(tipo));
}

/** O estilo de um slide pelo tipo e por a imagem ser generica, antes de a mistura olhar os vizinhos. */
export function estiloBase(tipo: string, generica: boolean): EstiloDaIlustracao {
  if (generica || SEMPRE_FORTE.has(tipo)) return "forte";
  return ASSUNTO.has(tipo) ? "leve" : "forte";
}

/**
 * A mistura: o estilo de cada slide que tem imagem de fundo (os outros levam nulo e quebram a sequencia), com a regra "nunca tres seguidos no mesmo estilo", que vale mais que a regra por tipo. Quando o terceiro
 * repetiria, troca o terceiro; se ele e fixo (resumo, chamada ou dado: forte por tipo), troca o do meio se nao for fixo, e se o do meio tambem e fixo (um dado, um resumo e uma chamada seguidos), o do meio
 * vira leve, a menos que a imagem dele seja generica (a generica fica forte: ela nao e sobre o assunto), caso em que troca o terceiro.
 */
export function estilosDaMistura(slides: { tipo: string; comFundo: boolean; generica?: boolean }[]): (EstiloDaIlustracao | null)[] {
  const generica = slides.map((s) => s.comFundo && s.generica === true);
  const estilos: (EstiloDaIlustracao | null)[] = slides.map((s) => (s.comFundo ? estiloBase(s.tipo, s.generica === true) : null));
  const fixo = slides.map((s, i) => s.comFundo && (generica[i] || SEMPRE_FORTE.has(s.tipo)));
  const outro = (e: EstiloDaIlustracao): EstiloDaIlustracao => (e === "leve" ? "forte" : "leve");
  for (let i = 2; i < estilos.length; i += 1) {
    const e = estilos[i];
    if (e === null || estilos[i - 1] !== e || estilos[i - 2] !== e) continue;
    const quem = !fixo[i] ? i : !fixo[i - 1] ? i - 1 : !generica[i - 1] ? i - 1 : !generica[i] ? i : null;
    if (quem !== null) estilos[quem] = outro(e);
  }
  return estilos;
}

/** Quantos passos de reforco do veu o render pode dar quando o contraste medido nao passa (0 e o veu base). */
export const PASSOS_DE_REFORCO = 5;

export type VeuDaIlustracao = {
  /** Quanto da cor do modo cobre a imagem inteira (0 a 100). */
  geral: number;
  /** O degrade do alto e do pe, em leve (0 a 100 na ponta); 0 em forte. */
  bordas: number;
  /** O painel atras do bloco de texto, em leve (0 a 100); 0 em forte (sem painel). */
  painel: number;
};

/**
 * O veu de cada estilo no passo de reforco `reforco` (0 a PASSOS_DE_REFORCO). Leve: geral 28, bordas 92, painel 93. Forte: 72 no claro, 78 no escuro, 84 na cor cheia. Cada reforco sobe os numeros
 * ate o teto, que e cobertura quase total (o texto passa de qualquer jeito).
 */
export function veuDaIlustracao(estilo: EstiloDaIlustracao, modo: "claro" | "escuro" | "marca", reforco: number): VeuDaIlustracao {
  const r = Math.max(0, Math.min(PASSOS_DE_REFORCO, Math.round(reforco)));
  if (estilo === "leve") return { geral: Math.min(95, 28 + r * 14), bordas: Math.min(100, 92 + r * 2), painel: Math.min(100, 93 + r * 2) };
  const base = modo === "marca" ? 84 : modo === "escuro" ? 78 : 72;
  return { geral: Math.min(97, base + r * 5), bordas: 0, painel: 0 };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// O contraste medido no pixel de verdade

/** O piso do contraste do texto e o da letra grande (WCAG AA). */
export const CONTRASTE_DO_TEXTO = 4.5;
export const CONTRASTE_DA_LETRA_GRANDE = 3;
/** A partir deste tamanho (px) a letra do slide conta como grande: so os titulos. O resto do slide e texto. */
export const LETRA_GRANDE_A_PARTIR_DE = 56;

export function pisoDoContraste(tamanhoPx: number): number {
  return tamanhoPx >= LETRA_GRANDE_A_PARTIR_DE ? CONTRASTE_DA_LETRA_GRANDE : CONTRASTE_DO_TEXTO;
}

const hex = (c: [number, number, number]): string => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

/**
 * O contraste do pior ponto atras de um texto: dada a cor da letra e os pixels (RGB) que ficam atras dela, o contraste de cada pixel contra a letra e o do 3o percentil mais baixo (ignora um pixel isolado,
 * como a ponta de um dente brilhante, sem esconder uma regiao inteira ruim). Sem pixels, nao ha o que medir: devolve nulo.
 */
export function piorContrasteAtras(letra: [number, number, number], pixels: [number, number, number][]): number | null {
  if (pixels.length === 0) return null;
  const tinta = hex(letra);
  const razoes = pixels.map((p) => contraste(tinta, hex(p))).sort((a, b) => a - b);
  return razoes[Math.min(razoes.length - 1, Math.floor(razoes.length * 0.03))];
}

export type TextoMedido = { cor: [number, number, number]; tamanho: number; pixels: [number, number, number][]; /** So para o registro: o comeco do texto. */ trecho?: string };

/** Os textos que nao passam do piso, com o pior contraste de cada um (para o registro e para o teste). */
export function textosReprovados(textos: TextoMedido[]): { trecho: string; pior: number; piso: number }[] {
  const lista: { trecho: string; pior: number; piso: number }[] = [];
  for (const t of textos) {
    const pior = piorContrasteAtras(t.cor, t.pixels);
    if (pior !== null && pior < pisoDoContraste(t.tamanho)) lista.push({ trecho: t.trecho ?? "", pior: Math.round(pior * 100) / 100, piso: pisoDoContraste(t.tamanho) });
  }
  return lista;
}

/** Todos os textos do slide passam do piso (4,5, ou 3 na letra grande)? Quem nao tem pixel para medir nao reprova. */
export function contrasteAprovado(textos: TextoMedido[]): boolean {
  return textos.every((t) => {
    const pior = piorContrasteAtras(t.cor, t.pixels);
    return pior === null || pior >= pisoDoContraste(t.tamanho);
  });
}
