/**
 * E68 A1: o montador de cenas. Pura, sem navegador: limpa o texto que veio do roteiro, confere os limites, dá a cada cena o tempo de leitura e põe todas numa linha do tempo. O que vai para o HTML
 * é sempre texto escapado (`escaparTexto`); nada do cliente vira marcação.
 */
import { LIMITES_DA_ANIMACAO } from "@/config/animacao";

import {
  ErroDaAnimacao,
  type CenaDeEntrada,
  type LinhaDoTempo,
  type MarcaDaAnimacao,
  type MarcaResolvida,
} from "./tipos";

/** Texto de fora indo para dentro de HTML: o que abre ou fecha marcação sai. Inclui a crase e o apóstrofo para o texto também ser seguro dentro de um atributo ou de um template. */
export function escaparTexto(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

/** Caractere que não se desenha: controle, separador de linha e parágrafo, marca de direção e invisíveis (por código, sem escrever nenhum deles no arquivo). */
function naoSeDesenha(codigo: number): boolean {
  return (
    codigo <= 0x1f ||
    (codigo >= 0x7f && codigo <= 0x9f) ||
    (codigo >= 0x200b && codigo <= 0x200f) ||
    (codigo >= 0x2028 && codigo <= 0x202e) ||
    (codigo >= 0x2060 && codigo <= 0x2064) ||
    codigo === 0xfeff
  );
}

/** Tira o que não se desenha, junta espaços e apara. */
export function limparTexto(texto: string): string {
  let saida = "";
  for (const letra of texto) saida += naoSeDesenha(letra.codePointAt(0) ?? 0) ? " " : letra;
  return saida.split(/\s+/).filter(Boolean).join(" ");
}

function arredondar(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Monta a linha do tempo. Lança `ErroDaAnimacao("entrada")` se não há cena, se há demais, se uma cena é longa demais ou se o vídeo passaria do teto. */
export function montarLinhaDoTempo(cenas: CenaDeEntrada[]): LinhaDoTempo {
  const L = LIMITES_DA_ANIMACAO;
  const limpas = cenas
    .map((c) => ({ ...c, texto: limparTexto(String(c.texto ?? "")) }))
    .filter((c) => c.texto.length > 0);
  if (limpas.length === 0) throw new ErroDaAnimacao("sem cenas com texto", "entrada");
  if (limpas.length > L.maxCenas) throw new ErroDaAnimacao("cenas demais", "entrada");
  let cursor = 0;
  const saida = limpas.map((c) => {
    if (c.texto.length > L.maxCaracteresPorCena)
      throw new ErroDaAnimacao("uma cena passou do tamanho do bloco curto", "entrada");
    const palavras = c.texto.split(" ");
    const lida = palavras.length * L.segundosPorPalavra + L.entradaS;
    const pedida =
      typeof c.duracaoS === "number" && Number.isFinite(c.duracaoS) ? c.duracaoS : lida;
    const duracao = Math.min(L.duracaoMaximaDaCenaS, Math.max(L.duracaoMinimaDaCenaS, pedida));
    const cena = {
      texto: c.texto,
      palavras,
      inicioS: arredondar(cursor),
      fimS: arredondar(cursor + duracao),
    };
    cursor += duracao;
    return cena;
  });
  const duracaoS = arredondar(cursor);
  if (duracaoS > L.duracaoMaximaTotalS)
    throw new ErroDaAnimacao("o vídeo passaria do tempo máximo", "entrada");
  return { cenas: saida, duracaoS };
}

const COR = /^#[0-9a-fA-F]{6}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Os padrões são os tokens do painel (`src/ui/tokens.css`, tema escuro): fundo quase preto, texto quase branco e a luz dourada da identidade como destaque. */
export const MARCA_PADRAO: MarcaResolvida = {
  corFundo: "#101012",
  corTexto: "#f7f7f5",
  corDestaque: "#e8c15a",
  fonteBase64: null,
};

/** A marca que o cliente pode ter (cores e letra); valor fora do formato cai no padrão, nunca vai para o CSS. */
export function resolverMarca(marca?: MarcaDaAnimacao): MarcaResolvida {
  const cor = (v: string | undefined, padrao: string) =>
    typeof v === "string" && COR.test(v) ? v.toLowerCase() : padrao;
  const fonte =
    typeof marca?.fonteBase64 === "string" &&
    marca.fonteBase64.length > 0 &&
    marca.fonteBase64.length < 2_000_000 &&
    BASE64.test(marca.fonteBase64)
      ? marca.fonteBase64
      : null;
  return {
    corFundo: cor(marca?.corFundo, MARCA_PADRAO.corFundo),
    corTexto: cor(marca?.corTexto, MARCA_PADRAO.corTexto),
    corDestaque: cor(marca?.corDestaque, MARCA_PADRAO.corDestaque),
    fonteBase64: fonte,
  };
}
