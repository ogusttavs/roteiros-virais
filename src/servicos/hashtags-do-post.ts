/**
 * E70, as hashtags do post (pedido do Gustavo em 25/11/2026). O Instagram limita a 5 hashtags por post e por Reels desde dezembro de 2025, e o
 * Gustavo quer que todo roteiro (e todo carrossel) traga as recomendadas, para a pessoa colar. Sem IA: a escolha é por código, em cima do que o
 * banco já guarda.
 *
 * De onde vem: as legendas (o `titulo` de um vídeo do Instagram ou do TikTok é a legenda inteira, e a `descricao` completa) dos vídeos do ramo
 * da marca (o principal e os alternativos, cada um com o piso de views do próprio ramo) que passaram do piso e da régua relativa à conta
 * (`LIMIAR_FORA_DA_CURVA`), dos últimos 90 dias. Cada vídeo vale a nota de fora da curva (com teto) vezes a recência (os últimos 30 dias valem
 * o dobro dos 31 a 90); cada hashtag soma o valor dos vídeos distintos em que aparece.
 *
 * Contraponto registrado no plano: o Instagram diz que hashtag ajuda a achar o post na busca e não aumenta o alcance, e a mais usada é a mais
 * genérica. Por isso não é "as mais populares": é "as que mais aparecem nos vídeos que foram fora da curva neste ramo", com as vazias ("viral",
 * "fyp") fora, e uma hashtag só entra se aparece em 2 vídeos de 2 contas (uma conta repetindo a própria hashtag de marca não vale). Sem dados
 * suficientes devolve menos, ou nenhuma, em vez de inventar.
 *
 * O carrossel chama a mesma função: `hashtagsDoPost({ clienteId, tema })`.
 */
import { and, desc, eq, gte, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";

import { ramoPorSlug } from "@/config/ramos";
import { db } from "@/db";
import { clientes, nichos, videos } from "@/db/schema";
import { palavrasDeConteudo } from "@/ia/verificador";
import { LIMIAR_FORA_DA_CURVA } from "@/lib/formatarNumero";
import { pareceTextoEmPortugues } from "@/lib/idioma";
import { logger } from "@/lib/log";
import { DENTRO_DO_TETO_DE_DURACAO, incluirSeed, PERTENCE_AO_NICHO, setoresComPiso, type SetorDaBusca } from "@/servicos/pesquisa";
import { setoresDaConta } from "@/servicos/ramos-da-conta";

/** O limite do Instagram (anunciado em dezembro de 2025). */
export const MAXIMO_DE_HASHTAGS = 5;

const DIA_MS = 24 * 60 * 60 * 1000;
const JANELA_DIAS = 90;
const RECENTES_DIAS = 30;
const PESO_DOS_RECENTES = 1;
const PESO_DOS_ANTIGOS = 0.5;
/** Um vídeo de 300 vezes a mediana não vale 30 vezes mais que um de 10: o teto evita que um caso só mande na lista. */
const TETO_DA_NOTA = 10;
const MINIMO_DE_VIDEOS = 2;
const MINIMO_DE_CONTAS = 2;
const LINHAS_POR_CONSULTA = 2000;

/** As que não dizem nada do assunto (todo mundo usa), já sem acento e sem símbolo. Lista nossa; crescer aqui é barato. */
const VAZIAS = new Set([
  "viral", "virais", "viralvideo", "viralvideos", "viralreels", "viralizar", "viralizou", "fyp", "fy", "foryou", "foryoupage", "fypage", "fypbrasil", "fypviral", "parati", "paravoce", "pravoce", "paratiiiii", "explore", "explorar",
  "explorepage", "exploremore", "reels", "reel", "reelsinstagram", "reelsbrasil", "reelsvideo", "instagram", "insta", "instagood", "instadaily", "instagram", "instareels", "instagramreels", "tiktok", "tiktokbrasil",
  "tiktokviral", "tiktoker", "tiktokmademebuyit", "trending", "trend", "trends", "trendingreels", "tendencia", "tendencias", "shorts", "short", "youtubeshorts", "youtube", "video", "videos", "videoviral", "brasil", "brazil", "br",
  "follow", "followme", "followforfollow", "like", "likeforlike", "love", "capcut", "edit", "edits", "story", "stories", "post", "posts", "foto", "fotos", "dia", "hoje", "amor", "top", "melhor", "melhores", "novo", "nova", "bomdia",
  "boanoite", "boatarde", "sucesso", "motivacao", "foco", "fe", "deus", "gratidao", "feliz", "vida", "life", "lifestyle",
]);

/** Inglês que aparece sozinho em legenda de português (a checagem de idioma olha a frase, esta olha a palavra solta). */
const EM_INGLES = new Set([
  "cleaning", "tips", "tip", "hack", "hacks", "tutorial", "howto", "beauty", "fitness", "motivation", "business", "entrepreneur", "marketing", "smile", "smiles", "dental", "dentist", "teeth", "health", "healthy", "food",
  "foodie", "style", "fashion", "makeup", "skincare", "workout", "gym", "home", "house", "design", "art", "music", "dance", "funny", "comedy", "memes", "meme", "satisfying", "asmr", "diy", "lifehack", "lifehacks", "clean",
  "cleantok", "cleaningtiktok", "cleaningmotivation", "dentalcare", "dentistry", "oralhealth", "braces", "whitening", "smilemakeover", "cosmeticdentistry", "beforeandafter", "transformation",
]);

/** Nos ramos de saúde: o que promete resultado ou cura. "antes e depois" pode (é do trabalho, não é promessa); estas não. Procuradas dentro da hashtag, sem acento. */
const PROMESSA_DE_SAUDE = ["garantid", "garantia", "perfeit", "milagr", "cura", "curar", "curei", "curou", "definitiv", "semdor", "semrisco", "100porcento", "resultadoimediato", "emagreca", "eliminar", "tratamentoimediato", "efeitoimediato"];

export type CandidatoDeHashtag = {
  /** A chave de comparação: minúsculas, sem acento (o que se compara). */
  chave: string;
  /** A grafia mais usada, com o "#" na frente (o que se devolve). */
  grafia: string;
  /** A soma do valor dos vídeos distintos em que aparece (nota de fora da curva com teto, vezes a recência). */
  peso: number;
  videos: number;
  contas: number;
};

export type VideoParaHashtags = {
  titulo: string | null;
  descricao: string | null;
  foraDaCurva: number;
  publicadoEm: Date | null;
  contaId: number | null;
  idioma?: string | null;
};

export function semAcentoNemSimbolo(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** As hashtags de um texto, sem o "#" e sem repetir. Só letras e números (o "_" some na comparação, fica na grafia). */
export function hashtagsDoTexto(texto: string | null | undefined): string[] {
  const achadas = (texto ?? "").match(/(?:^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]+)/gu) ?? [];
  const nomes = achadas.map((a) => a.slice(a.indexOf("#") + 1));
  return [...new Set(nomes)];
}

function legendaSemHashtag(texto: string): string {
  return texto.replace(/(^|\s)#[^\s#]+/gu, " ").replace(/\s+/g, " ").trim();
}

function pesoDoVideo(v: VideoParaHashtags, agora: Date): number {
  const nota = Math.min(Math.max(v.foraDaCurva, 0), TETO_DA_NOTA);
  const idadeDias = v.publicadoEm ? (agora.getTime() - v.publicadoEm.getTime()) / DIA_MS : JANELA_DIAS;
  return nota * (idadeDias <= RECENTES_DIAS ? PESO_DOS_RECENTES : PESO_DOS_ANTIGOS);
}

function hashtagUtil(chave: string): boolean {
  if (chave.length < 3 || chave.length > 30) return false;
  if (/^\p{N}+$/u.test(chave)) return false;
  // Só alfabeto latino: japonês, árabe e cirílico não servem a quem grava em português.
  if (/[^\p{Script=Latin}\p{N}]/u.test(chave)) return false;
  return !VAZIAS.has(chave) && !EM_INGLES.has(chave);
}

/**
 * Soma as hashtags dos vídeos (puro, sem banco): vídeo em outro idioma ou com legenda em inglês fica de fora; cada hashtag conta uma vez por
 * vídeo; a grafia devolvida é a mais usada. Quem chama escolhe depois (`escolherHashtags`).
 */
export function candidatasDosVideos(lista: VideoParaHashtags[], agora = new Date()): CandidatoDeHashtag[] {
  type Acumulo = { peso: number; videos: number; contas: Set<number | string>; grafias: Map<string, number> };
  const mapa = new Map<string, Acumulo>();

  lista.forEach((v, indice) => {
    if (v.idioma && v.idioma !== "pt") return;
    const textos = [v.titulo, v.descricao].filter((t): t is string => !!t);
    const frase = legendaSemHashtag(textos.join(" "));
    if (frase && !pareceTextoEmPortugues(frase)) return;
    const peso = pesoDoVideo(v, agora);
    if (peso <= 0) return;
    const grafiasDoVideo = new Map<string, string>();
    for (const nome of textos.flatMap((t) => hashtagsDoTexto(t))) {
      const chave = semAcentoNemSimbolo(nome);
      if (!hashtagUtil(chave) || grafiasDoVideo.has(chave)) continue;
      grafiasDoVideo.set(chave, nome);
    }
    for (const [chave, nome] of grafiasDoVideo) {
      const a = mapa.get(chave) ?? { peso: 0, videos: 0, contas: new Set(), grafias: new Map() };
      a.peso += peso;
      a.videos += 1;
      a.contas.add(v.contaId ?? `video-${indice}`);
      a.grafias.set(nome, (a.grafias.get(nome) ?? 0) + 1);
      mapa.set(chave, a);
    }
  });

  return [...mapa.entries()].map(([chave, a]) => {
    // A grafia mais usada; no empate, a que tem alguma maiúscula ou acento (mais legível) e depois a mais curta.
    const grafia = [...a.grafias.entries()].sort((x, y) => y[1] - x[1] || Number(/[\p{Lu}\p{M}À-ÿ]/u.test(y[0])) - Number(/[\p{Lu}\p{M}À-ÿ]/u.test(x[0])) || x[0].length - y[0].length)[0][0];
    return { chave, grafia: `#${grafia}`, peso: a.peso, videos: a.videos, contas: a.contas.size };
  });
}

function prometeResultado(chave: string): boolean {
  return PROMESSA_DE_SAUDE.some((p) => chave.includes(p));
}

/** O pedaço da palavra do tema que a hashtag precisa conter ("dentes" acha #dente, "clareamento" acha #clareamentodental). */
function radical(palavra: string): string {
  return palavra.length >= 6 ? palavra.slice(0, palavra.length - 1) : palavra;
}

export type OpcoesDeEscolha = {
  /** O tema do roteiro; as palavras de conteúdo dele escolhem as hashtags do assunto. */
  tema?: string;
  /** Uma marca que vende local, com a região ("Campinas e região") ou a cidade, para a hashtag da cidade. Vazio: sem hashtag de região. */
  regiao?: string | null;
  ramoSaude?: boolean;
  maximo?: number;
};

/**
 * Escolhe até 5 (puro): uma da região quando a marca vende local e há hashtag da cidade nos dados; até duas do assunto do tema; o resto, as de
 * maior peso do ramo (duas ou três, quando há assunto e região). Uma hashtag entra só com 2 vídeos de 2 contas (a da região vale com 1, porque
 * é a cidade da própria marca). Nos ramos de saúde, nenhuma que prometa resultado.
 */
export function escolherHashtags(candidatas: CandidatoDeHashtag[], opcoes: OpcoesDeEscolha = {}): string[] {
  const maximo = Math.min(opcoes.maximo ?? MAXIMO_DE_HASHTAGS, MAXIMO_DE_HASHTAGS);
  const permitidas = candidatas.filter((c) => !(opcoes.ramoSaude && prometeResultado(c.chave)));
  const porPeso = (a: CandidatoDeHashtag, b: CandidatoDeHashtag) => b.peso - a.peso || b.videos - a.videos || a.chave.localeCompare(b.chave);
  const solidas = permitidas.filter((c) => c.videos >= MINIMO_DE_VIDEOS && c.contas >= MINIMO_DE_CONTAS).sort(porPeso);

  const escolhidas: CandidatoDeHashtag[] = [];
  const jaTem = (c: CandidatoDeHashtag) => escolhidas.some((e) => e.chave === c.chave);

  // A cidade: as palavras da região sem "regiao", "grande" e afins.
  const palavrasDaRegiao = palavrasDeConteudo(opcoes.regiao ?? "").filter((p) => !["regiao", "grande", "arredores", "cidade", "interior"].includes(p));
  let daRegiao: CandidatoDeHashtag | undefined;
  if (palavrasDaRegiao.length > 0) {
    daRegiao = permitidas
      .filter((c) => c.videos >= 1 && palavrasDaRegiao.some((p) => p.length >= 4 && c.chave.includes(p)))
      .sort(porPeso)[0];
  }

  const palavrasDoTema = palavrasDeConteudo(opcoes.tema ?? "");
  const radicais = palavrasDoTema.map(radical);
  const doAssunto = solidas.filter((c) => radicais.some((r) => c.chave.includes(r)) && !(daRegiao && c.chave === daRegiao.chave)).slice(0, 2);
  for (const c of doAssunto) escolhidas.push(c);

  // O ramo preenche o que sobra, deixando a vaga da região.
  const vagasDoRamo = maximo - escolhidas.length - (daRegiao ? 1 : 0);
  for (const c of solidas) {
    if (escolhidas.length >= maximo - (daRegiao ? 1 : 0)) break;
    if (vagasDoRamo <= 0) break;
    if (!jaTem(c) && !(daRegiao && c.chave === daRegiao.chave)) escolhidas.push(c);
  }
  if (daRegiao && escolhidas.length < maximo) escolhidas.push(daRegiao);

  // Ordem na tela: as do ramo (maior peso) primeiro, depois as do assunto e a da cidade.
  const doTema = new Set(doAssunto.map((c) => c.chave));
  const ordenadas = [...escolhidas.filter((c) => !doTema.has(c.chave) && c !== daRegiao), ...escolhidas.filter((c) => doTema.has(c.chave)), ...(daRegiao ? [daRegiao] : [])];
  return ordenadas.slice(0, maximo).map((c) => c.grafia);
}

/** A condição "do ramo X com o piso de X" para os ramos da marca (o principal e os alternativos). */
function condicaoDosSetores(setores: SetorDaBusca[]): SQL {
  const partes = setores.map((s) => and(eq(videos.nichoId, s.id), gte(videos.views, s.pisoViews)));
  return or(...partes) ?? sql`false`;
}

type CacheDoRamo = { dia: string; candidatas: CandidatoDeHashtag[] };
const cache = new Map<string, CacheDoRamo>();

/** Para os testes: o cache é por ramo e dia, e um teste que troca os vídeos precisa começar limpo. */
export function limparCacheDeHashtags(): void {
  cache.clear();
}

function diaDeHoje(): string {
  return new Date().toISOString().slice(0, 10);
}

async function candidatasDosSetores(setores: SetorDaBusca[]): Promise<CandidatoDeHashtag[]> {
  const chave = setores.map((s) => `${s.id}:${s.pisoViews}`).sort().join("|");
  const dia = diaDeHoje();
  const guardado = cache.get(chave);
  if (guardado && guardado.dia === dia) return guardado.candidatas;

  const desde = new Date(Date.now() - JANELA_DIAS * DIA_MS);
  const condicoes: SQL[] = [
    condicaoDosSetores(setores),
    gte(videos.publicadoEm, desde),
    isNotNull(videos.foraDaCurva),
    gte(videos.foraDaCurva, String(LIMIAR_FORA_DA_CURVA)),
    sql`(${videos.titulo} like '%#%' or ${videos.descricao} like '%#%')`,
    PERTENCE_AO_NICHO,
    DENTRO_DO_TETO_DE_DURACAO,
  ];
  if (!incluirSeed()) condicoes.push(ne(videos.origem, "seed"));

  const linhas = await db()
    .select({ titulo: videos.titulo, descricao: videos.descricao, foraDaCurva: videos.foraDaCurva, publicadoEm: videos.publicadoEm, contaId: videos.contaId, idioma: videos.idioma })
    .from(videos)
    .where(and(...condicoes))
    .orderBy(desc(videos.foraDaCurva))
    .limit(LINHAS_POR_CONSULTA);

  const candidatas = candidatasDosVideos(linhas.map((l) => ({ ...l, foraDaCurva: Number(l.foraDaCurva) })));
  cache.set(chave, { dia, candidatas });
  return candidatas;
}

/**
 * As até 5 hashtags para a pessoa colar no post deste roteiro (ou carrossel). Só vídeos dos ramos da marca (isolamento). Nunca lança: qualquer
 * falha vira lista vazia e o bloco simplesmente não aparece.
 */
export async function hashtagsDoPost(args: { clienteId: number; tema: string }): Promise<string[]> {
  try {
    const [marca] = await db()
      .select({ nichoId: clientes.nichoId, alcance: clientes.alcance, regiao: clientes.regiao, cidade: clientes.cidade })
      .from(clientes)
      .where(eq(clientes.id, args.clienteId));
    if (!marca) return [];

    const ids = await setoresDaConta(args.clienteId, marca.nichoId);
    if (ids.length === 0) return [];
    const setores = await setoresComPiso(ids);

    const donos = await db().select({ id: nichos.id, ramoCatalogo: nichos.ramoCatalogo }).from(nichos).where(inArray(nichos.id, ids));
    const ramoSaude = donos.some((n) => ramoPorSlug(n.ramoCatalogo)?.grupo === "saude");

    const candidatas = await candidatasDosSetores(setores);
    if (candidatas.length === 0) return [];
    const regiao = marca.alcance === "local" ? [marca.regiao, marca.cidade].filter(Boolean).join(" ") : null;
    return escolherHashtags(candidatas, { tema: args.tema, regiao, ramoSaude });
  } catch (erro) {
    logger.warn({ err: erro, clienteId: args.clienteId }, "hashtags-do-post: nao foi possivel escolher as hashtags");
    return [];
  }
}
