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

/**
 * Monta a linha do tempo. Lança `ErroDaAnimacao("entrada")` se não há cena, se há demais, se uma cena é longa demais ou se o vídeo passaria do teto. `seguraDoFinalS` estica a última cena (a chamada
 * fica na tela) até onde o teto deixar: nunca é o motivo de um vídeo ser recusado.
 */
export function montarLinhaDoTempo(cenas: CenaDeEntrada[], opcoes: { seguraDoFinalS?: number } = {}): LinhaDoTempo {
  const L = LIMITES_DA_ANIMACAO;
  const limpas = cenas
    .map((c) => ({ ...c, texto: limparTexto(String(c.texto ?? "")), traducao: limparTexto(String(c.traducao ?? "")) }))
    .filter((c) => c.texto.length > 0);
  if (limpas.length === 0) throw new ErroDaAnimacao("sem cenas com texto", "entrada");
  if (limpas.length > L.maxCenas) throw new ErroDaAnimacao("cenas demais", "entrada");
  let cursor = 0;
  const saida = limpas.map((c) => {
    if (c.texto.length > L.maxCaracteresPorCena || c.traducao.length > L.maxCaracteresPorCena)
      throw new ErroDaAnimacao("uma cena passou do tamanho do bloco curto", "entrada");
    const palavras = c.texto.split(" ");
    // Com tradução, quem assiste lê um idioma só: a outra linha soma metade do tempo dela (o olho passa por ela).
    const daTraducao = c.traducao ? c.traducao.split(" ").length * L.segundosPorPalavra * 0.5 : 0;
    const lida = palavras.length * L.segundosPorPalavra + L.entradaS + daTraducao;
    const pedida =
      typeof c.duracaoS === "number" && Number.isFinite(c.duracaoS) ? c.duracaoS : lida;
    const duracao = Math.min(L.duracaoMaximaDaCenaS, Math.max(L.duracaoMinimaDaCenaS, pedida));
    const cena = {
      texto: c.texto,
      palavras,
      traducao: c.traducao || null,
      inicioS: arredondar(cursor),
      fimS: arredondar(cursor + duracao),
    };
    cursor += duracao;
    return cena;
  });
  if (cursor > L.duracaoMaximaTotalS + 0.0005)
    throw new ErroDaAnimacao("o vídeo passaria do tempo máximo", "entrada");
  const pedidaNoFinal = opcoes.seguraDoFinalS;
  const segura =
    typeof pedidaNoFinal === "number" && Number.isFinite(pedidaNoFinal) && pedidaNoFinal > 0
      ? Math.min(pedidaNoFinal, Math.max(0, L.duracaoMaximaTotalS - cursor))
      : 0;
  if (segura > 0) {
    cursor += segura;
    saida[saida.length - 1].fimS = arredondar(cursor);
  }
  return { cenas: saida, duracaoS: arredondar(cursor) };
}

const COR = /^#[0-9a-fA-F]{6}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** O @ como o Instagram aceita: letras sem acento, algarismos, ponto e sublinhado, até 30. Só isso vai para o HTML (e ainda escapado). */
const ARROBA = /^@[A-Za-z0-9._]{1,30}$/;
/** Um PNG começa sempre pela assinatura do formato (89 50 4E 47 0D 0A 1A 0A), que em base64 é este começo. */
const ASSINATURA_DO_PNG = "iVBORw0KGgo";
/** Endereço de site sem protocolo e sem caminho: nome, ponto, domínio ("clinica.com.br"). Só letras sem acento, algarismos e hífen. */
const SITE = /^(?=.{4,60}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
/** A sigla do idioma no selo da tradução: duas ou três letras maiúsculas sem acento. */
const SIGLA = /^[A-Z]{2,3}$/;
/** O maior arquivo embutido (letra ou imagem), em caracteres de base64. */
const MAIOR_ARQUIVO_EMBUTIDO = 2_000_000;

/**
 * O @ a partir do que a marca guardou em `perfis.instagram` (o nome, o @ ou o endereço do perfil). A mesma regra de `arrobaDaMarca` do carrossel, repetida aqui para o contêiner de render não
 * carregar o serviço do carrossel (que puxa a IA). Fora do formato, `null`.
 */
export function arrobaDoPerfil(instagram: string | null | undefined): string | null {
  const bruto = (instagram ?? "")
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/[/?#].*$/, "")
    .replace(/^@+/, "");
  const arroba = `@${bruto}`;
  return ARROBA.test(arroba) ? arroba : null;
}

/** Os padrões são os tokens do painel (`src/ui/tokens.css`, tema escuro): fundo quase preto, texto quase branco e a luz dourada da identidade como destaque. */
export const MARCA_PADRAO: MarcaResolvida = {
  corFundo: "#101012",
  corTexto: "#f7f7f5",
  corDestaque: "#e8c15a",
  fonteBase64: null,
  arroba: null,
  logoPngBase64: null,
  simboloPngBase64: null,
  site: null,
  fonteRotuloBase64: null,
  rotuloDaTraducao: null,
};

/** Arquivo embutido em base64 (letra ou imagem): só o alfabeto do base64, com teto de tamanho e, se pedido, o começo certo. Fora disso, `null`: nunca chega ao HTML. */
function arquivoEmBase64(valor: unknown, comeco = ""): string | null {
  return typeof valor === "string" && valor.length > 0 && valor.length < MAIOR_ARQUIVO_EMBUTIDO && BASE64.test(valor) && valor.startsWith(comeco)
    ? valor
    : null;
}

/** A marca que o cliente pode ter (cores, letras, logo, site); valor fora do formato cai no padrão, nunca vai para o CSS nem para o HTML. */
export function resolverMarca(marca?: MarcaDaAnimacao): MarcaResolvida {
  const cor = (v: string | undefined, padrao: string) =>
    typeof v === "string" && COR.test(v) ? v.toLowerCase() : padrao;
  const site = typeof marca?.site === "string" ? marca.site.trim().toLowerCase() : "";
  return {
    corFundo: cor(marca?.corFundo, MARCA_PADRAO.corFundo),
    corTexto: cor(marca?.corTexto, MARCA_PADRAO.corTexto),
    corDestaque: cor(marca?.corDestaque, MARCA_PADRAO.corDestaque),
    fonteBase64: arquivoEmBase64(marca?.fonteBase64),
    arroba: typeof marca?.arroba === "string" && ARROBA.test(marca.arroba) ? marca.arroba : null,
    logoPngBase64: arquivoEmBase64(marca?.logoPngBase64, ASSINATURA_DO_PNG),
    simboloPngBase64: arquivoEmBase64(marca?.simboloPngBase64, ASSINATURA_DO_PNG),
    site: SITE.test(site) ? site : null,
    fonteRotuloBase64: arquivoEmBase64(marca?.fonteRotuloBase64),
    rotuloDaTraducao:
      typeof marca?.rotuloDaTraducao === "string" && SIGLA.test(marca.rotuloDaTraducao) ? marca.rotuloDaTraducao : null,
  };
}
