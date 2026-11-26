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
import { and, desc, eq, gte, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { briefings, clientes, contas, videos } from "@/db/schema";
import { palavrasDeConteudo } from "@/ia/verificador";
import { hojeISO } from "@/lib/config";
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

/**
 * O que promete resultado ou cura, em TODOS os ramos (a pessoa cola a hashtag no post dela). "antes e depois" pode (é do trabalho, não é promessa); estas não. Procuradas dentro da hashtag, sem
 * acento, por radical e de propósito largas: "melhor" barra #melhordentista; "cura" também barra #pedicura e #procura (perder uma hashtag é melhor que prometer o que não dá).
 */
const PROMESSA = [
  "garantid", "garantia", "perfeit", "milagr", "cura", "curar", "curei", "curou", "definitiv", "semdor", "semrisco", "100porcento", "resultadoimediato", "emagrec", "eliminar", "tratamentoimediato", "efeitoimediato",
  "melhor", "indolor", "semcirurgia", "promocao", "gratis", "gratuit", "desconto",
];

/**
 * T114 (ensaio de 26/11/2026): gênero de humor e de entretenimento. Num ramo em que viraliza vídeo de humor, a hashtag diz o jeito do vídeo de OUTRA pessoa, não o serviço da marca (o roteiro de
 * dentista saiu com "#comedia #humor #dentista"). Só entra quando a própria marca fala com humor (`marcaFalaComHumor`). Procuradas dentro da hashtag, sem acento, por radical: "humor" barra
 * #humordentista e #bomhumor; "meme" barra #memes. Lista nossa e curta; crescer aqui é barato.
 */
const GENERO_DE_HUMOR = [
  "humor", "comedi", "comico", "comica", "piada", "zoeira", "zueira", "zuera", "engracad", "risada", "kkk", "meme", "entretenimento", "pegadinha", "standup", "esquete", "parodia", "besteirol",
];

export function hashtagDeHumor(chave: string): boolean {
  return GENERO_DE_HUMOR.some((g) => chave.includes(g));
}

/** O tom de humor dito pela marca: "brincalhão" (a palavra da pergunta do tom), "engraçado", "humor", "comédia", "piada", "zoeira". "Bom humor" e "mau humor" são de ânimo, não de tom. */
const TOM_DE_HUMOR = /(?<!\b(?:bom|mau|mal) )\bhumor|\bbrincalh|\bengracad|\bcomedi|\bcomic[oa]s?\b|\bpiadas?\b|\bzoeira|\bzueira|\bzuera/g;
const NEGA_O_TOM = new Set(["nao", "nunca", "sem", "nada", "nenhum", "nenhuma", "jamais", "evito", "evita", "evitar"]);

/**
 * A marca fala com humor? Lê o que ela mesma escreveu sobre o jeito de falar (a resposta da pergunta das frases e do tom, e o resumo do perfil compilado). Uma palavra de humor logo depois de uma
 * negação ("nunca faço piada", "sem humor") não conta.
 */
export function marcaFalaComHumor(textos: (string | null | undefined)[]): boolean {
  const baixo = textos.filter((t): t is string => Boolean(t)).join(". ").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  for (const m of baixo.matchAll(TOM_DE_HUMOR)) {
    const antes = baixo.slice(0, m.index ?? 0).split(/[.!?;\n]/).pop() ?? "";
    const palavras = antes.split(/[^a-z]+/).filter(Boolean).slice(-3);
    if (!palavras.some((p) => NEGA_O_TOM.has(p))) return true;
  }
  return false;
}

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

  lista.forEach((v) => {
    if (v.idioma && v.idioma !== "pt") return;
    const textos = [v.titulo, v.descricao].filter((t): t is string => !!t);
    const frase = legendaSemHashtag(textos.join(" "));
    // Legenda só de hashtags: não há frase para conferir o idioma, então só vale o que o banco marcou como português.
    if (!frase && v.idioma !== "pt") return;
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
      // Vídeo sem conta dona conta para o peso e para o mínimo de vídeos, mas não para o mínimo de contas.
      if (v.contaId != null) a.contas.add(v.contaId);
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
  return PROMESSA.some((p) => chave.includes(p));
}

const SOBRAS_DA_REGIAO = new Set(["e", "de", "da", "do", "das", "dos", "regiao", "grande", "arredores", "cidade", "interior"]);

/** As chaves que valem como "a cidade inteira": o nome todo e o nome sem "região"/"grande" e afins, sem acento nem espaço ("São Paulo" vira "saopaulo", "Campinas e região" vira "campinas"). */
export function chavesDaCidade(nome: string | null | undefined): string[] {
  const palavras = (nome ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const nucleo = palavras.filter((p) => !SOBRAS_DA_REGIAO.has(p)).join("");
  return [...new Set([palavras.join(""), nucleo].filter((c) => c.length >= 4))];
}

/** Fora a hashtag que é o nome ou o usuário de uma conta do banco (marca de concorrente ou de rede de franquia): comparada sem acento e sem espaço. */
export function tirarNomesDeConta(candidatas: CandidatoDeHashtag[], nomesDeConta: Set<string>): CandidatoDeHashtag[] {
  return candidatas.filter((c) => !nomesDeConta.has(c.chave));
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
  /** O mesmo, em nomes separados (a cidade e a região da marca); vale no lugar de `regiao` quando vem. */
  cidades?: (string | null | undefined)[];
  /** Sem efeito desde 25/11/2026: o filtro de promessa vale em todos os ramos. Fica só para quem ainda passa o campo. */
  ramoSaude?: boolean;
  /** A marca fala com humor (`marcaFalaComHumor`): só então a hashtag de gênero de humor ou de entretenimento entra (T114). Ausente vale não. */
  humorDaMarca?: boolean;
  maximo?: number;
};

/**
 * Escolhe até 5 (puro): uma da região quando a marca vende local e há hashtag da cidade nos dados; até duas do assunto do tema; o resto, as de
 * maior peso do ramo (duas ou três, quando há assunto e região). Uma hashtag entra só com 2 vídeos de 2 contas (a da região vale com 1, porque
 * é a cidade da própria marca). Em todos os ramos, nenhuma que prometa resultado, e nenhuma de humor ou entretenimento quando a marca não fala com humor.
 */
export function escolherHashtags(candidatas: CandidatoDeHashtag[], opcoes: OpcoesDeEscolha = {}): string[] {
  const maximo = Math.min(opcoes.maximo ?? MAXIMO_DE_HASHTAGS, MAXIMO_DE_HASHTAGS);
  const permitidas = candidatas.filter((c) => !prometeResultado(c.chave) && (opcoes.humorDaMarca === true || !hashtagDeHumor(c.chave)));
  const porPeso = (a: CandidatoDeHashtag, b: CandidatoDeHashtag) => b.peso - a.peso || b.videos - a.videos || a.chave.localeCompare(b.chave);
  const solidas = permitidas.filter((c) => c.videos >= MINIMO_DE_VIDEOS && c.contas >= MINIMO_DE_CONTAS).sort(porPeso);

  const escolhidas: CandidatoDeHashtag[] = [];
  const jaTem = (c: CandidatoDeHashtag) => escolhidas.some((e) => e.chave === c.chave);

  // A cidade: só a hashtag que é o nome inteiro da cidade (ou da região), normalizado, e com a mesma régua das outras (2 vídeos de 2 contas). Nunca um pedaço: "natal" não casa com "natal2026".
  const nomesDaCidade = new Set((opcoes.cidades ?? [opcoes.regiao]).flatMap((n) => chavesDaCidade(n)));
  const daRegiao: CandidatoDeHashtag | undefined = nomesDaCidade.size > 0 ? solidas.filter((c) => nomesDaCidade.has(c.chave)).sort(porPeso)[0] : undefined;

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
  // O dia de São Paulo (o servidor roda em UTC): a virada do cache é à meia-noite daqui.
  return hojeISO();
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

  const donos = await db().select({ handle: contas.handle, nome: contas.nome }).from(contas);
  const nomesDeConta = new Set(donos.flatMap((c) => [semAcentoNemSimbolo(c.handle), semAcentoNemSimbolo(c.nome ?? "")]).filter((n) => n.length >= 3));
  const candidatas = tirarNomesDeConta(candidatasDosVideos(linhas.map((l) => ({ ...l, foraDaCurva: Number(l.foraDaCurva) }))), nomesDeConta);
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

    const candidatas = await candidatasDosSetores(setores);
    if (candidatas.length === 0) return [];
    const cidades = marca.alcance === "local" ? [marca.cidade, marca.regiao] : [];
    const [briefing] = await db().select({ respostas: briefings.respostas, perfil: briefings.perfil }).from(briefings).where(eq(briefings.clienteId, args.clienteId));
    const humorDaMarca = marcaFalaComHumor([briefing?.respostas?.p9, briefing?.perfil?.resumo]);
    return escolherHashtags(candidatas, { tema: args.tema, cidades, humorDaMarca });
  } catch (erro) {
    logger.warn({ err: erro, clienteId: args.clienteId }, "hashtags-do-post: nao foi possivel escolher as hashtags");
    return [];
  }
}
