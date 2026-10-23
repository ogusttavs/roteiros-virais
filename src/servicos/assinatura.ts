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
import { and, desc, eq, sql } from "drizzle-orm";

import { DIAS_DE_FOLGA_DA_RENOVACAO, METADATA_PRODUTO } from "@/config/assinatura";
import { db } from "@/db";
import { assinaturas, checkoutsStripe, clientes, eventosStripe, membrosMarca, type Assinatura, type Cliente, type StatusAssinatura } from "@/db/schema";
import { config } from "@/lib/config";
import { logger } from "@/lib/log";
import { portaStripe, type EventoDoStripe } from "@/lib/stripe";

/** Erro de regra da assinatura, com a frase que a pessoa pode ler. */
export class ErroAssinatura extends Error {}

// ---------------------------------------------------------------------------
// O portão
// ---------------------------------------------------------------------------

/**
 * A assinatura dá acesso hoje? `active` e `trialing` sim. `past_due` (o cartão falhou e o Stripe está tentando de novo) também: a pessoa não perde o acesso no primeiro
 * cartão recusado, e o Stripe cancela sozinho se não conseguir cobrar. `unpaid`, `canceled`, `incomplete`, `incomplete_expired` e `paused` não. Além do status, o fim do período
 * pago manda: passou do fim mais a folga da renovação (o aviso de renovação pode atrasar), o acesso acaba mesmo que o status ainda diga `active` (aviso perdido).
 * Sem data de fim, vale só o status.
 */
export function assinaturaVale(a: Pick<Assinatura, "status" | "periodoFim">, agora: Date = new Date()): boolean {
  if (a.status !== "active" && a.status !== "trialing" && a.status !== "past_due") return false;
  if (!a.periodoFim) return true;
  const limite = a.periodoFim.getTime() + DIAS_DE_FOLGA_DA_RENOVACAO * 24 * 60 * 60 * 1000;
  return agora.getTime() <= limite;
}

/**
 * O portão em si, puro: a marca precisa assinar quando a cobrança está ligada, ela não é cortesia e nenhuma assinatura dela vale. Desligado, ninguém precisa de nada.
 */
export function precisaAssinarCom(entrada: { cobrancaAtiva: boolean; cortesia: boolean; assinaturas: Pick<Assinatura, "status" | "periodoFim">[]; agora?: Date }): boolean {
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

async function ehDonoDaMarca(usuarioId: string, clienteId: number): Promise<boolean> {
  const [linha] = await db()
    .select({ papel: membrosMarca.papel })
    .from(membrosMarca)
    .where(and(eq(membrosMarca.usuarioId, usuarioId), eq(membrosMarca.clienteId, clienteId)));
  return linha?.papel === "dono";
}

export const frasesDaAssinatura = {
  soODono: "Só quem criou a conta pode assinar. Peça para essa pessoa fazer isto.",
  jaAssinada: "Esta conta já tem uma assinatura ativa.",
  semPlano: "Não deu para abrir o pagamento agora. Tente de novo daqui a pouco.",
  semAssinatura: "Esta conta ainda não tem uma assinatura para gerenciar.",
  falhou: "Não deu para abrir o pagamento agora. Tente de novo daqui a pouco.",
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

  try {
    const porta = portaStripe();
    return await db().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`checkout-da-marca-${cliente.id}`}))`);
      const [aberto] = await tx.select().from(checkoutsStripe).where(eq(checkoutsStripe.clienteId, cliente.id));
      if (aberto) {
        const viva = await porta.sessaoAberta(aberto.stripeSessaoId, cliente.id);
        if (viva) return { url: viva.url };
      }
      const preco = await porta.precoDoPlano(config.cobranca.precoLookupKey);
      if (!preco) {
        logger.error({ clienteId: cliente.id, lookupKey: config.cobranca.precoLookupKey }, "assinatura: o preco do plano nao existe no Stripe (rode scripts/stripe-preparar.ts)");
        throw new ErroAssinatura(frasesDaAssinatura.semPlano);
      }
      const nova = await porta.criarCheckout({
        precoId: preco.id,
        clienteId: cliente.id,
        // Reaproveita o cliente do Stripe de uma assinatura antiga da mesma marca (cartão e histórico já lá).
        stripeClienteId: lista[0]?.stripeClienteId ?? null,
        email: usuario.email,
        urlDeSucesso: `${config.appUrl}/assinar?assinou=1`,
        urlDeCancelar: `${config.appUrl}/assinar`,
      });
      await tx
        .insert(checkoutsStripe)
        .values({ clienteId: cliente.id, stripeSessaoId: nova.sessaoId })
        .onConflictDoUpdate({ target: checkoutsStripe.clienteId, set: { stripeSessaoId: nova.sessaoId, criadoEm: new Date() } });
      return { url: nova.url };
    });
  } catch (erro) {
    if (erro instanceof ErroAssinatura) throw erro;
    logger.error({ err: erro, clienteId: cliente.id }, "assinatura: o Stripe falhou ao criar o Checkout");
    throw new ErroAssinatura(frasesDaAssinatura.falhou);
  }
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
  return { assinaturaIds: lista.filter((a) => !STATUS_ACABADOS.includes(a.status)).map((a) => a.stripeAssinaturaId), sessaoId: aberto?.stripeSessaoId ?? null };
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
    const pago = obj.payment_status === "paid" || obj.payment_status === "no_payment_required";
    return {
      tipo: "tratar",
      verificar: false,
      mudanca: { stripeAssinaturaId, stripeClienteId, clienteId: clienteIdDoAviso(obj.metadata, obj.client_reference_id), statusSeNova: pago ? "active" : "incomplete" },
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
      },
    };
  }

  // invoice.paid e invoice.payment_failed: a assinatura vem no `parent.subscription_details` (API nova) ou direto na fatura (API antiga).
  const detalhes = objeto(objeto(obj.parent)?.subscription_details) ?? objeto(obj.subscription_details);
  const stripeAssinaturaId = idDe(detalhes?.subscription) ?? idDe(obj.subscription);
  if (!stripeAssinaturaId) return { tipo: "ignorar", motivo: "fatura sem assinatura" };
  const metadata = detalhes?.metadata;
  const pago = evento.type === "invoice.paid";
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
      status: pago ? "active" : "past_due",
      // Fatura que falha para uma assinatura que ainda não conhecemos não pode abrir o acesso: só `active` abre, e o `past_due` só vale para quem já era assinante
      // (`soSobreStatus`: uma assinatura ainda `incomplete`, com o primeiro pagamento em curso, não vira `past_due` e ganha acesso).
      statusSeNova: pago ? "active" : "incomplete",
      ...(pago ? {} : { soSobreStatus: ["active", "trialing", "past_due"] as StatusAssinatura[] }),
      ...(pago ? { periodoInicio: dataDeSegundos(periodo?.start), periodoFim: dataDeSegundos(periodo?.end) } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Tratar o evento (banco)
// ---------------------------------------------------------------------------

export type ResultadoDoEvento = "tratado" | "repetido" | "ignorado";

type Executor = Pick<ReturnType<typeof db>, "select" | "insert" | "update" | "execute">;

async function aplicarMudanca(tx: Executor, m: MudancaDeAssinatura, eventoEm: Date, eventoId: string): Promise<void> {
  const [atual] = await tx.select().from(assinaturas).where(eq(assinaturas.stripeAssinaturaId, m.stripeAssinaturaId));

  if (!atual) {
    const stripeClienteId = m.stripeClienteId;
    if (m.clienteId === null || !stripeClienteId) {
      logger.warn({ eventoId, stripeAssinaturaId: m.stripeAssinaturaId }, "stripe: evento nosso, mas sem a marca ou sem o cliente do Stripe; nada gravado");
      return;
    }
    const [marca] = await tx.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, m.clienteId));
    if (!marca) {
      logger.warn({ eventoId, clienteId: m.clienteId }, "stripe: evento nosso aponta para uma marca que nao existe; nada gravado");
      return;
    }
    await tx
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
        ultimoEventoEm: eventoEm,
      })
      .onConflictDoNothing({ target: assinaturas.stripeAssinaturaId });
    return;
  }

  // `canceled` e `incomplete_expired` são finais: reassinar cria OUTRA assinatura no Stripe, nunca reabre a antiga. Um evento atrasado, ou do mesmo segundo, não a ressuscita.
  if (atual.status === "canceled" || atual.status === "incomplete_expired") return;
  // Evento mais velho que o último que escreveu aqui: o mais novo já valeu.
  if (eventoEm.getTime() < atual.ultimoEventoEm.getTime()) return;

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
      ultimoEventoEm: eventoEm,
      atualizadoEm: new Date(),
    })
    .where(eq(assinaturas.id, atual.id));
}

/**
 * Trata um evento já conferido (assinatura do aviso verificada por quem chama). `ignorado`: não é nosso ou não é de um tipo que tratamos (nada é gravado, nem o id do
 * evento). `repetido`: o id já estava em `eventos_stripe`. `tratado`: aplicado. Erro de banco sobe (a rota responde 500 e o Stripe reenvia; a transação desfez o id).
 */
export async function tratarEventoDoStripe(evento: EventoDoStripe): Promise<ResultadoDoEvento> {
  const leitura = lerEvento(evento);
  if (leitura.tipo === "ignorar") return "ignorado";
  const eventoEm = new Date(evento.created * 1000);

  return db().transaction(async (tx) => {
    // Os avisos de um cadastro (checkout, assinatura criada, fatura paga) chegam quase juntos e em pedidos diferentes: sem isto, dois deles veem "não existe" ao mesmo tempo, um grava e o
    // outro, que perdeu a corrida, registra o id e some sem aplicar nada. O cadeado é por assinatura e dura até o fim da transação; os avisos da mesma assinatura passam um de cada vez.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${leitura.mudanca.stripeAssinaturaId}))`);
    if (leitura.verificar) {
      const [conhecida] = await tx.select({ id: assinaturas.id }).from(assinaturas).where(eq(assinaturas.stripeAssinaturaId, leitura.mudanca.stripeAssinaturaId));
      if (!conhecida) return "ignorado" as const;
    }
    const [novo] = await tx.insert(eventosStripe).values({ eventoId: evento.id, tipo: evento.type }).onConflictDoNothing({ target: eventosStripe.eventoId }).returning({ id: eventosStripe.id });
    if (!novo) return "repetido" as const;
    await aplicarMudanca(tx, leitura.mudanca, eventoEm, evento.id);
    return "tratado" as const;
  });
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
