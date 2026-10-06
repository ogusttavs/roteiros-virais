/**
 * A coleta das tendências do Brasil (E55), compartilhada por todos os setores, de madrugada (05:50, antes dos temas do dia) e ao meio-dia (12:00). Duas fontes gratuitas:
 * - as buscas em alta do Google no Brasil, pelo RSS público de tendências (`trends.google.com/trending/rss?geo=BR`, conferido em 06/10/2026: responde 200 com 10 buscas, o volume aproximado e as
 *   notícias que o Google já associa a cada uma); lido pelo mesmo transporte seguro da E53 (`busca-segura`, só https, host na lista, teto de bytes), nunca raspando página;
 * - os vídeos em alta do YouTube no Brasil (`videos.list` com `chart=mostPopular`, 1 unidade da cota que já existe), sem música e sem jogo (são quase só isso e não servem a um dono de negócio).
 * Os títulos das duas fontes são agrupados em assuntos pelo modelo barato (embrulhados como dado); se o modelo falhar, a coleta não cai: cada busca do Google vira um assunto. O que é sensível
 * (tragédia, morte, política partidária) é marcado pelo modelo e conferido por palavras. Cada rodada grava todos os assuntos com a mesma `coletada_em`; "a lista de agora" é a mais recente.
 * Depois de gravar, atualiza o tema do momento dos setores em uso (`tema-do-momento.ts`). Custo de coleta: zero (só a unidade do YouTube); o do agrupamento fica no registro de IA.
 */
import Parser from "rss-parser";

import { db } from "@/db";
import { tendenciasBrasil, type FonteDaTendencia } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as agruparIA from "@/ia/prompts/agruparTendencias";
import { registrarGeracao } from "@/ia/registro";
import { config } from "@/lib/config";
import { logger } from "@/lib/log";
import { enderecoHttpsSeguro } from "@/servicos/noticias-assuntos";
import { chaveDoAssunto, ehSensivel } from "@/servicos/tendencias";

import { lerComGuarda } from "./busca-segura";
import { consumoDeHoje, LIMITE_DIARIO_UNIDADES, registrarConsumo } from "./coleta-youtube";
import { ErroColeta } from "./execucoes";
import { atualizarTemasDoMomentoDosSetoresEmUso } from "./tema-do-momento";
import { buscarMaisPopularesNoBrasil, CUSTO_LISTA, type YoutubeVideoPopular } from "./youtube-api";

export const URL_DAS_TENDENCIAS_DO_GOOGLE = "https://trends.google.com/trending/rss?geo=BR";
const HOST_DO_GOOGLE_TRENDS = "trends.google.com";
const BYTES_DO_FEED = 1_000_000;
/** Categorias do YouTube que não servem de assunto: 10 é Música, 20 é Jogos. */
const CATEGORIAS_FORA = new Set(["10", "20"]);
const MAXIMO_GOOGLE = 25;
const MAXIMO_YOUTUBE = 20;

export type BuscaDoGoogle = { termo: string; trafego: string | null; noticias: { titulo: string; url: string | null; fonte: string | null }[] };

type ItemColetado =
  | { numero: number; fonte: "google"; texto: string; google: BuscaDoGoogle; posicao: number }
  | { numero: number; fonte: "youtube"; texto: string; video: YoutubeVideoPopular; posicao: number };

type ItemCrú = { title?: string; trafego?: string; noticias?: Record<string, string[] | undefined>[] };

const parser = new Parser<Record<string, never>, ItemCrú>({
  customFields: {
    item: [
      ["ht:approx_traffic", "trafego"],
      ["ht:news_item", "noticias", { keepArray: true }],
    ],
  },
});

/** As buscas em alta de um feed do Google Trends (puro, para testar com um feed gravado). */
export async function lerBuscasDoGoogle(xml: string): Promise<BuscaDoGoogle[]> {
  const feed = await parser.parseString(xml);
  const saida: BuscaDoGoogle[] = [];
  for (const item of feed.items) {
    const termo = (item.title ?? "").trim();
    if (!termo) continue;
    const noticias = (item.noticias ?? []).map((n) => ({
      titulo: (n["ht:news_item_title"]?.[0] ?? "").trim(),
      url: enderecoHttpsSeguro(n["ht:news_item_url"]?.[0]),
      fonte: (n["ht:news_item_source"]?.[0] ?? "").trim() || null,
    }));
    saida.push({ termo: termo.slice(0, 120), trafego: (item.trafego ?? "").trim() || null, noticias: noticias.filter((n) => n.titulo).slice(0, 3) });
  }
  return saida.slice(0, MAXIMO_GOOGLE);
}

/** Os vídeos em alta que servem de assunto: fora música e jogo, no máximo `MAXIMO_YOUTUBE`. */
export function videosQueServem(videos: YoutubeVideoPopular[]): YoutubeVideoPopular[] {
  return videos.filter((v) => v.snippet.title && !CATEGORIAS_FORA.has(v.snippet.categoryId ?? "")).slice(0, MAXIMO_YOUTUBE);
}

type DepsTendencias = {
  agora?: Date;
  baixarGoogle?: () => Promise<string>;
  buscarYoutube?: () => Promise<YoutubeVideoPopular[]>;
  /** Os testes desligam o passo seguinte (o tema do momento) quando só querem a coleta. */
  semTemaDoMomento?: boolean;
};

async function baixarOGoogleTrends(): Promise<string> {
  const { bytes } = await lerComGuarda(URL_DAS_TENDENCIAS_DO_GOOGLE, {
    aceita: "application/rss+xml, application/xml, text/xml, */*",
    limiteBytes: BYTES_DO_FEED,
    tempoMs: 15_000,
    hostPermitido: (h) => h === HOST_DO_GOOGLE_TRENDS,
  });
  return new TextDecoder("utf-8").decode(bytes);
}

async function maisPopularesDoYoutube(): Promise<YoutubeVideoPopular[]> {
  return (await buscarMaisPopularesNoBrasil()).items ?? [];
}

type AssuntoFinal = { assunto: string; termos: string[]; fontes: FonteDaTendencia[]; sensivel: boolean };

function fonteDoItem(item: ItemColetado): FonteDaTendencia {
  if (item.fonte === "google") {
    return { fonte: "google", titulo: item.google.termo, url: item.google.noticias.find((n) => n.url)?.url ?? null, trafego: item.google.trafego, posicao: item.posicao };
  }
  return { fonte: "youtube", titulo: item.video.snippet.title.slice(0, 200), url: enderecoHttpsSeguro(`https://www.youtube.com/watch?v=${encodeURIComponent(item.video.id)}`), trafego: null, posicao: item.posicao };
}

/** Sem o modelo (falhou ou devolveu lixo): cada busca do Google vira um assunto, na ordem em que o Google a trouxe; o vídeo do YouTube sozinho não é assunto. */
function assuntosSemOModelo(itens: ItemColetado[]): AssuntoFinal[] {
  return itens
    .filter((i): i is Extract<ItemColetado, { fonte: "google" }> => i.fonte === "google")
    .map((i) => ({
      assunto: i.google.termo,
      termos: [i.google.termo],
      fontes: [fonteDoItem(i)],
      sensivel: ehSensivel(`${i.google.termo} ${i.google.noticias.map((n) => n.titulo).join(" ")}`),
    }));
}

/** O que o modelo agrupou, conferido: só itens que existem, cada item em no máximo um assunto, assunto sem item válido sai, e `sensivel` vale o do modelo OU o das palavras. */
export function conferirAssuntos(saida: agruparIA.SaidaAgruparTendencias, itens: ItemColetado[]): AssuntoFinal[] {
  const porNumero = new Map(itens.map((i) => [i.numero, i]));
  const usados = new Set<number>();
  const finais: AssuntoFinal[] = [];
  for (const a of saida.assuntos) {
    const doAssunto = a.itens.filter((n) => porNumero.has(n) && !usados.has(n));
    if (doAssunto.length === 0) continue;
    for (const n of doAssunto) usados.add(n);
    const itensDoAssunto = doAssunto.map((n) => porNumero.get(n)!);
    const textoParaPalavras = [a.assunto, ...a.termos, ...itensDoAssunto.map((i) => (i.fonte === "google" ? `${i.google.termo} ${i.google.noticias.map((x) => x.titulo).join(" ")}` : i.video.snippet.title))].join(" ");
    finais.push({
      assunto: a.assunto.trim().slice(0, 80),
      termos: a.termos.map((t) => t.trim()).filter(Boolean).slice(0, 6),
      fontes: itensDoAssunto.map(fonteDoItem),
      sensivel: a.sensivel || ehSensivel(textoParaPalavras),
    });
  }
  return finais.slice(0, agruparIA.MAXIMO_DE_ASSUNTOS);
}

async function agrupar(itens: ItemColetado[]): Promise<{ assuntos: AssuntoFinal[]; porModelo: boolean }> {
  const entrada = agruparIA.montarEntrada({
    itens: itens.map((i) => ({
      numero: i.numero,
      fonte: i.fonte,
      texto:
        i.fonte === "google"
          ? `${i.google.termo}${i.google.trafego ? ` (buscas: ${i.google.trafego})` : ""}${i.google.noticias.length > 0 ? `; notícias: ${i.google.noticias.map((n) => n.titulo).join(" / ")}` : ""}`
          : `${i.video.snippet.title} (canal ${i.video.snippet.channelTitle})`,
    })),
  });
  try {
    const resultado = await gerarEstruturado({
      tarefa: "agruparTendencias",
      nivel: agruparIA.nivel,
      effort: agruparIA.esforco,
      schema: agruparIA.schema,
      sistemaEstavel: agruparIA.montarSistemaEstavel(),
      entrada,
    });
    await registrarGeracao({
      tarefa: "agruparTendencias",
      versaoPrompt: agruparIA.versao,
      modelo: resultado.modelo,
      nivel: agruparIA.nivel,
      entradas: { itens: itens.length },
      saida: resultado.dados,
      uso: { tokensEntrada: resultado.tokensEntrada, tokensSaida: resultado.tokensSaida, tokensCacheLeitura: resultado.tokensCacheLeitura, tokensCacheEscrita: resultado.tokensCacheEscrita },
    });
    const assuntos = conferirAssuntos(resultado.dados, itens);
    if (assuntos.length > 0) return { assuntos, porModelo: true };
  } catch (erro) {
    logger.warn({ err: erro }, "nao foi possivel agrupar as tendencias com o modelo; cada busca do Google vira um assunto");
  }
  return { assuntos: assuntosSemOModelo(itens), porModelo: false };
}

export async function rodarTendenciasBrasil(deps: DepsTendencias = {}): Promise<Record<string, unknown>> {
  const agora = deps.agora ?? new Date();
  const falhas: string[] = [];

  let buscas: BuscaDoGoogle[] = [];
  try {
    buscas = await lerBuscasDoGoogle(await (deps.baixarGoogle ?? baixarOGoogleTrends)());
  } catch (erro) {
    falhas.push(`Google Trends: ${erro instanceof Error ? erro.message : String(erro)}`);
  }

  let videos: YoutubeVideoPopular[] = [];
  if (deps.buscarYoutube || config.coleta.youtubeKey) {
    try {
      if (!deps.buscarYoutube && (await consumoDeHoje()) + CUSTO_LISTA > LIMITE_DIARIO_UNIDADES) {
        falhas.push("YouTube: a cota de hoje está no limite");
      } else {
        videos = videosQueServem(await (deps.buscarYoutube ?? maisPopularesDoYoutube)());
        if (!deps.buscarYoutube) await registrarConsumo(CUSTO_LISTA);
      }
    } catch (erro) {
      falhas.push(`YouTube: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  if (buscas.length === 0 && videos.length === 0) {
    throw new ErroColeta(`nenhuma fonte de tendências respondeu: ${falhas.join("; ") || "as duas vieram vazias"}`, true);
  }

  const itens: ItemColetado[] = [
    ...buscas.map((g, i): ItemColetado => ({ numero: i + 1, fonte: "google", texto: g.termo, google: g, posicao: i + 1 })),
    ...videos.map((v, i): ItemColetado => ({ numero: buscas.length + i + 1, fonte: "youtube", texto: v.snippet.title, video: v, posicao: i + 1 })),
  ];

  const { assuntos, porModelo } = await agrupar(itens);
  if (assuntos.length === 0) throw new ErroColeta("nenhum assunto saiu das fontes de tendências", false);

  await db()
    .insert(tendenciasBrasil)
    .values(
      assuntos.map((a, i) => ({
        coletadaEm: agora,
        assunto: a.assunto,
        chave: chaveDoAssunto(a.assunto),
        termos: a.termos,
        fontes: a.fontes,
        posicao: i + 1,
        sensivel: a.sensivel,
      })),
    );

  let temaDoMomento: Record<string, unknown> | undefined;
  if (!deps.semTemaDoMomento) {
    try {
      temaDoMomento = await atualizarTemasDoMomentoDosSetoresEmUso(agora);
    } catch (erro) {
      falhas.push(`Tema do momento: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  return {
    buscasDoGoogle: buscas.length,
    videosDoYoutube: videos.length,
    assuntos: assuntos.length,
    sensiveis: assuntos.filter((a) => a.sensivel).length,
    agrupadoPorModelo: porModelo,
    temaDoMomento,
    falhas: falhas.length > 0 ? falhas : undefined,
  };
}
