/**
 * E56 PR 2: publicar um post pronto (1 imagem ou carrossel de 2 a 10) no Instagram da própria marca, pela conta que ela ligou (E19), com uma fila que publica um por vez. Atrás da chave
 * `PUBLICAR_IMAGENS_ATIVO` (desligada por padrão). Segue as regras de `servicos/publicar-instagram.ts` (E56 PR 1), que valem aqui e têm teste:
 *  - Só o DONO da marca monta, põe na fila, cancela e repete (`ehDonoDaMarca`); o "ver como" nunca (as ações e a rota conferem antes). A marca vem da sessão: toda leitura e gravação filtra por ela.
 *  - O acesso da Meta (token) só sai decifrado por `contaParaPublicar` e nunca vai para log, retorno, erro nem banco. As frases de falha são as de `textos/post-pronto.ts`.
 *  - Publicar é uma vez só: a reserva `na_fila` para `publicando` é um UPDATE condicional, e o índice único `posts_prontos_um_publicando_por_marca` segura dois ao mesmo tempo. Quando não dá para saber se a
 *    Meta publicou (a resposta se perdeu), o aplicativo NÃO tenta de novo: `nao-confirmou` manda a pessoa conferir o Instagram, e esse post não volta para a fila.
 *  - O limite de publicações por 24 horas é lido da Meta antes de cada post; esgotado, a fila espera e retoma sozinha (o post continua `na_fila`, com o aviso).
 *  - As imagens são conferidas ANTES de o post existir (JPEG ou PNG, proporção de 4:5 a 1,91:1, até 8 MB já em JPEG) e ficam em disco só até o post terminar (`lib/imagens-do-post.ts`).
 */
import { and, asc, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";

import { intervaloEntrePostsMin, LIMITES_DO_POST_PRONTO, ESPERA_ENTRE_CONFERENCIAS_DA_IMAGEM_MS, POST_PUBLICANDO_PARADO_APOS_MS, PREPARO_DA_IMAGEM_PRAZO_MS, publicarImagensAtivo } from "@/config/post-pronto";
import { LIMITE_DE_PUBLICACOES_PADRAO } from "@/config/publicacao";
import { db } from "@/db";
import { postsProntos, type EstadoDoPostPronto, type ImagemDoPost, type PostPronto } from "@/db/schema";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { apagarImagensDoPost, enderecoPublicoDaImagem, ErroDeImagem, guardarImagensDoPost, postsComPastaEmDisco, prepararImagem, tamanhoDaImagemGuardada, nomeDaImagem } from "@/lib/imagens-do-post";
import { problemaDaLegenda } from "@/lib/legenda-do-instagram";
import { logger } from "@/lib/log";
import { criarContainerDeCarrossel, criarContainerDeImagem, enderecoDaMidia, publicarContainer, statusDoContainer, usoDoLimite } from "@/lib/meta-publicar";
import { contaParaPublicar, ehDonoDaMarca, erroDaContaPara, registrarErroDaConta } from "@/servicos/conta-conectada";
import { classificarFalha, publicacaoIncerta, situacaoDaPublicacao, type Falha } from "@/servicos/publicar-instagram";
import { fraseDeFalhaDoPost, fraseDeRecusaDoPost, textosPostPronto, type CodigoDeFalhaDoPost, type CodigoDeRecusaDoPost } from "@/textos/post-pronto";

export type DepsDoPost = {
  agora?: () => Date;
  /** Quem avisa o worker para publicar este post já (o padrão manda para a fila `publicar-post-pronto`). Os testes trocam. */
  agendar?: (postId: number) => Promise<void>;
  /** A espera entre as perguntas à Meta (os testes não esperam). */
  esperar?: (ms: number) => Promise<void>;
};

const relogio = (deps: DepsDoPost): Date => (deps.agora ? deps.agora() : new Date());

async function agendarNaFila(postId: number): Promise<void> {
  await garantirBossPronto();
  await boss().send(FILAS.publicarPostPronto, { postId });
}

const esperarDeVerdade = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

// ---------------------------------------------------------------------------
// O que a tela pode saber
// ---------------------------------------------------------------------------

export type SituacaoDoPost = { pode: true; conta: string } | { pode: false; codigo: CodigoDeRecusaDoPost; frase: string };

/** A marca pode publicar um post pronto agora? Só olha o que está guardado (sem chamar a Meta). Chave fechada: `fechada`. */
export async function situacaoDoPostPronto(usuarioId: string, clienteId: number, agora: Date = new Date()): Promise<SituacaoDoPost> {
  if (!publicarImagensAtivo()) return { pode: false, codigo: "fechada", frase: fraseDeRecusaDoPost("fechada") };
  const situacao = await situacaoDaPublicacao(usuarioId, clienteId, agora);
  if (situacao.pode) return situacao;
  const codigo = situacao.codigo as CodigoDeRecusaDoPost;
  return { pode: false, codigo, frase: fraseDeRecusaDoPost(codigo) };
}

export type VistaDoPost = {
  id: number;
  estado: EstadoDoPostPronto;
  legenda: string;
  imagens: number;
  motivo: string | null;
  aviso: string | null;
  permalink: string | null;
  criadoEm: string;
  podeCancelar: boolean;
  podeRepetir: boolean;
};

/** Falhas depois das quais o post NÃO volta para a fila: não sabemos se saiu (`nao-confirmou`), a imagem sumiu ou a legenda não cabe. */
const FALHAS_SEM_REPETIR: ReadonlySet<string> = new Set<CodigoDeFalhaDoPost>(["nao-confirmou", "imagem-sumiu", "legenda"]);

function vista(p: PostPronto): VistaDoPost {
  return {
    id: p.id,
    estado: p.estado,
    legenda: p.legenda,
    imagens: p.imagens.length,
    motivo: p.estado === "falhou" ? p.motivo : null,
    aviso: p.estado === "na_fila" ? p.aviso : null,
    permalink: p.permalink,
    criadoEm: p.criadoEm.toISOString(),
    podeCancelar: p.estado === "na_fila",
    podeRepetir: p.estado === "falhou" && !FALHAS_SEM_REPETIR.has(p.codigoFalha ?? ""),
  };
}

/** A fila e o histórico recente da marca recebida (nunca de outra): o que está publicando, a fila na ordem de saída, depois o que já terminou, do mais novo ao mais velho. */
export async function listarPostsDaMarca(clienteId: number, limite = 100): Promise<VistaDoPost[]> {
  const linhas = await db().select().from(postsProntos).where(eq(postsProntos.clienteId, clienteId)).orderBy(desc(postsProntos.id)).limit(limite);
  const peso = (e: EstadoDoPostPronto) => (e === "publicando" ? 0 : e === "na_fila" ? 1 : 2);
  return linhas
    .sort((a, b) => peso(a.estado) - peso(b.estado) || (a.estado === "na_fila" ? a.id - b.id : b.id - a.id))
    .map(vista);
}

// ---------------------------------------------------------------------------
// Montar o post
// ---------------------------------------------------------------------------

export type Recusa = { ok: false; codigo: CodigoDeRecusaDoPost; frase: string };
export type ResultadoDeCriar = { ok: true; postId: number } | Recusa;

function recusa(codigo: CodigoDeRecusaDoPost): Recusa {
  return { ok: false, codigo, frase: fraseDeRecusaDoPost(codigo) };
}

export type EntradaDoPost = {
  clienteId: number;
  /** Quem montou (fica no registro). */
  usuarioId: string | null;
  legenda: string;
  /** Os arquivos escolhidos, na ordem. */
  arquivos: Uint8Array[];
  /** `agora`: publica já (a vez dele não espera o intervalo). `fila`: espera a vez. */
  modo: "agora" | "fila";
};

/**
 * Confere as imagens e a legenda, converte para JPEG, grava o post e guarda as imagens em disco. Não confere quem pode (isso é de `criarPostPronto` e do envio em lote do admin). Nada é gravado
 * se uma imagem for recusada.
 */
export async function montarPost(entrada: EntradaDoPost, deps: DepsDoPost = {}): Promise<ResultadoDeCriar> {
  const agora = relogio(deps);
  const { imagensMin, imagensMax, bytesDoPedidoMax } = LIMITES_DO_POST_PRONTO;
  if (entrada.arquivos.length < imagensMin) return recusa("sem-imagem");
  if (entrada.arquivos.length > imagensMax) return recusa("imagens-demais");
  if (entrada.arquivos.reduce((soma, a) => soma + a.byteLength, 0) > bytesDoPedidoMax) return recusa("pedido-grande");
  const legenda = entrada.legenda.trim();
  const problema = problemaDaLegenda(legenda);
  if (problema) return recusa(problema);

  const jpegs: Buffer[] = [];
  const imagens: ImagemDoPost[] = [];
  try {
    for (const arquivo of entrada.arquivos) {
      const pronta = await prepararImagem(arquivo);
      jpegs.push(pronta.jpeg);
      imagens.push({ arquivo: nomeDaImagem(imagens.length), bytes: pronta.jpeg.byteLength, largura: pronta.largura, altura: pronta.altura });
    }
  } catch (erro) {
    if (erro instanceof ErroDeImagem) return recusa(erro.codigo);
    throw erro;
  }

  const [linha] = await db()
    .insert(postsProntos)
    .values({ clienteId: entrada.clienteId, legenda, imagens, agora: entrada.modo === "agora", criadoPor: entrada.usuarioId, criadoEm: agora, atualizadoEm: agora })
    .returning();
  try {
    await guardarImagensDoPost(linha.id, jpegs);
  } catch (erro) {
    await db().delete(postsProntos).where(eq(postsProntos.id, linha.id));
    logger.error({ err: erro, clienteId: entrada.clienteId }, "post pronto: nao foi possivel guardar as imagens");
    throw erro;
  }
  return { ok: true, postId: linha.id };
}

/** O que a pessoa faz na tela: monta o post e, em "Publicar agora", avisa o worker. Só o dono; só com a chave aberta e a conta pronta. */
export async function criarPostPronto(entrada: EntradaDoPost & { usuarioId: string }, deps: DepsDoPost = {}): Promise<ResultadoDeCriar> {
  const agora = relogio(deps);
  if (!publicarImagensAtivo()) return recusa("fechada");
  if (!(await ehDonoDaMarca(entrada.usuarioId, entrada.clienteId))) return recusa("so-dono");
  const situacao = await situacaoDoPostPronto(entrada.usuarioId, entrada.clienteId, agora);
  if (!situacao.pode) return recusa(situacao.codigo);

  const resultado = await montarPost(entrada, deps);
  if (resultado.ok && entrada.modo === "agora") {
    try {
      await (deps.agendar ?? agendarNaFila)(resultado.postId);
    } catch (erro) {
      // Sem a fila de eventos, o post continua `na_fila` e sai na próxima rodada da fila (de minuto em minuto).
      logger.warn({ err: erro, postId: resultado.postId }, "post pronto: nao foi possivel avisar o worker");
    }
  }
  return resultado;
}

export type ResultadoDaMudanca = { ok: true; vista: VistaDoPost } | Recusa;

/** "Tirar da fila": só o dono, só um post da marca que ainda espera a vez. Um que já está sendo publicado não cancela. */
export async function cancelarPostPronto(usuarioId: string, clienteId: number, postId: number, agora: Date = new Date()): Promise<ResultadoDaMudanca> {
  if (!(await ehDonoDaMarca(usuarioId, clienteId))) return recusa("so-dono");
  const [cancelado] = await db()
    .update(postsProntos)
    .set({ estado: "cancelado", aviso: null, terminadoEm: agora, atualizadoEm: agora })
    .where(and(eq(postsProntos.id, postId), eq(postsProntos.clienteId, clienteId), eq(postsProntos.estado, "na_fila")))
    .returning();
  if (cancelado) {
    await apagarImagensDoPost(cancelado.id);
    return { ok: true, vista: vista(cancelado) };
  }
  const [atual] = await db().select().from(postsProntos).where(and(eq(postsProntos.id, postId), eq(postsProntos.clienteId, clienteId)));
  if (!atual) return recusa("nao-achou");
  return recusa(atual.estado === "publicando" ? "nao-da-para-cancelar" : "nao-achou");
}

/** "Pôr na fila de novo": só um post que falhou por um motivo em que sabemos que nada saiu, e cujas imagens ainda estão guardadas. */
export async function repetirPostPronto(usuarioId: string, clienteId: number, postId: number, agora: Date = new Date()): Promise<ResultadoDaMudanca> {
  if (!(await ehDonoDaMarca(usuarioId, clienteId))) return recusa("so-dono");
  const [atual] = await db().select().from(postsProntos).where(and(eq(postsProntos.id, postId), eq(postsProntos.clienteId, clienteId)));
  if (!atual) return recusa("nao-achou");
  if (!vista(atual).podeRepetir) return recusa("nao-da-para-repetir");
  for (let i = 0; i < atual.imagens.length; i++) if ((await tamanhoDaImagemGuardada(atual.id, i)) === null) return recusa("nao-da-para-repetir");
  const [volta] = await db()
    .update(postsProntos)
    .set({ estado: "na_fila", motivo: null, codigoFalha: null, codigoMeta: null, subcodigoMeta: null, containerId: null, aviso: null, agora: false, terminadoEm: null, atualizadoEm: agora })
    .where(and(eq(postsProntos.id, postId), eq(postsProntos.clienteId, clienteId), eq(postsProntos.estado, "falhou")))
    .returning();
  return volta ? { ok: true, vista: vista(volta) } : recusa("nao-da-para-repetir");
}

// ---------------------------------------------------------------------------
// Publicar (o worker)
// ---------------------------------------------------------------------------

const PARA_FALHA_DO_POST: Record<string, CodigoDeFalhaDoPost> = {
  formato: "formato",
  "nao-preparou": "nao-preparou",
  "limite-do-dia": "limite-do-dia",
  "conta-restrita": "conta-restrita",
  barrada: "barrada",
  legenda: "legenda",
  "acesso-perdido": "acesso-perdido",
  "sem-permissao": "sem-permissao",
  esperar: "esperar",
  "sem-resposta": "sem-resposta",
  demorou: "demorou",
  "nao-confirmou": "nao-confirmou",
};

function falhaDoPost(falha: Falha): { codigo: CodigoDeFalhaDoPost; codigoMeta?: number; subcodigoMeta?: number } {
  return { codigo: PARA_FALHA_DO_POST[falha.codigo] ?? "sem-resposta", codigoMeta: falha.codigoMeta, subcodigoMeta: falha.subcodigoMeta };
}

/** Passa o post a `falhou` com a frase. Só sai de `publicando` ou `na_fila`. As imagens somem quando não há como repetir; senão ficam para a pessoa pôr na fila de novo. */
async function falhar(post: Pick<PostPronto, "id">, falha: { codigo: CodigoDeFalhaDoPost; codigoMeta?: number; subcodigoMeta?: number }, agora: Date): Promise<void> {
  await db()
    .update(postsProntos)
    .set({ estado: "falhou", motivo: fraseDeFalhaDoPost(falha.codigo), codigoFalha: falha.codigo, codigoMeta: falha.codigoMeta ?? null, subcodigoMeta: falha.subcodigoMeta ?? null, aviso: null, terminadoEm: agora, atualizadoEm: agora })
    .where(and(eq(postsProntos.id, post.id), inArray(postsProntos.estado, ["publicando", "na_fila"])));
  if (FALHAS_SEM_REPETIR.has(falha.codigo)) await apagarImagensDoPost(post.id);
}

async function registrarFalhaNaConta(contaId: number, falha: Falha, agora: Date): Promise<void> {
  const frase = erroDaContaPara(falha.codigoMeta);
  if (frase) await registrarErroDaConta(contaId, frase, agora);
}

/** O post volta a esperar (o limite do dia da Meta acabou): fica `na_fila` com o aviso, sem contêiner, e a fila retoma sozinha. */
async function devolverPorLimite(postId: number, agora: Date): Promise<void> {
  await db()
    .update(postsProntos)
    .set({ estado: "na_fila", aviso: textosPostPronto.aviso.limite, containerId: null, atualizadoEm: agora })
    .where(and(eq(postsProntos.id, postId), inArray(postsProntos.estado, ["publicando", "na_fila"])));
}

function ehConflitoDeUnico(erro: unknown): boolean {
  const causa = (erro as { cause?: { code?: string }; code?: string } | null) ?? {};
  return causa.code === "23505" || causa.cause?.code === "23505";
}

export type ResultadoDaPublicacao = "publicado" | "falhou" | "limite" | "ocupada" | "adiado" | "ignorado";

/**
 * Publica UM post da fila: confere a conta e o limite das 24 horas, reserva (só uma publicação por marca por vez), cria os contêineres (um por imagem e, no carrossel, o do carrossel), espera a Meta
 * preparar, publica e guarda o link. Idempotente e segura para dois workers ao mesmo tempo: só quem consegue passar o post de `na_fila` para `publicando` fala com a Meta para publicar.
 */
export async function publicarPost(postId: number, deps: DepsDoPost = {}): Promise<ResultadoDaPublicacao> {
  const agora = relogio(deps);
  const esperar = deps.esperar ?? esperarDeVerdade;
  if (!publicarImagensAtivo()) return "ignorado";
  const [post] = await db().select().from(postsProntos).where(eq(postsProntos.id, postId));
  if (!post || post.estado !== "na_fila") return "ignorado";
  const clienteId = post.clienteId;

  const acesso = await contaParaPublicar(clienteId, agora);
  if ("recusa" in acesso) {
    if (acesso.recusa === "nao-configurada") return "adiado";
    await falhar(post, { codigo: acesso.recusa === "sem-permissao" || acesso.recusa === "sem-conta" ? "sem-permissao" : "acesso-perdido" }, agora);
    return "falhou";
  }
  const { conta } = acesso;

  // O limite do dia, da Meta. Uma falha daqui que não é do acesso não barra: a Meta recusa na hora de publicar, com a frase certa.
  try {
    const uso = await usoDoLimite(conta.igId, conta.token, conta.via);
    if (uso.usadas >= (uso.total ?? LIMITE_DE_PUBLICACOES_PADRAO)) {
      await devolverPorLimite(postId, agora);
      return "limite";
    }
  } catch (erro) {
    const falha = classificarFalha(erro);
    if (falha.codigo === "acesso-perdido") {
      await registrarFalhaNaConta(conta.id, falha, agora);
      await falhar(post, { codigo: "acesso-perdido" }, agora);
      return "falhou";
    }
    logger.warn({ clienteId, codigo: falha.codigoMeta }, "post pronto: nao foi possivel ler o limite do dia");
  }

  // A reserva: só uma passa daqui, e só uma por marca (o índice único).
  try {
    const [reservado] = await db()
      .update(postsProntos)
      .set({ estado: "publicando", aviso: null, atualizadoEm: agora })
      .where(and(eq(postsProntos.id, postId), eq(postsProntos.estado, "na_fila")))
      .returning({ id: postsProntos.id });
    if (!reservado) return "ignorado";
  } catch (erro) {
    if (ehConflitoDeUnico(erro)) return "ocupada";
    throw erro;
  }

  for (let i = 0; i < post.imagens.length; i++) {
    if ((await tamanhoDaImagemGuardada(postId, i)) === null) {
      await falhar(post, { codigo: "imagem-sumiu" }, agora);
      return "falhou";
    }
  }

  // Até aqui nada foi publicado: qualquer recusa da Meta é segura de repetir.
  const recusar = async (erro: unknown): Promise<ResultadoDaPublicacao> => {
    const falha = classificarFalha(erro);
    logger.warn({ clienteId, postId, codigo: falha.codigoMeta, subcodigo: falha.subcodigoMeta }, "post pronto: a Meta recusou");
    await registrarFalhaNaConta(conta.id, falha, agora);
    if (falha.codigo === "limite-do-dia") {
      await devolverPorLimite(postId, agora);
      return "limite";
    }
    await falhar(post, falhaDoPost(falha), agora);
    return "falhou";
  };

  let containerId: string;
  try {
    if (post.imagens.length === 1) {
      ({ containerId } = await criarContainerDeImagem({ igId: conta.igId, token: conta.token, imageUrl: enderecoPublicoDaImagem(postId, 0, agora), legenda: post.legenda, via: conta.via }));
    } else {
      const filhos: string[] = [];
      for (let i = 0; i < post.imagens.length; i++) {
        const filho = await criarContainerDeImagem({ igId: conta.igId, token: conta.token, imageUrl: enderecoPublicoDaImagem(postId, i, agora), itemDeCarrossel: true, via: conta.via });
        filhos.push(filho.containerId);
      }
      ({ containerId } = await criarContainerDeCarrossel({ igId: conta.igId, token: conta.token, filhos, legenda: post.legenda, via: conta.via }));
    }
  } catch (erro) {
    return recusar(erro);
  }
  await db().update(postsProntos).set({ containerId }).where(eq(postsProntos.id, postId));

  // Espera a Meta preparar e publica. O prazo é uma contagem de perguntas (o relógio da fila é outro).
  const rodadas = Math.max(1, Math.ceil(PREPARO_DA_IMAGEM_PRAZO_MS / ESPERA_ENTRE_CONFERENCIAS_DA_IMAGEM_MS));
  for (let rodada = 0; rodada < rodadas; rodada++) {
    if (rodada > 0) {
      await esperar(ESPERA_ENTRE_CONFERENCIAS_DA_IMAGEM_MS);
      // Sinal de vida: o recolhedor (5 minutos) não pode tomar por parado um post que a Meta só está demorando a preparar.
      await db().update(postsProntos).set({ atualizadoEm: relogio(deps) }).where(and(eq(postsProntos.id, postId), eq(postsProntos.estado, "publicando")));
    }
    let status: Awaited<ReturnType<typeof statusDoContainer>>;
    try {
      status = await statusDoContainer(containerId, conta.token, conta.via);
    } catch (erro) {
      const falha = classificarFalha(erro);
      if (falha.codigo === "acesso-perdido" || falha.codigo === "sem-permissao") return recusar(erro);
      continue;
    }
    if (status === "IN_PROGRESS") continue;
    if (status === "ERROR" || status === "EXPIRED") {
      await falhar(post, { codigo: "nao-preparou" }, agora);
      return "falhou";
    }
    if (status === "PUBLISHED") {
      // Já publicado por um envio anterior cuja resposta se perdeu: não há o que publicar de novo e não sabemos o endereço.
      await concluir(postId, { midiaId: null, permalink: null }, agora);
      return "publicado";
    }
    // FINISHED
    let midiaId: string;
    try {
      ({ midiaId } = await publicarContainer({ igId: conta.igId, containerId, token: conta.token, via: conta.via }));
    } catch (erro) {
      const falha = classificarFalha(erro);
      if (falha.subcodigoMeta === 2207027) continue; // a Meta ainda não liberou: pergunta de novo
      // Sem código, código 1 ou 2 ou 5xx (a Meta sem JSON devolve o status HTTP como código): a resposta se perdeu e pode ter saído. Pergunta uma vez ao contêiner; só "publicado" é prova.
      if (publicacaoIncerta(falha)) {
        let depois: string | null = null;
        try {
          depois = await statusDoContainer(containerId, conta.token, conta.via);
        } catch {
          depois = null;
        }
        if (depois === "PUBLISHED") {
          await concluir(postId, { midiaId: null, permalink: null }, agora);
          return "publicado";
        }
        logger.warn({ clienteId, postId, codigo: falha.codigoMeta }, "post pronto: sem resposta ao publicar");
        await falhar(post, { codigo: "nao-confirmou" }, agora);
        return "falhou";
      }
      return recusar(erro);
    }
    const permalink = await enderecoDaMidia(midiaId, conta.token, conta.via);
    await concluir(postId, { midiaId, permalink }, agora);
    logger.info({ clienteId, postId, imagens: post.imagens.length }, "post pronto: publicado no instagram");
    return "publicado";
  }
  await falhar(post, { codigo: "demorou" }, agora);
  return "falhou";
}

async function concluir(postId: number, r: { midiaId: string | null; permalink: string | null }, agora: Date): Promise<void> {
  await db()
    .update(postsProntos)
    .set({ estado: "publicado", midiaId: r.midiaId, permalink: r.permalink, motivo: null, codigoFalha: null, aviso: null, terminadoEm: agora, atualizadoEm: agora })
    .where(eq(postsProntos.id, postId));
  await apagarImagensDoPost(postId);
}

// ---------------------------------------------------------------------------
// A fila
// ---------------------------------------------------------------------------

/** Quanto tempo uma pasta de post que falhou (e pode ser pedida de novo) fica em disco. */
export const IMAGENS_DE_POST_QUE_FALHOU_FICAM_MS = 3 * 24 * 60 * 60 * 1000;
/** Depois de bater no limite das 24 horas, a fila só pergunta de novo à Meta depois disto. */
export const ESPERA_APOS_O_LIMITE_MS = 15 * 60 * 1000;

/** Apaga as imagens de quem já terminou (e as de quem nem existe mais). Devolve quantas pastas saíram. */
export async function varrerImagensDosPosts(agora: Date = new Date()): Promise<number> {
  const pastas = await postsComPastaEmDisco();
  if (pastas.length === 0) return 0;
  const linhas = await db().select({ id: postsProntos.id, estado: postsProntos.estado, terminadoEm: postsProntos.terminadoEm }).from(postsProntos).where(inArray(postsProntos.id, pastas));
  const porId = new Map(linhas.map((l) => [l.id, l]));
  let apagadas = 0;
  for (const id of pastas) {
    const l = porId.get(id);
    const velho = l?.terminadoEm && agora.getTime() - l.terminadoEm.getTime() > IMAGENS_DE_POST_QUE_FALHOU_FICAM_MS;
    const sobra = !l || l.estado === "publicado" || l.estado === "cancelado" || (l.estado === "falhou" && velho);
    if (sobra) {
      await apagarImagensDoPost(id);
      apagadas += 1;
    }
  }
  return apagadas;
}

export type ResumoDaFila = { marcas: number; publicados: number; falhas: number; esperandoLimite: number; recolhidos: number; varridas: number };

/**
 * Uma rodada da fila (o worker chama de minuto em minuto): recolhe o post que ficou `publicando` há demais (o worker caiu no meio: não sabemos se saiu, então `nao-confirmou`), varre imagens
 * velhas e, para cada marca com post na fila e nenhum sendo publicado, publica o PRIMEIRO se já passou o intervalo desde o último (`PUBLICAR_INTERVALO_MIN`). "Publicar agora" não espera o intervalo.
 */
export async function rodarFilaDePosts(deps: DepsDoPost = {}): Promise<ResumoDaFila> {
  const agora = relogio(deps);
  const resumo: ResumoDaFila = { marcas: 0, publicados: 0, falhas: 0, esperandoLimite: 0, recolhidos: 0, varridas: 0 };
  if (!publicarImagensAtivo()) return resumo;

  const limiteParado = new Date(agora.getTime() - POST_PUBLICANDO_PARADO_APOS_MS);
  const parados = await db().select().from(postsProntos).where(and(eq(postsProntos.estado, "publicando"), lt(postsProntos.atualizadoEm, limiteParado)));
  for (const p of parados) {
    await falhar(p, { codigo: "nao-confirmou" }, agora);
    resumo.recolhidos += 1;
  }
  resumo.varridas = await varrerImagensDosPosts(agora);

  const marcas = await db().selectDistinct({ clienteId: postsProntos.clienteId }).from(postsProntos).where(eq(postsProntos.estado, "na_fila"));
  const intervaloMs = intervaloEntrePostsMin() * 60_000;
  for (const { clienteId } of marcas) {
    resumo.marcas += 1;
    const [ocupada] = await db().select({ id: postsProntos.id }).from(postsProntos).where(and(eq(postsProntos.clienteId, clienteId), eq(postsProntos.estado, "publicando"))).limit(1);
    if (ocupada) continue;
    const [proximo] = await db()
      .select()
      .from(postsProntos)
      .where(and(eq(postsProntos.clienteId, clienteId), eq(postsProntos.estado, "na_fila")))
      .orderBy(desc(postsProntos.agora), asc(postsProntos.id))
      .limit(1);
    if (!proximo) continue;
    if (proximo.aviso === textosPostPronto.aviso.limite && agora.getTime() - proximo.atualizadoEm.getTime() < ESPERA_APOS_O_LIMITE_MS) {
      resumo.esperandoLimite += 1;
      continue;
    }
    if (!proximo.agora) {
      const [ultimo] = await db()
        .select({ quando: sql<Date | null>`max(${postsProntos.terminadoEm})` })
        .from(postsProntos)
        .where(and(eq(postsProntos.clienteId, clienteId), inArray(postsProntos.estado, ["publicado", "falhou"]), ne(postsProntos.id, proximo.id)));
      const quando = ultimo?.quando ? new Date(ultimo.quando) : null;
      if (quando && agora.getTime() - quando.getTime() < intervaloMs) continue;
    }
    const resultado = await publicarPost(proximo.id, deps);
    if (resultado === "publicado") resumo.publicados += 1;
    else if (resultado === "falhou") resumo.falhas += 1;
    else if (resultado === "limite") resumo.esperandoLimite += 1;
  }
  return resumo;
}
