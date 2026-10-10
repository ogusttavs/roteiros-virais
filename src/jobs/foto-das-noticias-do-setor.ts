/**
 * A foto das notícias do setor (E53, item seguinte): a coleta do setor lê o Google News por termo, e o link dele é um redirecionador, sem foto. A foto vem do RSS direto dos portais da lista curada
 * (`config/fontes-noticias.ts`, a mesma da coleta dos assuntos): cada feed é baixado UMA vez, e a notícia do setor que tem o mesmo título (comparado sem acento nem maiúscula) ganha a foto do
 * feed, com o crédito do veículo ("Foto: G1"). Notícia cujo endereço já é de um veículo curado (não é redirecionador) pode ganhar o `og:image` da página, com teto por setor por rodada. Nunca baixa
 * o texto da matéria; só https e só domínio curado (`busca-segura`). Sem rede nos testes: `baixar` e `buscarPagina` entram por parâmetro.
 */
import { and, desc, eq, gte, isNull } from "drizzle-orm";

import { FONTES_DE_NOTICIAS, hostEhDeVeiculoCurado, LIMITE_FOTOS_DE_PAGINA_POR_ASSUNTO_POR_DIA } from "@/config/fontes-noticias";
import { db } from "@/db";
import { noticias } from "@/db/schema";
import { creditoDaFoto, enderecoHttpsSeguro, normalizarTexto } from "@/servicos/noticias-assuntos";

import { baixarFeed, baixarFotoDaPagina, noticiasDoFeed } from "./coleta-assuntos";

const DIA_MS = 24 * 60 * 60 * 1000;
/** Só as notícias dos últimos dias disputam foto: a capa não mostra mais velha que isso. */
const DIAS_DA_JANELA = 3;
/** Teto de linhas por rodada (a coleta do setor traz poucas centenas por dia). O teto de páginas lidas por setor também é POR RODADA (o job roda duas vezes por dia), não por dia. */
const LIMITE_DE_LINHAS = 800;

export type ResumoFotosDoSetor = {
  feedsLidos: number;
  /** Quantas notícias do setor ganharam a foto do feed (mesmo título). */
  fotosDoFeed: number;
  /** Quantas ganharam o `og:image` da página (só as de endereço de veículo curado). */
  fotosDePagina: number;
  /** Quantas notícias recentes do setor ficaram sem foto (o Google News não traz). */
  semFoto: number;
  /** Os feeds que não responderam (o veículo some só desta rodada). */
  falhas?: string[];
};

type LinhaSemFoto = { id: number; nichoId: number | null; titulo: string; url: string; fonte?: string | null; publicadoEm?: Date | null };
type FotoDeFeed = { veiculo: string; imagemUrl: string };
type ItemDeFeed = { titulo: string; veiculo: string; imagemUrl: string | null; publicadoEm?: Date | null };

/** A mesma manchete de dois dias diferentes não é a mesma matéria: a hora da notícia do setor e a do item do feed têm de estar a menos de 36 horas uma da outra (sem as duas horas, não há como conferir). */
const JANELA_DO_CASAMENTO_MS = 36 * 60 * 60 * 1000;

/** Uma notícia do setor só ganha a foto do MESMO veículo: com o veículo dela dito ("Valor Econômico"), a foto do G1 numa matéria de agência deixaria o cartão incoerente ("Foto: G1" no cartão do Valor). */
function casaComAFoto(linha: LinhaSemFoto, candidata: ItemDeFeed): boolean {
  if (linha.fonte && normalizarTexto(linha.fonte) !== normalizarTexto(candidata.veiculo)) return false;
  if (linha.publicadoEm && candidata.publicadoEm && Math.abs(linha.publicadoEm.getTime() - candidata.publicadoEm.getTime()) > JANELA_DO_CASAMENTO_MS) return false;
  return true;
}

/**
 * Para cada notícia do setor sem foto, a foto do feed que traz o mesmo título (comparado sem acento nem maiúscula), do mesmo veículo e da mesma janela de tempo (`casaComAFoto`). Pura: sem banco
 * e sem rede. Com mais de um item de mesmo título, vale o primeiro que passa nas duas conferências.
 */
export function fotosPorTitulo(linhas: LinhaSemFoto[], itensDosFeeds: ItemDeFeed[]): Map<number, FotoDeFeed> {
  const porTitulo = new Map<string, ItemDeFeed[]>();
  for (const item of itensDosFeeds) {
    const foto = enderecoHttpsSeguro(item.imagemUrl);
    if (!foto) continue;
    const chave = normalizarTexto(item.titulo);
    // Título curto demais ("Brasil", "Política") casaria com qualquer coisa: só compara manchete de verdade.
    if (chave.length < 12) continue;
    porTitulo.set(chave, [...(porTitulo.get(chave) ?? []), { ...item, imagemUrl: foto }]);
  }
  const achadas = new Map<number, FotoDeFeed>();
  for (const linha of linhas) {
    const achada = (porTitulo.get(normalizarTexto(linha.titulo)) ?? []).find((candidata) => casaComAFoto(linha, candidata));
    if (achada) achadas.set(linha.id, { veiculo: achada.veiculo, imagemUrl: achada.imagemUrl as string });
  }
  return achadas;
}

function hostDoEndereco(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

type Dependencias = {
  agora?: Date;
  baixar?: (url: string) => Promise<string>;
  buscarPagina?: (url: string) => Promise<string | null>;
};

export async function juntarFotosDasNoticiasDoSetor(deps: Dependencias = {}): Promise<ResumoFotosDoSetor> {
  const agora = deps.agora ?? new Date();
  const baixar = deps.baixar ?? baixarFeed;
  const buscarPagina = deps.buscarPagina ?? baixarFotoDaPagina;
  const desde = new Date(agora.getTime() - DIAS_DA_JANELA * DIA_MS);

  const linhas = await db()
    .select({ id: noticias.id, nichoId: noticias.nichoId, titulo: noticias.titulo, url: noticias.url, fonte: noticias.fonte, publicadoEm: noticias.publicadoEm })
    .from(noticias)
    .where(and(isNull(noticias.imagemUrl), gte(noticias.coletadoEm, desde)))
    .orderBy(desc(noticias.coletadoEm))
    .limit(LIMITE_DE_LINHAS);
  const resumo: ResumoFotosDoSetor = { feedsLidos: 0, fotosDoFeed: 0, fotosDePagina: 0, semFoto: 0 };
  if (linhas.length === 0) return resumo;

  // Cada feed uma vez; o que não responde só tira o veículo desta rodada.
  const itens: ItemDeFeed[] = [];
  const falhas: string[] = [];
  for (const fonte of FONTES_DE_NOTICIAS) {
    for (const feed of fonte.feeds) {
      try {
        const doFeed = await noticiasDoFeed(await baixar(feed.url), fonte.veiculo, "rss");
        itens.push(...doFeed.map((n) => ({ titulo: n.titulo, veiculo: n.veiculo, imagemUrl: n.imagemUrl, publicadoEm: n.publicadoEm })));
        resumo.feedsLidos += 1;
      } catch (erro) {
        falhas.push(`${fonte.veiculo} / ${feed.secao}: ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }
  }

  const doFeed = fotosPorTitulo(linhas, itens);
  for (const [id, foto] of doFeed) {
    await db()
      .update(noticias)
      .set({ imagemUrl: foto.imagemUrl, imagemCredito: creditoDaFoto(foto.veiculo) })
      .where(and(isNull(noticias.imagemUrl), eq(noticias.id, id)));
    resumo.fotosDoFeed += 1;
  }

  // As que ainda estão sem foto e já têm endereço de veículo curado (não o redirecionador do Google): o `og:image` da página, com teto por setor.
  const porSetor = new Map<number, number>();
  for (const linha of linhas) {
    if (doFeed.has(linha.id)) continue;
    const host = hostDoEndereco(linha.url);
    if (!host || !hostEhDeVeiculoCurado(host)) {
      resumo.semFoto += 1;
      continue;
    }
    const usadas = porSetor.get(linha.nichoId ?? 0) ?? 0;
    if (usadas >= LIMITE_FOTOS_DE_PAGINA_POR_ASSUNTO_POR_DIA) {
      resumo.semFoto += 1;
      continue;
    }
    porSetor.set(linha.nichoId ?? 0, usadas + 1);
    const foto = enderecoHttpsSeguro(await buscarPagina(linha.url));
    if (!foto) {
      resumo.semFoto += 1;
      continue;
    }
    await db()
      .update(noticias)
      .set({ imagemUrl: foto, imagemCredito: creditoDaFoto(linha.fonte ?? host) })
      .where(and(isNull(noticias.imagemUrl), eq(noticias.id, linha.id)));
    resumo.fotosDePagina += 1;
  }

  if (falhas.length > 0) resumo.falhas = falhas;
  return resumo;
}
