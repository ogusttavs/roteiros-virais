/**
 * E22 PR 1, a assinatura pelo Stripe (PROXIMO.md, "E22"): quem pode usar o aplicativo, como a pessoa começa a assinar, e o tratamento dos avisos (webhook) do Stripe.
 *
 * Três regras que o resto do código não pode quebrar:
 *  - **Conta dividida com o OdontoTech.** Só se trata evento com `metadata.produto = roteiros` (no evento de assinatura e de checkout, no próprio objeto; no de fatura, no
 *    que a fatura copia da assinatura, ou quando a assinatura já está no nosso banco). O resto é ignorado sem deixar rastro (nem na tabela de eventos).
 *  - **Idempotente.** O id do evento entra em `eventos_stripe` na mesma transação que o trata; evento repetido bate no índice único e não faz nada. Se o tratamento falha,
 *    a transação desfaz o id e o Stripe reenvia.
 *  - **Fora de ordem não desfaz.** O Stripe não garante a ordem de entrega: cada assinatura guarda o `created` do último evento que a escreveu e ignora o que for mais velho.
 *
 * Sessão e posse ficam na Server Action (como em todo serviço deste projeto): as funções daqui recebem a marca já resolvida, nunca leem a sessão.
 */
import { randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { DIAS_DE_FOLGA_DA_RENOVACAO, DIAS_DE_TOLERANCIA_SEM_NENHUM_PAGAMENTO, METADATA_PRODUTO } from "@/config/assinatura";
import { db } from "@/db";
import { assinaturas, checkoutsStripe, clientes, eventosStripe, membrosMarca, type Assinatura, type Cliente, type StatusAssinatura } from "@/db/schema";
import { config } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { logger } from "@/lib/log";
import { portaStripe, type EventoDoStripe } from "@/lib/stripe";
import { type EventoDeCobranca, textosAvisoDeCobranca } from "@/textos/aviso-cobranca";

import { destinatariosDoAviso } from "./aviso-de-leitura";

/** Erro de regra da assinatura, com a frase que a pessoa pode ler. */
export class ErroAssinatura extends Error {}

/** Status em que a assinatura ainda existe e pode cobrar no Stripe (mesmo quando o acesso já não vale). */
const STATUS_VIVOS_NO_STRIPE: StatusAssinatura[] = ["active", "trialing", "past_due", "unpaid", "paused"];

// ---------------------------------------------------------------------------
// O portão
// ---------------------------------------------------------------------------

/**
 * A assinatura dá acesso hoje? `active` e `trialing` sim. `past_due` (o cartão falhou e o Stripe está tentando de novo) também: a pessoa não perde o acesso no primeiro
 * cartão recusado, e o Stripe cancela sozinho se não conseguir cobrar. `unpaid`, `canceled`, `incomplete`, `incomplete_expired` e `paused` não. Além do status, o fim do período
 * pago manda: passou do fim mais a folga da renovação (o aviso de renovação pode atrasar), o acesso acaba mesmo que o status ainda diga `active` (aviso perdido).
 * Sem data de fim, vale só o status.
 *
 * **Quem nunca pagou (fim do teste, 23/11/2026).** O `past_due` de uma assinatura sem nenhum pagamento (`primeiroPagamentoEm` nulo: o cartão cadastrado no teste que não passou na primeira
 * cobrança) dá acesso só por `DIAS_DE_TOLERANCIA_SEM_NENHUM_PAGAMENTO` dias, contados de quando o cartão falhou (`atrasadaDesde`), e não até o fim do período novo de 3 meses: senão a pessoa
 * usaria por semanas enquanto o Stripe tenta de novo. Quem já pagou alguma vez segue a regra de sempre.
 */
export type DadosDeAcesso = Pick<Assinatura, "status" | "periodoFim" | "primeiroPagamentoEm" | "atrasadaDesde" | "ultimoEventoEm">;

export function assinaturaVale(a: DadosDeAcesso, agora: Date = new Date()): boolean {
  if (a.status !== "active" && a.status !== "trialing" && a.status !== "past_due") return false;
  if (a.status === "past_due" && !a.primeiroPagamentoEm) {
    // `atrasadaDesde` nulo só acontece em linha anterior a esta regra; nesse caso conta do último aviso.
    const desde = a.atrasadaDesde ?? a.ultimoEventoEm;
    if (agora.getTime() > desde.getTime() + DIAS_DE_TOLERANCIA_SEM_NENHUM_PAGAMENTO * 24 * 60 * 60 * 1000) return false;
  }
  if (!a.periodoFim) return true;
  const limite = a.periodoFim.getTime() + DIAS_DE_FOLGA_DA_RENOVACAO * 24 * 60 * 60 * 1000;
  return agora.getTime() <= limite;
}

/**
 * O portão em si, puro: a marca precisa assinar quando a cobrança está ligada, ela não é cortesia e nenhuma assinatura dela vale. Desligado, ninguém precisa de nada.
 */
export function precisaAssinarCom(entrada: { cobrancaAtiva: boolean; cortesia: boolean; assinaturas: DadosDeAcesso[]; agora?: Date }): boolean {
  if (!entrada.cobrancaAtiva) return false;
  if (entrada.cortesia) return false;
  const agora = entrada.agora ?? new Date();
  return !entrada.assinaturas.some((a) => assinaturaVale(a, agora));
}

/** Todas as assinaturas da marca, da mais nova para a mais antiga. */
export async function assinaturasDaMarca(clienteId: number): Promise<Assinatura[]> {
  return db().select().from(assinaturas).where(eq(assinaturas.clienteId, clienteId)).orderBy(desc(assinaturas.criadoEm), desc(assinaturas.id));
}

/** A assinatura que conta para a marca: a que vale, ou, se nenhuma vale, a mais nova (para dizer o estado dela). */
export function assinaturaPrincipal(lista: Assinatura[], agora: Date = new Date()): Assinatura | null {
  return lista.find((a) => assinaturaVale(a, agora)) ?? lista[0] ?? null;
}

/** O que o layout do painel chama: esta marca precisa ser mandada para `/assinar`? */
export async function marcaPrecisaAssinar(cliente: Pick<Cliente, "id" | "cortesia">, agora: Date = new Date(), cobrancaAtiva: boolean = config.cobranca.ativa): Promise<boolean> {
  // Desligado ou cortesia: nem consulta o banco.
  if (!cobrancaAtiva || cliente.cortesia) return false;
  return precisaAssinarCom({ cobrancaAtiva, cortesia: false, assinaturas: await assinaturasDaMarca(cliente.id), agora });
}

// ---------------------------------------------------------------------------
// Começar a assinar e abrir o portal (as ações chamam estas)
// ---------------------------------------------------------------------------

/** Só o dono da marca assina e abre o portal; as telas usam a mesma pergunta para decidir se mostram os botões. */
export async function ehDonoDaMarca(usuarioId: string, clienteId: number): Promise<boolean> {
  const [linha] = await db()
    .select({ papel: membrosMarca.papel })
    .from(membrosMarca)
    .where(and(eq(membrosMarca.usuarioId, usuarioId), eq(membrosMarca.clienteId, clienteId)));
  return linha?.papel === "dono";
}

/**
 * A marca pode ganhar o teste grátis? Só a que nunca teve linha em `assinaturas` (nem teste, nem assinatura cancelada), com o teste ligado (`COBRANCA_TESTE_DIAS` acima de 0). É a pergunta
 * rápida, só com o nosso banco, que a tela de assinar usa para anunciar o teste; na hora de abrir o pagamento, `iniciarAssinatura` confere também no Stripe (`jaTeveAssinatura`).
 */
export function marcaPodeGanharTeste(lista: Pick<Assinatura, "id">[], dias: number = config.cobranca.testeDias): boolean {
  return dias > 0 && lista.length === 0;
}

export const frasesDaAssinatura = {
  soODono: "Só quem criou a conta pode assinar. Peça para essa pessoa fazer isto.",
  jaAssinada: "Esta conta já tem uma assinatura ativa.",
  emAndamento: "Esta conta já tem uma assinatura, só falta acertar o cartão. Abra a gestão da assinatura para atualizar o cartão.",
  semPlano: "Não deu para abrir o pagamento agora. Tente de novo daqui a pouco.",
  semAssinatura: "Esta conta ainda não tem uma assinatura para gerenciar.",
  falhou: "Não deu para abrir o pagamento agora. Tente de novo daqui a pouco.",
  semTeste: "Esta conta não está no teste grátis.",
  emAbertura: "Já estamos abrindo o pagamento desta conta. Espere um instante e toque de novo.",
  cartaoRecusado: `O seu cartão foi recusado. Atualize o cartão em até ${DIAS_DE_TOLERANCIA_SEM_NENHUM_PAGAMENTO} dias para continuar usando.`,
  naoCancelou: "Não deu para cancelar a assinatura desta conta no Stripe, então a conta não foi apagada. Nada mudou: tente de novo, ou cancele a assinatura no painel do Stripe antes.",
} as const;

/**
 * Cria a sessão do Checkout do plano trimestral para a marca e devolve o endereço. Só o dono assina; marca com assinatura que vale não assina de novo; o preço sai do Stripe pela
 * chave de busca (e só vale se for deste produto). O "ver como" nunca chega aqui (a ação recusa antes).
 *
 * **Um Checkout aberto por marca (E22 PR 2, item 0b).** O segundo clique (duas abas, dois toques, o botão "voltar" do navegador) reaproveita a sessão que o primeiro abriu, em vez de criar
 * outra: duas sessões abertas deixariam a pessoa pagar duas vezes. A sessão fica em `checkouts_stripe` (uma linha por marca); antes de reaproveitar, o Stripe confirma que ela ainda
 * está aberta (se foi paga, expirou ou sumiu, abre outra). O cadeado por marca faz dois cliques ao mesmo tempo passarem um de cada vez.
 */
export async function iniciarAssinatura(usuario: { id: string; email: string }, cliente: Pick<Cliente, "id">, agora: Date = new Date()): Promise<{ url: string }> {
  if (!(await ehDonoDaMarca(usuario.id, cliente.id))) throw new ErroAssinatura(frasesDaAssinatura.soODono);

  const lista = await assinaturasDaMarca(cliente.id);
  if (lista.some((a) => assinaturaVale(a, agora))) throw new ErroAssinatura(frasesDaAssinatura.jaAssinada);
  // Uma assinatura que o Stripe ainda considera viva (cartão recusado, ou aviso de renovação que não chegou) não deixa abrir OUTRA: a pessoa seria cobrada duas vezes. Ela atualiza o
  // cartão no portal; se o Stripe desistir de cobrar, a assinatura vira `canceled` e aí sim assina de novo.
  if (lista.some((a) => STATUS_VIVOS_NO_STRIPE.includes(a.status))) throw new ErroAssinatura(frasesDaAssinatura.emAndamento);

  try {
    const porta = portaStripe();
    // O Stripe é chamado FORA de qualquer transação (revisão de 23/11/2026, M1): cada tentativa leva até 20 s, e a transação com trava segurava uma das 8 conexões do banco o tempo todo.
    const reservado = await reservarCheckout(porta, cliente.id);
    if (reservado.tipo === "url") return { url: reservado.url };
    const { reserva } = reservado;
    try {
      const preco = await porta.precoDoPlano(config.cobranca.precoLookupKey);
      if (!preco) {
        logger.error({ clienteId: cliente.id, lookupKey: config.cobranca.precoLookupKey }, "assinatura: o preco do plano nao existe no Stripe (rode scripts/stripe-preparar.ts)");
        throw new ErroAssinatura(frasesDaAssinatura.semPlano);
      }
      // O teste grátis é uma vez só por marca: quem já teve assinatura (teste, ativa ou cancelada) no nosso banco ou no Stripe abre o Checkout sem teste, cobrando na hora.
      // `reserva.anterior` é o Checkout anterior da marca (aberto, expirado ou pago); se foi pago e o aviso se perdeu, o Stripe ainda diz que a assinatura existe.
      const diasDeTeste = marcaPodeGanharTeste(lista) && !(await porta.jaTeveAssinatura({ clienteId: cliente.id, sessaoAnteriorId: reserva.anterior })) ? config.cobranca.testeDias : 0;
      const nova = await porta.criarCheckout({
        precoId: preco.id,
        clienteId: cliente.id,
        // Reaproveita o cliente do Stripe de uma assinatura antiga da mesma marca (cartão e histórico já lá).
        stripeClienteId: lista[0]?.stripeClienteId ?? null,
        email: usuario.email,
        urlDeSucesso: `${config.appUrl}/assinar?assinou=1`,
        urlDeCancelar: `${config.appUrl}/assinar`,
        diasDeTeste,
        exigeCartao: config.cobranca.testeExigeCartao,
      });
      const gravou = await db()
        .update(checkoutsStripe)
        .set({ stripeSessaoId: nova.sessaoId, criadoEm: new Date() })
        .where(and(eq(checkoutsStripe.clienteId, cliente.id), eq(checkoutsStripe.stripeSessaoId, reserva.minha)))
        .returning({ id: checkoutsStripe.id });
      if (gravou.length === 0) logger.warn({ clienteId: cliente.id, sessaoId: nova.sessaoId }, "assinatura: a reserva do Checkout foi tomada por outra tentativa antes de gravar a sessao; ela fica sem registro");
      return { url: nova.url };
    } catch (erro) {
      await soltarReserva(cliente.id, reserva);
      throw erro;
    }
  } catch (erro) {
    if (erro instanceof ErroAssinatura) throw erro;
    logger.error({ err: erro, clienteId: cliente.id }, "assinatura: o Stripe falhou ao criar o Checkout");
    throw new ErroAssinatura(frasesDaAssinatura.falhou);
  }
}

// ---------------------------------------------------------------------------
// A reserva do Checkout (o cadeado curto, só no banco)
// ---------------------------------------------------------------------------

/** Em `checkouts_stripe.stripe_sessao_id`, o que marca "alguém está abrindo o Checkout desta marca agora" (a chamada ao Stripe acontece com a reserva feita, fora de transação). */
const PREFIXO_DA_RESERVA = "pendente:";
/** Reserva mais velha que isto é de uma tentativa que morreu no meio: a próxima a toma (o Stripe leva até 20 s por tentativa, com 2 repetições). */
const IDADE_MAXIMA_DA_RESERVA_MS = 90_000;
const ESPERA_ENTRE_CONFERENCIAS_MS = 300;
const CONFERENCIAS_ATE_DESISTIR = 40;

type Reserva = { minha: string; anterior: string | null };

export function ehReservaDeCheckout(stripeSessaoId: string): boolean {
  return stripeSessaoId.startsWith(PREFIXO_DA_RESERVA);
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ou devolve o endereço de um Checkout que já está aberto para a marca, ou faz a reserva que dá a esta chamada o direito de abrir um novo. A reserva é uma troca atômica numa linha só
 * (`INSERT ... ON CONFLICT DO NOTHING` ou `UPDATE ... WHERE stripe_sessao_id = <o que li>`): de dois cliques ao mesmo tempo, um reserva e o outro espera, e depois reaproveita a sessão do
 * primeiro. Nenhuma transação fica aberta enquanto o Stripe responde.
 */
async function reservarCheckout(porta: ReturnType<typeof portaStripe>, clienteId: number): Promise<{ tipo: "url"; url: string } | { tipo: "reservada"; reserva: Reserva }> {
  for (let i = 0; i < CONFERENCIAS_ATE_DESISTIR; i++) {
    const minha = `${PREFIXO_DA_RESERVA}${randomUUID()}`;
    const [linha] = await db().select().from(checkoutsStripe).where(eq(checkoutsStripe.clienteId, clienteId));
    if (!linha) {
      const [inserida] = await db().insert(checkoutsStripe).values({ clienteId, stripeSessaoId: minha }).onConflictDoNothing({ target: checkoutsStripe.clienteId }).returning({ id: checkoutsStripe.id });
      if (inserida) return { tipo: "reservada", reserva: { minha, anterior: null } };
      continue;
    }
    if (ehReservaDeCheckout(linha.stripeSessaoId)) {
      if (Date.now() - linha.criadoEm.getTime() <= IDADE_MAXIMA_DA_RESERVA_MS) {
        await dormir(ESPERA_ENTRE_CONFERENCIAS_MS);
        continue;
      }
      // A reserva ficou velha: a tentativa que a fez morreu. Quem tomar primeiro (a troca confere o valor que leu) segue; o Checkout dela, se existiu, fica sem registro.
      if (await tomar(clienteId, linha.stripeSessaoId, minha)) return { tipo: "reservada", reserva: { minha, anterior: null } };
      continue;
    }
    const viva = await porta.sessaoAberta(linha.stripeSessaoId, clienteId);
    if (viva) return { tipo: "url", url: viva.url };
    if (await tomar(clienteId, linha.stripeSessaoId, minha)) return { tipo: "reservada", reserva: { minha, anterior: linha.stripeSessaoId } };
  }
  throw new ErroAssinatura(frasesDaAssinatura.emAbertura);
}

/** Troca o valor da linha da marca só se ela ainda guarda `de`. Verdade se esta chamada ganhou. */
async function tomar(clienteId: number, de: string, para: string): Promise<boolean> {
  const trocou = await db()
    .update(checkoutsStripe)
    .set({ stripeSessaoId: para, criadoEm: new Date() })
    .where(and(eq(checkoutsStripe.clienteId, clienteId), eq(checkoutsStripe.stripeSessaoId, de)))
    .returning({ id: checkoutsStripe.id });
  return trocou.length > 0;
}

/** A tentativa falhou: devolve a linha ao que era antes da reserva (a sessão anterior, ou nenhuma), para o próximo clique não esperar por uma reserva que não vai se cumprir. */
async function soltarReserva(clienteId: number, reserva: Reserva): Promise<void> {
  try {
    if (reserva.anterior) await tomar(clienteId, reserva.minha, reserva.anterior);
    else await db().delete(checkoutsStripe).where(and(eq(checkoutsStripe.clienteId, clienteId), eq(checkoutsStripe.stripeSessaoId, reserva.minha)));
  } catch (erro) {
    logger.error({ err: erro, clienteId }, "assinatura: nao foi possivel soltar a reserva do Checkout; ela expira sozinha");
  }
}

// ---------------------------------------------------------------------------
// Assinar no meio do teste
// ---------------------------------------------------------------------------

/** A assinatura em teste que vale agora (`trialing`), se a marca tem uma. */
export function assinaturaEmTeste(lista: Assinatura[], agora: Date = new Date()): Assinatura | null {
  return lista.find((a) => a.status === "trialing" && assinaturaVale(a, agora)) ?? null;
}

export type ResultadoDeAssinarAgora =
  /** O teste acabou e o cartão foi cobrado hoje; a assinatura vira `active` quando o Stripe confirmar o pagamento. */
  | { tipo: "cobrado" }
  /** A pessoa ainda não cadastrou o cartão: abre o portal (`url`) para cadastrar; depois ela volta e assina agora. Nada foi cobrado, o teste segue. */
  | { tipo: "cadastrar-cartao"; url: string };

/**
 * Assinar no meio do teste (decisão do Gustavo em 23/11/2026, "Sim, cobra na hora"). Quem está em teste e assina encerra o teste: a cobrança é feita agora e os limites do teste caem sozinhos
 * quando a assinatura vira `active` (eles só valem para quem não tem assinatura `active`). Contraponto registrado: a pessoa perde os dias que sobravam.
 *
 *  - **Com cartão cadastrado** (`temFormaDePagamento`): encerra o teste no Stripe (`trial_end: "now"`), que emite a fatura e cobra na hora. Não grava nada aqui: o estado volta pelos avisos do
 *    Stripe (`customer.subscription.updated`, `invoice.paid`), como em qualquer cobrança. Cartão recusado: o Stripe deixa a assinatura `past_due` sem nenhum pagamento, e a regra de quem nunca
 *    pagou (`DIAS_DE_TOLERANCIA_SEM_NENHUM_PAGAMENTO`) vale; a pessoa recebe `frasesDaAssinatura.cartaoRecusado` (lança `ErroAssinatura`).
 *  - **Sem cartão**: devolve o endereço do portal para cadastrar o cartão (o fluxo que já existe; nada novo no Stripe). Depois de cadastrar, a pessoa volta e toca em assinar agora de novo, e
 *    cai no caso acima.
 *
 * Só o dono. A Server Action `assinarAgoraAction` (em `app/(painel)/assinar/acoes.ts`) é quem chama; a tela do limite do teste usa a mesma ação.
 */
export async function assinarAgora(usuario: { id: string }, cliente: Pick<Cliente, "id">, agora: Date = new Date()): Promise<ResultadoDeAssinarAgora> {
  if (!(await ehDonoDaMarca(usuario.id, cliente.id))) throw new ErroAssinatura(frasesDaAssinatura.soODono);
  const lista = await assinaturasDaMarca(cliente.id);
  const emTeste = assinaturaEmTeste(lista, agora);
  if (!emTeste) throw new ErroAssinatura(lista.some((a) => assinaturaVale(a, agora)) ? frasesDaAssinatura.jaAssinada : frasesDaAssinatura.semTeste);

  if (!emTeste.temFormaDePagamento) {
    const portal = await abrirPortalDaAssinatura(usuario, cliente);
    return { tipo: "cadastrar-cartao", url: portal.url };
  }

  let cobrado: boolean;
  try {
    ({ cobrado } = await portaStripe().encerrarTeste({ stripeAssinaturaId: emTeste.stripeAssinaturaId, clienteId: cliente.id }));
  } catch (erro) {
    logger.error({ err: erro, clienteId: cliente.id }, "assinatura: o Stripe falhou ao encerrar o teste");
    throw new ErroAssinatura(frasesDaAssinatura.falhou);
  }
  if (!cobrado) {
    logger.warn({ clienteId: cliente.id }, "assinatura: o cartao foi recusado ao encerrar o teste; vale a tolerancia de quem nunca pagou");
    throw new ErroAssinatura(frasesDaAssinatura.cartaoRecusado);
  }
  return { tipo: "cobrado" };
}

/** O portal do cliente no Stripe (trocar o cartão, cancelar). Só o dono; só quem já tem cliente no Stripe. */
export async function abrirPortalDaAssinatura(usuario: { id: string }, cliente: Pick<Cliente, "id">): Promise<{ url: string }> {
  if (!(await ehDonoDaMarca(usuario.id, cliente.id))) throw new ErroAssinatura(frasesDaAssinatura.soODono);
  const lista = await assinaturasDaMarca(cliente.id);
  const stripeClienteId = lista[0]?.stripeClienteId;
  if (!stripeClienteId) throw new ErroAssinatura(frasesDaAssinatura.semAssinatura);
  try {
    return await portaStripe().criarPortal({ stripeClienteId, urlDeVolta: `${config.appUrl}/conta` });
  } catch (erro) {
    logger.error({ err: erro, clienteId: cliente.id }, "assinatura: o Stripe falhou ao abrir o portal");
    throw new ErroAssinatura(frasesDaAssinatura.falhou);
  }
}

// ---------------------------------------------------------------------------
// Apagar a marca (E22 PR 2, item 0d)
// ---------------------------------------------------------------------------

/** Status em que a assinatura já acabou de vez (nada mais a cobrar no Stripe). */
const STATUS_ACABADOS: StatusAssinatura[] = ["canceled", "incomplete_expired"];

/** O que há para cancelar no Stripe quando uma marca vai ser apagada: as assinaturas que ainda não acabaram e o Checkout que ficou aberto. */
export type AlvosDoCancelamento = { assinaturaIds: string[]; sessaoId: string | null };

/**
 * Lê (sem mexer em nada) o que o Stripe precisa cancelar antes de a marca sumir. Tem de rodar ANTES do `DELETE` da marca: o `ON DELETE CASCADE` leva as linhas de `assinaturas` e de
 * `checkouts_stripe` junto, e com elas o único registro de quais assinaturas do Stripe eram dela.
 */
export async function alvosDoCancelamento(clienteId: number, executor: Pick<ReturnType<typeof db>, "select"> = db()): Promise<AlvosDoCancelamento> {
  const lista = await executor.select().from(assinaturas).where(eq(assinaturas.clienteId, clienteId)).orderBy(desc(assinaturas.criadoEm), desc(assinaturas.id));
  const [aberto] = await executor.select().from(checkoutsStripe).where(eq(checkoutsStripe.clienteId, clienteId));
  return { assinaturaIds: lista.filter((a) => !STATUS_ACABADOS.includes(a.status)).map((a) => a.stripeAssinaturaId), sessaoId: aberto && !ehReservaDeCheckout(aberto.stripeSessaoId) ? aberto.stripeSessaoId : null };
}

/**
 * Cancela no Stripe o que `alvosDoCancelamento` achou: primeiro fecha o Checkout aberto (se a pessoa pagasse depois de a marca sumir, o Stripe cobraria e o aviso não acharia a conta),
 * depois cancela cada assinatura. Se o Stripe falhar em qualquer uma, **lança `ErroAssinatura`** e quem chama não pode apagar a marca. Sem alvo, não chama o Stripe nenhuma vez
 * (nada muda para quem nunca assinou). Devolve quantas assinaturas cancelou.
 */
export async function cancelarNoStripe(clienteId: number, alvos: AlvosDoCancelamento): Promise<number> {
  if (alvos.assinaturaIds.length === 0 && !alvos.sessaoId) return 0;
  try {
    const porta = portaStripe();
    if (alvos.sessaoId) await porta.expirarSessao(alvos.sessaoId);
    for (const id of alvos.assinaturaIds) await porta.cancelarAssinatura(id);
  } catch (erro) {
    logger.error({ err: erro, clienteId }, "assinatura: o Stripe falhou ao cancelar a assinatura de uma marca que ia ser apagada; a marca nao foi apagada");
    throw new ErroAssinatura(frasesDaAssinatura.naoCancelou);
  }
  return alvos.assinaturaIds.length;
}

// ---------------------------------------------------------------------------
// Ler o evento (puro)
// ---------------------------------------------------------------------------

export const TIPOS_TRATADOS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;
type TipoTratado = (typeof TIPOS_TRATADOS)[number];

function ehTipoTratado(tipo: string): tipo is TipoTratado {
  return (TIPOS_TRATADOS as readonly string[]).includes(tipo);
}

type Objeto = Record<string, unknown>;

function objeto(v: unknown): Objeto | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Objeto) : null;
}
function texto(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
/** Campo que o Stripe devolve como id ou, expandido, como objeto com `id`. */
function idDe(v: unknown): string | null {
  return texto(v) ?? texto(objeto(v)?.id);
}
function dataDeSegundos(v: unknown): Date | null {
  return typeof v === "number" && Number.isFinite(v) ? new Date(v * 1000) : null;
}

/** O produto é nosso? Lê `metadata.produto` de um objeto que traga `metadata`. */
export function ehNosso(metadata: unknown): boolean {
  return objeto(metadata)?.produto === METADATA_PRODUTO.produto;
}

/** A marca que o `metadata.cliente_id` (ou o `client_reference_id`) aponta; nulo se faltar, não for um inteiro positivo, ou se os dois discordarem. */
export function clienteIdDoAviso(metadata: unknown, clientReferenceId?: unknown): number | null {
  const candidatos = [objeto(metadata)?.cliente_id, clientReferenceId].map((v) => (typeof v === "string" || typeof v === "number" ? String(v) : null)).filter((v): v is string => v !== null);
  if (candidatos.length === 0) return null;
  if (candidatos.some((c) => !/^[1-9]\d{0,9}$/.test(c))) return null;
  if (new Set(candidatos).size > 1) return null;
  const n = Number(candidatos[0]);
  return Number.isSafeInteger(n) && n <= 2_147_483_647 ? n : null;
}

/** O que um evento nosso muda numa assinatura. `status` ausente: não mexe no status de uma linha que já existe (só `statusSeNova` vale ao criar). */
export type MudancaDeAssinatura = {
  stripeAssinaturaId: string;
  stripeClienteId: string | null;
  clienteId: number | null;
  status?: StatusAssinatura;
  statusSeNova: StatusAssinatura;
  stripePrecoId?: string | null;
  periodoInicio?: Date | null;
  periodoFim?: Date | null;
  cancelaNoFimDoPeriodo?: boolean;
  /** O aviso mostra que a assinatura nasceu como teste grátis (nunca desfaz). */
  comecouComoTeste?: boolean;
  /** O aviso prova um pagamento de verdade (fatura paga com valor, Checkout pago, assinatura `active`). */
  pagou?: boolean;
  /** Se o aviso diz se a assinatura tem forma de pagamento (`default_payment_method`); ausente: o aviso não diz, e o que está gravado fica. */
  temFormaDePagamento?: boolean;
  /** Se vier, o `status` só muda quando o status atual da linha estiver nesta lista (a fatura que falhou só rebaixa quem já era assinante). */
  soSobreStatus?: StatusAssinatura[];
};

export type LeituraDoEvento =
  | { tipo: "ignorar"; motivo: string }
  /** `verificar`: o evento (fatura) não traz a marca nossa; só vale se a assinatura já estiver no nosso banco. */
  | { tipo: "tratar"; mudanca: MudancaDeAssinatura; verificar: boolean };

function periodoDosItens(assinatura: Objeto): { inicio: Date | null; fim: Date | null } {
  // Versões novas da API guardam o período em cada item da assinatura; as antigas, na própria assinatura. Vale o da assinatura quando existe.
  const inicioTopo = dataDeSegundos(assinatura.current_period_start);
  const fimTopo = dataDeSegundos(assinatura.current_period_end);
  if (inicioTopo || fimTopo) return { inicio: inicioTopo, fim: fimTopo };
  const itens = Array.isArray(objeto(assinatura.items)?.data) ? (objeto(assinatura.items)!.data as unknown[]) : [];
  let inicio: Date | null = null;
  let fim: Date | null = null;
  for (const bruto of itens) {
    const item = objeto(bruto);
    if (!item) continue;
    const i = dataDeSegundos(item.current_period_start);
    const f = dataDeSegundos(item.current_period_end);
    if (i && (!inicio || i < inicio)) inicio = i;
    if (f && (!fim || f > fim)) fim = f;
  }
  return { inicio, fim };
}

function precoDosItens(assinatura: Objeto): string | null {
  const itens = Array.isArray(objeto(assinatura.items)?.data) ? (objeto(assinatura.items)!.data as unknown[]) : [];
  return idDe(objeto(itens[0])?.price);
}

const STATUS_CONHECIDOS: StatusAssinatura[] = ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"];

/**
 * Lê um evento do Stripe e diz se ele é nosso e o que muda. Pura: não consulta nada. Tipo que não tratamos, evento sem `metadata.produto = roteiros` (e sem como chegar nele),
 * assinatura sem id: `ignorar`.
 */
export function lerEvento(evento: EventoDoStripe): LeituraDoEvento {
  if (!ehTipoTratado(evento.type)) return { tipo: "ignorar", motivo: "tipo nao tratado" };
  const obj = evento.data.object;

  if (evento.type === "checkout.session.completed") {
    if (obj.mode !== "subscription") return { tipo: "ignorar", motivo: "checkout que nao e de assinatura" };
    if (!ehNosso(obj.metadata)) return { tipo: "ignorar", motivo: "sem metadata.produto = roteiros" };
    const stripeAssinaturaId = idDe(obj.subscription);
    const stripeClienteId = idDe(obj.customer);
    if (!stripeAssinaturaId || !stripeClienteId) return { tipo: "ignorar", motivo: "checkout sem assinatura ou sem cliente" };
    // `no_payment_required` é o Checkout de uma assinatura que começa com teste grátis (nada a pagar agora): ela já vale, como `trialing`. O aviso da assinatura (`customer.subscription.*`) confirma o estado.
    const statusSeNova: StatusAssinatura = obj.payment_status === "paid" ? "active" : obj.payment_status === "no_payment_required" ? "trialing" : "incomplete";
    return {
      tipo: "tratar",
      verificar: false,
      mudanca: {
        stripeAssinaturaId,
        stripeClienteId,
        clienteId: clienteIdDoAviso(obj.metadata, obj.client_reference_id),
        statusSeNova,
        comecouComoTeste: obj.payment_status === "no_payment_required",
        ...(obj.payment_status === "paid" ? { pagou: true, temFormaDePagamento: true } : {}),
      },
    };
  }

  if (evento.type.startsWith("customer.subscription.")) {
    if (!ehNosso(obj.metadata)) return { tipo: "ignorar", motivo: "sem metadata.produto = roteiros" };
    const stripeAssinaturaId = texto(obj.id);
    if (!stripeAssinaturaId) return { tipo: "ignorar", motivo: "assinatura sem id" };
    const apagada = evento.type === "customer.subscription.deleted";
    const statusBruto = texto(obj.status);
    const status: StatusAssinatura = apagada ? "canceled" : ((STATUS_CONHECIDOS as string[]).includes(statusBruto ?? "") ? (statusBruto as StatusAssinatura) : "incomplete");
    const { inicio, fim } = periodoDosItens(obj);
    return {
      tipo: "tratar",
      verificar: false,
      mudanca: {
        stripeAssinaturaId,
        stripeClienteId: idDe(obj.customer),
        clienteId: clienteIdDoAviso(obj.metadata),
        status,
        statusSeNova: status,
        stripePrecoId: precoDosItens(obj),
        periodoInicio: inicio,
        periodoFim: fim,
        cancelaNoFimDoPeriodo: obj.cancel_at_period_end === true || (typeof obj.cancel_at === "number" && !apagada),
        // `trial_start` fica na assinatura mesmo depois de o teste acabar: é o que prova, em qualquer aviso, que ela nasceu como teste.
        comecouComoTeste: status === "trialing" || typeof obj.trial_start === "number",
        // `active` só acontece depois de uma fatura paga.
        ...(status === "active" ? { pagou: true } : {}),
        // `default_payment_method` é o cartão da assinatura. Cartão que só está no cliente do Stripe (sem ser o da assinatura) o aviso da assinatura não mostra.
        ...("default_payment_method" in obj ? { temFormaDePagamento: idDe(obj.default_payment_method) !== null || status === "active" } : {}),
      },
    };
  }

  // invoice.paid e invoice.payment_failed: a assinatura vem no `parent.subscription_details` (API nova) ou direto na fatura (API antiga).
  const detalhes = objeto(objeto(obj.parent)?.subscription_details) ?? objeto(obj.subscription_details);
  const stripeAssinaturaId = idDe(detalhes?.subscription) ?? idDe(obj.subscription);
  if (!stripeAssinaturaId) return { tipo: "ignorar", motivo: "fatura sem assinatura" };
  const metadata = detalhes?.metadata;
  const pago = evento.type === "invoice.paid";
  // A fatura de R$ 0 que o Stripe emite quando o teste grátis começa também chega como `invoice.paid`. Ela não prova que alguém pagou: não pode virar `active` nem mexer no período
  // (quem manda no estado e no fim do teste é o aviso da assinatura).
  const zerada = pago && obj.amount_paid === 0;
  // A fatura pode trazer mais de uma linha (crédito ou ajuste de um período anterior antes da assinatura): vale o período que termina mais tarde.
  const linhas = Array.isArray(objeto(obj.lines)?.data) ? (objeto(obj.lines)!.data as unknown[]) : [];
  let periodo: Objeto | null = null;
  for (const bruta of linhas) {
    const candidato = objeto(objeto(bruta)?.period);
    const fim = dataDeSegundos(candidato?.end);
    if (candidato && fim && (!periodo || fim > (dataDeSegundos(periodo.end) ?? new Date(0)))) periodo = candidato;
  }
  return {
    tipo: "tratar",
    // Fatura que não traz a nossa marca só vale se a assinatura já é nossa (está no banco).
    verificar: !ehNosso(metadata),
    mudanca: {
      stripeAssinaturaId,
      stripeClienteId: idDe(obj.customer),
      clienteId: clienteIdDoAviso(metadata),
      ...(zerada ? {} : { status: (pago ? "active" : "past_due") as StatusAssinatura }),
      // Fatura que falha para uma assinatura que ainda não conhecemos não pode abrir o acesso: só `active` abre, e o `past_due` só vale para quem já era assinante
      // (`soSobreStatus`: uma assinatura ainda `incomplete`, com o primeiro pagamento em curso, não vira `past_due` e ganha acesso).
      statusSeNova: zerada ? "trialing" : pago ? "active" : "incomplete",
      ...(pago ? {} : { soSobreStatus: ["active", "trialing", "past_due"] as StatusAssinatura[] }),
      ...(pago && !zerada ? { periodoInicio: dataDeSegundos(periodo?.start), periodoFim: dataDeSegundos(periodo?.end), pagou: true, temFormaDePagamento: true } : {}),
      ...(zerada ? { comecouComoTeste: true } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Tratar o evento (banco)
// ---------------------------------------------------------------------------

export type ResultadoDoEvento = "tratado" | "repetido" | "ignorado";

type Executor = Pick<ReturnType<typeof db>, "select" | "insert" | "update" | "execute">;

/** O que mudou de verdade na assinatura por causa do evento: é daqui que saem os e-mails ao admin (M5), uma vez por mudança, não por evento. */
type Mudou = EventoDeCobranca["tipo"][];

async function aplicarMudanca(tx: Executor, m: MudancaDeAssinatura, eventoEm: Date, eventoId: string): Promise<{ clienteId: number | null; mudou: Mudou }> {
  const [atual] = await tx.select().from(assinaturas).where(eq(assinaturas.stripeAssinaturaId, m.stripeAssinaturaId));

  if (!atual) {
    const stripeClienteId = m.stripeClienteId;
    if (m.clienteId === null || !stripeClienteId) {
      logger.warn({ eventoId, stripeAssinaturaId: m.stripeAssinaturaId }, "stripe: evento nosso, mas sem a marca ou sem o cliente do Stripe; nada gravado");
      return { clienteId: null, mudou: [] };
    }
    const [marca] = await tx.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, m.clienteId));
    if (!marca) {
      logger.warn({ eventoId, clienteId: m.clienteId }, "stripe: evento nosso aponta para uma marca que nao existe; nada gravado");
      return { clienteId: null, mudou: [] };
    }
    const criada = await tx
      .insert(assinaturas)
      .values({
        clienteId: m.clienteId,
        status: m.statusSeNova,
        stripeClienteId,
        stripeAssinaturaId: m.stripeAssinaturaId,
        stripePrecoId: m.stripePrecoId ?? null,
        periodoInicio: m.periodoInicio ?? null,
        periodoFim: m.periodoFim ?? null,
        cancelaNoFimDoPeriodo: m.cancelaNoFimDoPeriodo ?? false,
        comecouComoTeste: m.comecouComoTeste === true || m.statusSeNova === "trialing",
        primeiroPagamentoEm: m.pagou ? eventoEm : null,
        atrasadaDesde: m.statusSeNova === "past_due" ? eventoEm : null,
        temFormaDePagamento: m.temFormaDePagamento === true,
        ultimoEventoEm: eventoEm,
      })
      .onConflictDoNothing({ target: assinaturas.stripeAssinaturaId })
      .returning({ id: assinaturas.id });
    if (criada.length === 0) return { clienteId: m.clienteId, mudou: [] };
    const mudou: Mudou = [];
    if (m.statusSeNova === "trialing") mudou.push("teste-comecou");
    if (m.pagou) mudou.push("assinatura-paga");
    if (m.statusSeNova === "past_due") mudou.push("cartao-recusado");
    if (m.statusSeNova === "canceled") mudou.push("cancelamento");
    return { clienteId: m.clienteId, mudou };
  }

  // `canceled` e `incomplete_expired` são finais: reassinar cria OUTRA assinatura no Stripe, nunca reabre a antiga. Um evento atrasado, ou do mesmo segundo, não a ressuscita.
  if (atual.status === "canceled" || atual.status === "incomplete_expired") return { clienteId: atual.clienteId, mudou: [] };
  // Evento mais velho que o último que escreveu aqui: o mais novo já valeu para o status, mas não pode ser jogado fora inteiro (o Stripe entrega em paralelo: o checkout, mais novo,
  // pode chegar antes da assinatura e deixar a linha sem período e sem preço). Só preenche o que está vazio; nunca mexe no status nem em `ultimoEventoEm`.
  if (eventoEm.getTime() < atual.ultimoEventoEm.getTime()) {
    const vazios = {
      ...(!atual.stripeClienteId && m.stripeClienteId ? { stripeClienteId: m.stripeClienteId } : {}),
      ...(!atual.stripePrecoId && m.stripePrecoId ? { stripePrecoId: m.stripePrecoId } : {}),
      ...(!atual.periodoInicio && m.periodoInicio ? { periodoInicio: m.periodoInicio } : {}),
      ...(!atual.periodoFim && m.periodoFim ? { periodoFim: m.periodoFim } : {}),
      // Provas que só se acrescentam (nunca desfazem): o teste de onde veio e o primeiro pagamento, mesmo vindos de um aviso atrasado.
      ...(!atual.comecouComoTeste && m.comecouComoTeste ? { comecouComoTeste: true } : {}),
      ...(!atual.primeiroPagamentoEm && m.pagou ? { primeiroPagamentoEm: eventoEm } : {}),
    };
    if (Object.keys(vazios).length > 0) await tx.update(assinaturas).set({ ...vazios, atualizadoEm: new Date() }).where(eq(assinaturas.id, atual.id));
    // O primeiro pagamento que só chegou agora, num aviso atrasado, também é uma assinatura nova paga (o aviso mais novo pode ter vindo antes sem trazê-lo).
    return { clienteId: atual.clienteId, mudou: !atual.primeiroPagamentoEm && m.pagou ? ["assinatura-paga"] : [] };
  }

  // O `created` do Stripe tem resolução de um segundo, então dois eventos do mesmo segundo (o cadastro: assinatura criada `incomplete`, fatura paga `active`) podem chegar em qualquer ordem.
  // Quem já saiu de `incomplete` nunca volta a ele (o Stripe não faz isso), e o desempate fica sem depender da ordem de chegada.
  let status = m.status;
  if (status === "incomplete" && atual.status !== "incomplete") status = undefined;
  if (status !== undefined && m.soSobreStatus && !m.soSobreStatus.includes(atual.status)) status = undefined;

  await tx
    .update(assinaturas)
    .set({
      ...(status !== undefined ? { status } : {}),
      ...(m.stripeClienteId ? { stripeClienteId: m.stripeClienteId } : {}),
      ...(m.stripePrecoId ? { stripePrecoId: m.stripePrecoId } : {}),
      ...(m.periodoInicio ? { periodoInicio: m.periodoInicio } : {}),
      ...(m.periodoFim ? { periodoFim: m.periodoFim } : {}),
      ...(m.cancelaNoFimDoPeriodo !== undefined ? { cancelaNoFimDoPeriodo: m.cancelaNoFimDoPeriodo } : {}),
      ...(m.comecouComoTeste || status === "trialing" ? { comecouComoTeste: true } : {}),
      ...(m.pagou && !atual.primeiroPagamentoEm ? { primeiroPagamentoEm: eventoEm } : {}),
      ...(m.temFormaDePagamento !== undefined ? { temFormaDePagamento: m.temFormaDePagamento } : {}),
      // Desde quando o cartão está falhando: marca na entrada em `past_due` (nova tentativa do Stripe não reinicia a conta) e apaga na saída.
      ...(status === "past_due" && atual.status !== "past_due" ? { atrasadaDesde: eventoEm } : {}),
      ...(status !== undefined && status !== "past_due" ? { atrasadaDesde: null } : {}),
      ultimoEventoEm: eventoEm,
      atualizadoEm: new Date(),
    })
    .where(eq(assinaturas.id, atual.id));

  const mudou: Mudou = [];
  if (status === "trialing" && atual.status !== "trialing") mudou.push("teste-comecou");
  if (m.pagou && !atual.primeiroPagamentoEm) mudou.push("assinatura-paga");
  if (status === "past_due" && atual.status !== "past_due") mudou.push("cartao-recusado");
  if (status === "canceled") mudou.push("cancelamento");
  else if (m.cancelaNoFimDoPeriodo === true && !atual.cancelaNoFimDoPeriodo) mudou.push("cancelamento-agendado");
  return { clienteId: atual.clienteId, mudou };
}

/**
 * Trata um evento já conferido (assinatura do aviso verificada por quem chama). `ignorado`: não é nosso ou não é de um tipo que tratamos (nada é gravado, nem o id do
 * evento). `repetido`: o id já estava em `eventos_stripe`. `tratado`: aplicado. Erro de banco sobe (a rota responde 500 e o Stripe reenvia; a transação desfez o id).
 */
export async function tratarEventoDoStripe(evento: EventoDoStripe, enviar: typeof enviarEmail | null = enviarEmail): Promise<ResultadoDoEvento> {
  const leitura = lerEvento(evento);
  if (leitura.tipo === "ignorar") return "ignorado";
  const eventoEm = new Date(evento.created * 1000);

  const feito = await db().transaction(async (tx) => {
    // Os avisos de um cadastro (checkout, assinatura criada, fatura paga) chegam quase juntos e em pedidos diferentes: sem isto, dois deles veem "não existe" ao mesmo tempo, um grava e o
    // outro, que perdeu a corrida, registra o id e some sem aplicar nada. O cadeado é por assinatura e dura até o fim da transação; os avisos da mesma assinatura passam um de cada vez.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${leitura.mudanca.stripeAssinaturaId}))`);
    if (leitura.verificar) {
      const [conhecida] = await tx.select({ id: assinaturas.id }).from(assinaturas).where(eq(assinaturas.stripeAssinaturaId, leitura.mudanca.stripeAssinaturaId));
      if (!conhecida) return { resultado: "ignorado" as const };
    }
    const [novo] = await tx.insert(eventosStripe).values({ eventoId: evento.id, tipo: evento.type }).onConflictDoNothing({ target: eventosStripe.eventoId }).returning({ id: eventosStripe.id });
    if (!novo) return { resultado: "repetido" as const };
    const { clienteId, mudou } = await aplicarMudanca(tx, leitura.mudanca, eventoEm, evento.id);
    return { resultado: "tratado" as const, clienteId, mudou };
  });

  // Os e-mails ao admin saem DEPOIS de a transação fechar e só para evento novo (`repetido` nunca chega aqui): o reenvio do Stripe não duplica o aviso. Falha de e-mail nunca derruba o webhook.
  if (feito.resultado === "tratado" && enviar && feito.clienteId !== null && feito.mudou.length > 0) {
    await avisarOAdmin(feito.clienteId, feito.mudou, enviar);
  }
  return feito.resultado;
}

/** M5 (revisão de 23/11/2026): um e-mail curto por mudança (teste começou, assinatura nova paga, cancelamento, cartão recusado). Só o nome do negócio e o que aconteceu, nenhum dado de cartão. */
async function avisarOAdmin(clienteId: number, mudou: Mudou, enviar: typeof enviarEmail): Promise<void> {
  try {
    const [marca] = await db().select({ nome: clientes.nome }).from(clientes).where(eq(clientes.id, clienteId));
    const para = await destinatariosDoAviso();
    if (!marca || para.length === 0) return;
    for (const tipo of mudou) {
      const assunto = textosAvisoDeCobranca.assunto({ tipo, nomeDaMarca: marca.nome });
      const html = textosAvisoDeCobranca.corpo({ tipo, nomeDaMarca: marca.nome }, `${config.appUrl}/admin`);
      const resultados = await Promise.allSettled(para.map((email) => enviar({ para: email, assunto, html })));
      for (const r of resultados) if (r.status === "rejected") logger.error({ err: r.reason, tipo }, "nao foi possivel enviar o aviso de cobranca ao admin");
    }
  } catch (erro) {
    logger.error({ err: erro, clienteId }, "nao foi possivel montar o aviso de cobranca ao admin");
  }
}

// ---------------------------------------------------------------------------
// O resumo para o admin
// ---------------------------------------------------------------------------

/** O que a lista de Contas do admin mostra da cobrança de cada marca. */
export type ResumoDaCobranca = {
  cortesia: boolean;
  /** O estado da assinatura que conta; nulo se a marca nunca teve uma. */
  assinatura: { status: StatusAssinatura; periodoFim: Date | null; cancelaNoFimDoPeriodo: boolean; vale: boolean } | null;
};

export function resumirCobranca(cortesia: boolean, lista: Assinatura[], agora: Date = new Date()): ResumoDaCobranca {
  const principal = assinaturaPrincipal(lista, agora);
  return {
    cortesia,
    assinatura: principal ? { status: principal.status, periodoFim: principal.periodoFim, cancelaNoFimDoPeriodo: principal.cancelaNoFimDoPeriodo, vale: assinaturaVale(principal, agora) } : null,
  };
}
