/**
 * A coleta diária das notícias dos assuntos que as marcas acompanham (E53), dentro do mesmo job das notícias por setor (`coleta-noticias.ts`): cada feed da lista curada de portais
 * (`config/fontes-noticias.ts`) é baixado UMA vez para todos os assuntos, e o Google News é pedido por termo de cada assunto; o que casa com o assunto, sem duplicata, ganha a foto do
 * veículo (do RSS ou do `og:image` da página, com o crédito) e um resumo NOSSO de duas linhas no modelo barato, com teto por assunto por dia. Nunca o texto da matéria. Assunto sem notícia
 * aberta há 30 dias sai sozinho (a não ser que esteja fixado). Sem rede nos testes: `baixar` e `buscarPagina` entram por parâmetro.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import Parser from "rss-parser";

import { usdParaBrl } from "@/config/dinheiro";
import { FONTES_DE_NOTICIAS, HOST_DO_GOOGLE_NEWS, hostEhDeVeiculoCurado, LIMITE_DE_RESUMOS_POR_MARCA_POR_DIA, LIMITE_FOTOS_DE_PAGINA_POR_ASSUNTO_POR_DIA, LIMITE_NOVAS_POR_ASSUNTO_POR_DIA } from "@/config/fontes-noticias";
import { db } from "@/db";
import { assuntosDaMarca, clientes, geracoesIA, noticiasDoAssunto, type AssuntoDaMarca } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as resumirNoticiaIA from "@/ia/prompts/resumirNoticia";
import { registrarGeracao } from "@/ia/registro";
import { logger } from "@/lib/log";
import { tetoDiarioEmReais } from "@/servicos/admin-custos";
import { expirarAssuntosSemUso } from "@/servicos/assuntos";
import {
  casaComAssunto,
  creditoDaFoto,
  desembrulharLink,
  enderecoCanonico,
  enderecoHttpsSeguro,
  imagemDaPagina,
  juntarDuplicatas,
  lerDataDeFeed,
  normalizarTexto,
  primeiraImagemDoHtml,
  termosDoAssunto,
  trechoSemHtml,
  type NoticiaDeFeed,
} from "@/servicos/noticias-assuntos";

import { lerComGuarda } from "./busca-segura";

const DIA_MS = 24 * 60 * 60 * 1000;
/** Notícia mais velha que isto não entra (o assunto é "o que saiu agora"). */
const DIAS_DE_JANELA = 3;
/** Quantos pedaços de uma página se leem para achar o `og:image` (a meta está no começo do HTML). */
const BYTES_DA_PAGINA = 200_000;
/** O teto de um feed: o maior dos portais curados tem menos de 1 MB. */
const BYTES_DO_FEED = 5_000_000;

type ItemCrú = {
  descricaoCrua?: string;
  conteudoCodificado?: string;
  midia?: { $?: { url?: string } }[];
  mediaurl?: string;
};

const parser = new Parser<Record<string, never>, ItemCrú>({
  customFields: {
    item: [
      ["description", "descricaoCrua"],
      ["content:encoded", "conteudoCodificado"],
      ["media:content", "midia", { keepArray: true }],
      ["mediaurl", "mediaurl"],
    ],
  },
});

/** Decodifica os bytes de um feed pela codificação que ele mesmo declara (a Folha e a UOL ainda usam ISO-8859-1); na dúvida, UTF-8. */
export function decodificarFeed(bytes: Uint8Array): string {
  const cabeca = new TextDecoder("latin1").decode(bytes.slice(0, 200));
  const declarada = /encoding=["']([^"']+)["']/i.exec(cabeca)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(declarada).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Um feed, pelo transporte seguro: só os domínios dos veículos curados e o Google News, com teto de 5 MB. */
export async function baixarFeed(url: string): Promise<string> {
  const { bytes } = await lerComGuarda(url, {
    aceita: "application/rss+xml, application/xml, text/xml, */*",
    limiteBytes: BYTES_DO_FEED,
    tempoMs: 15_000,
    hostPermitido: (h) => h === HOST_DO_GOOGLE_NEWS || hostEhDeVeiculoCurado(h),
  });
  return decodificarFeed(bytes);
}

/** Um `baixarFeed` que lembra a resposta de cada endereço, inclusive a falha, enquanto durar a rodada: o mesmo feed não é baixado duas vezes (nem espera o prazo de novo quando não responde). */
export function baixarFeedUmaVezPorRodada(baixar: (url: string) => Promise<string> = baixarFeed): (url: string) => Promise<string> {
  const lembrados = new Map<string, Promise<string>>();
  return (url) => {
    let feed = lembrados.get(url);
    if (!feed) {
      feed = baixar(url);
      lembrados.set(url, feed);
    }
    return feed;
  };
}

/** O `og:image` de uma página, lendo só o começo dela; nulo se a página não responder ou não tiver. */
export async function baixarFotoDaPagina(url: string): Promise<string | null> {
  try {
    const { bytes } = await lerComGuarda(url, { aceita: "text/html", limiteBytes: BYTES_DA_PAGINA, tempoMs: 8_000, hostPermitido: hostEhDeVeiculoCurado });
    return imagemDaPagina(new TextDecoder("utf-8").decode(bytes));
  } catch {
    return null;
  }
}

export function urlDoGoogleNews(termo: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(termo)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}

/** Os itens de um feed viram notícias normalizadas. O veículo vem da lista curada; no Google News vem do fim do título ("Manchete - Veículo"). */
export async function noticiasDoFeed(xml: string, veiculo: string | null, origem: "rss" | "google"): Promise<NoticiaDeFeed[]> {
  const feed = await parser.parseString(xml);
  const saida: NoticiaDeFeed[] = [];
  for (const item of feed.items) {
    let titulo = (item.title ?? "").trim();
    let nomeDoVeiculo = veiculo ?? "";
    if (origem === "google") {
      const partes = titulo.split(" - ");
      if (partes.length > 1) {
        nomeDoVeiculo = partes[partes.length - 1].trim();
        titulo = partes.slice(0, -1).join(" - ").trim();
      }
    }
    // O endereço e a foto vêm de fora: só https, até 2048 caracteres, sem credencial; o que não passa vira nulo (sem endereço válido, a notícia não entra).
    const link = enderecoHttpsSeguro(item.link ? desembrulharLink(item.link) : "") ?? "";
    if (!titulo || !link || !nomeDoVeiculo) continue;
    const imagem = enderecoHttpsSeguro(item.enclosure?.url ?? item.midia?.[0]?.$?.url ?? item.mediaurl ?? primeiraImagemDoHtml(item.descricaoCrua) ?? primeiraImagemDoHtml(item.conteudoCodificado));
    saida.push({
      titulo: titulo.slice(0, 300),
      veiculo: nomeDoVeiculo.slice(0, 80),
      url: link,
      publicadoEm: lerDataDeFeed(item.isoDate ?? item.pubDate),
      imagemUrl: imagem,
      // O trecho que o próprio feed oferece, só para o resumo nosso: o Google News não traz nada útil aqui.
      trecho: origem === "google" ? "" : trechoSemHtml(item.contentSnippet ?? item.descricaoCrua),
      origem,
    });
  }
  return saida;
}

export type ResumoColetaAssuntos = {
  assuntos: number;
  expirados: number;
  feedsLidos: number;
  noticiasNovas: number;
  resumos: number;
  fotosDePagina: number;
  semFoto: number;
  /** Os feeds ou termos que não responderam (o veículo some só desta coleta). */
  falhas?: string[];
  /** Por que o job parou de resumir antes do fim (o gasto de IA do dia passou do teto), quando parou. */
  paradoPor?: string;
  /** Quantas notícias não entraram porque o teto de resumos da marca no dia já tinha acabado. */
  semResumoPeloTeto?: number;
};

type Dependencias = {
  agora?: Date;
  baixar?: (url: string) => Promise<string>;
  buscarPagina?: (url: string) => Promise<string | null>;
  /** O gasto de IA de hoje e o teto diário, em reais (testes trocam; sem isto, lê do banco). */
  gastoDoDiaBrl?: () => Promise<number>;
  tetoDiarioBrl?: () => Promise<number>;
};

async function gastoDeIADeHojeEmReais(inicioDoDia: Date): Promise<number> {
  const [linha] = await db()
    .select({ total: sql<string>`coalesce(sum(${geracoesIA.custoUsd}), 0)` })
    .from(geracoesIA)
    .where(gte(geracoesIA.criadoEm, inicioDoDia));
  return usdParaBrl(Number(linha?.total ?? 0));
}

async function resumirOuNulo(noticia: NoticiaDeFeed, assunto: AssuntoDaMarca): Promise<string | null> {
  try {
    const resultado = await gerarEstruturado({
      tarefa: "resumirNoticia",
      nivel: resumirNoticiaIA.nivel,
      effort: resumirNoticiaIA.esforco,
      schema: resumirNoticiaIA.schema,
      sistemaEstavel: resumirNoticiaIA.montarSistemaEstavel(),
      entrada: resumirNoticiaIA.montarEntrada({ titulo: noticia.titulo, veiculo: noticia.veiculo, trecho: noticia.trecho }),
    });
    await registrarGeracao({
      tarefa: "resumirNoticia",
      versaoPrompt: resumirNoticiaIA.versao,
      modelo: resultado.modelo,
      nivel: resumirNoticiaIA.nivel,
      clienteId: assunto.clienteId,
      entradas: { assuntoId: assunto.id },
      saida: resultado.dados,
      uso: {
        tokensEntrada: resultado.tokensEntrada,
        tokensSaida: resultado.tokensSaida,
        tokensCacheLeitura: resultado.tokensCacheLeitura,
        tokensCacheEscrita: resultado.tokensCacheEscrita,
      },
    });
    return resultado.dados.resumo;
  } catch (erro) {
    logger.warn({ err: erro, assuntoId: assunto.id }, "nao foi possivel resumir a noticia do assunto");
    return null;
  }
}

export async function coletarNoticiasDosAssuntos(deps: Dependencias = {}): Promise<ResumoColetaAssuntos> {
  const agora = deps.agora ?? new Date();
  const baixar = deps.baixar ?? baixarFeed;
  const buscarPagina = deps.buscarPagina ?? baixarFotoDaPagina;

  const expirados = await expirarAssuntosSemUso(agora);
  const ativos = await db()
    .select({ assunto: assuntosDaMarca })
    .from(assuntosDaMarca)
    .innerJoin(clientes, eq(clientes.id, assuntosDaMarca.clienteId))
    .where(and(eq(assuntosDaMarca.ativo, true), eq(clientes.ativo, true)));
  const resumo: ResumoColetaAssuntos = { assuntos: ativos.length, expirados, feedsLidos: 0, noticiasNovas: 0, resumos: 0, fotosDePagina: 0, semFoto: 0 };
  if (ativos.length === 0) return resumo;

  const falhas: string[] = [];

  // Cada feed dos portais é baixado uma vez, para todos os assuntos.
  const dosPortais: NoticiaDeFeed[] = [];
  for (const fonte of FONTES_DE_NOTICIAS) {
    for (const feed of fonte.feeds) {
      try {
        dosPortais.push(...(await noticiasDoFeed(await baixar(feed.url), fonte.veiculo, "rss")));
        resumo.feedsLidos += 1;
      } catch (erro) {
        falhas.push(`${fonte.veiculo} (${feed.secao}): ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    }
  }

  const desde = new Date(agora.getTime() - DIAS_DE_JANELA * DIA_MS);
  const inicioDoDia = new Date(agora);
  inicioDoDia.setHours(0, 0, 0, 0);
  const gastoDoDia = deps.gastoDoDiaBrl ?? (() => gastoDeIADeHojeEmReais(inicioDoDia));
  const teto = await (deps.tetoDiarioBrl ?? tetoDiarioEmReais)();
  const passouDoTeto = async () => (await gastoDoDia()) >= teto;

  for (const { assunto } of ativos) {
    if (resumo.paradoPor) break;
    try {
      const termos = termosDoAssunto(assunto.texto, assunto.termos);
      const candidatas: NoticiaDeFeed[] = dosPortais.filter((n) => casaComAssunto(`${n.titulo} ${n.trecho}`, termos));
      // O Google News fecha o buraco: uma busca pelo texto do assunto e pelo primeiro termo extra.
      for (const termo of [...new Set([assunto.texto, assunto.termos[0]].filter((t): t is string => Boolean(t)))]) {
        try {
          candidatas.push(...(await noticiasDoFeed(await baixar(urlDoGoogleNews(termo)), null, "google")));
        } catch (erro) {
          falhas.push(`Google News "${termo}": ${erro instanceof Error ? erro.message : String(erro)}`);
        }
      }

      const recentes = juntarDuplicatas(candidatas)
        .filter((n) => !n.publicadoEm || n.publicadoEm >= desde)
        .sort((a, b) => (b.publicadoEm?.getTime() ?? 0) - (a.publicadoEm?.getTime() ?? 0));

      // Já guardada = o mesmo endereço, ou a mesma manchete (sem acento nem pontuação) deste assunto: duas rodadas no mesmo dia não repetem.
      const jaGuardadas = await db().select({ url: noticiasDoAssunto.url, titulo: noticiasDoAssunto.titulo }).from(noticiasDoAssunto).where(eq(noticiasDoAssunto.assuntoId, assunto.id));
      const enderecosConhecidos = new Set(jaGuardadas.map((n) => enderecoCanonico(n.url)));
      const titulosConhecidos = new Set(jaGuardadas.map((n) => normalizarTexto(n.titulo)));
      const novas = recentes.filter((n) => !enderecosConhecidos.has(enderecoCanonico(n.url)) && !titulosConhecidos.has(normalizarTexto(n.titulo)));

      // Os tetos do dia contam por marca e pelo TEXTO do assunto (não pelo id): tirar e pôr o mesmo assunto não zera o teto.
      const [{ hojeDoAssunto }] = await db()
        .select({ hojeDoAssunto: sql<number>`count(*)::int` })
        .from(noticiasDoAssunto)
        .innerJoin(assuntosDaMarca, eq(assuntosDaMarca.id, noticiasDoAssunto.assuntoId))
        .where(
          and(
            eq(assuntosDaMarca.clienteId, assunto.clienteId),
            sql`lower(${assuntosDaMarca.texto}) = lower(${assunto.texto})`,
            gte(noticiasDoAssunto.coletadoEm, inicioDoDia),
          ),
        );
      const aGuardar = novas.slice(0, Math.max(0, LIMITE_NOVAS_POR_ASSUNTO_POR_DIA - hojeDoAssunto));

      let fotosBuscadas = 0;
      for (const noticia of aGuardar) {
        try {
          const [{ hojeDaMarca }] = await db()
            .select({ hojeDaMarca: sql<number>`count(*)::int` })
            .from(noticiasDoAssunto)
            .innerJoin(assuntosDaMarca, eq(assuntosDaMarca.id, noticiasDoAssunto.assuntoId))
            .where(and(eq(assuntosDaMarca.clienteId, assunto.clienteId), gte(noticiasDoAssunto.coletadoEm, inicioDoDia)));
          if (hojeDaMarca >= LIMITE_DE_RESUMOS_POR_MARCA_POR_DIA) {
            resumo.semResumoPeloTeto = (resumo.semResumoPeloTeto ?? 0) + 1;
            continue;
          }
          if (await passouDoTeto()) {
            resumo.paradoPor = `o gasto de IA de hoje passou do teto diário (R$ ${teto.toFixed(2)}); as notícias que faltam ficam para amanhã`;
            break;
          }
          if (!noticia.imagemUrl && noticia.origem === "rss" && fotosBuscadas < LIMITE_FOTOS_DE_PAGINA_POR_ASSUNTO_POR_DIA) {
            fotosBuscadas += 1;
            noticia.imagemUrl = enderecoHttpsSeguro(await buscarPagina(noticia.url));
            if (noticia.imagemUrl) resumo.fotosDePagina += 1;
          }
          if (!noticia.imagemUrl) resumo.semFoto += 1;
          const resumoNosso = await resumirOuNulo(noticia, assunto);
          if (resumoNosso) resumo.resumos += 1;
          const gravadas = await db()
            .insert(noticiasDoAssunto)
            .values({
              assuntoId: assunto.id,
              titulo: noticia.titulo,
              veiculo: noticia.veiculo,
              url: noticia.url,
              publicadoEm: noticia.publicadoEm,
              imagemUrl: noticia.imagemUrl,
              imagemCredito: noticia.imagemUrl ? creditoDaFoto(noticia.veiculo) : null,
              resumoNosso,
              origem: noticia.origem,
            })
            .onConflictDoNothing()
            .returning({ id: noticiasDoAssunto.id });
          resumo.noticiasNovas += gravadas.length;
        } catch (erro) {
          // Uma linha ruim não derruba as outras notícias nem as marcas seguintes.
          logger.warn({ err: erro, assuntoId: assunto.id, url: noticia.url }, "nao foi possivel guardar uma noticia do assunto");
          falhas.push(`Notícia de "${assunto.texto}": ${erro instanceof Error ? erro.message : String(erro)}`);
        }
      }
    } catch (erro) {
      logger.warn({ err: erro, assuntoId: assunto.id }, "nao foi possivel coletar o assunto");
      falhas.push(`Assunto "${assunto.texto}": ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  if (falhas.length > 0) resumo.falhas = falhas;
  return resumo;
}
