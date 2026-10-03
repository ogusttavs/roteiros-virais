/**
 * O "Não achei o meu" (E45, PR 2): o pedido de ramo que a pessoa faz quando não se acha no catálogo, o ramo provisório em que a marca espera,
 * e o que o admin faz com ele. Regras: nunca setor novo automático (quem decide é o admin); enquanto espera, a marca entra no ramo do catálogo
 * mais próximo do que escreveu, para não ficar sem temas; quando o pedido se resolve, a marca troca de setor e o provisório desliga se ficou
 * sem marca (`desligarSetorSeSemMarca`). Uma marca tem no máximo um pedido aberto (índice único parcial): escrever de novo atualiza o mesmo.
 */
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { clientes, nichos, pedidosDeRamo, type PedidoDeRamo } from "@/db/schema";
import { normalizarBusca, ramoMaisProximo } from "@/lib/buscar-ramo";

import { ErroNicho } from "./nichos";
import { desligarSetorSeSemMarca, ErroLimiteDeSetores, setorParaAMarca } from "./ramos";

/** O que a pessoa escreve cabe em uma ou duas frases; um texto de um milhão de caracteres não vai para o banco nem para a tela do admin. */
const TEXTO_MAXIMO = 300;

function limparTexto(bruto: string): string {
  return bruto.trim().replace(/\s+/g, " ").slice(0, TEXTO_MAXIMO).trim();
}

/** O pedido aberto da marca, se houver. */
export async function pedidoAbertoDaMarca(clienteId: number): Promise<PedidoDeRamo | null> {
  const [pedido] = await db()
    .select()
    .from(pedidosDeRamo)
    .where(and(eq(pedidosDeRamo.clienteId, clienteId), eq(pedidosDeRamo.estado, "aberto")));
  return pedido ?? null;
}

export type ResultadoDoPedido = {
  /** O pedido aberto; ou, se o texto é o de um pedido que o admin já atendeu e a marca segue no setor final, esse pedido (`estado` "atendido", nada mudou). */
  pedido: PedidoDeRamo;
  /** O setor em que a marca está provisoriamente; nulo quando nada casou (e a marca fica onde estava) ou o teto de setores novos do dia segurou. */
  setorProvisorioId: number | null;
  /** O teto de setores novos por dia impediu de criar o setor do palpite: o pedido está aberto do mesmo jeito. */
  limite: boolean;
};

/**
 * A pessoa escreveu o ramo com as palavras dela. Registra (ou atualiza) o pedido aberto e põe a marca no ramo do catálogo mais próximo do texto,
 * criando ou reativando o setor dele (o teto de setores novos por dia vale aqui também). Idempotente: salvar de novo com o mesmo texto não
 * refaz o palpite nem mexe no setor; um texto novo refaz o palpite. Sem palpite (nada casou), a marca fica no setor em que estava (sem setor,
 * se não tinha), e o pedido vai aberto do mesmo jeito.
 */
export async function registrarPedidoDeRamo(clienteId: number, textoBruto: string): Promise<ResultadoDoPedido> {
  const texto = limparTexto(textoBruto);
  if (!texto) throw new ErroNicho("escreva o seu ramo.");

  const [marca] = await db().select({ nichoId: clientes.nichoId }).from(clientes).where(eq(clientes.id, clienteId));
  if (!marca) throw new ErroNicho("marca nao encontrada.");

  const aberto = await pedidoAbertoDaMarca(clienteId);

  // Um formulário velho (o Começar aberto antes de o admin decidir) manda o mesmo texto de um pedido que já foi atendido: se a marca ainda está no
  // setor final, não é um pedido novo, e reabrir desfaria a resolução do admin (o palpite a tiraria do setor que ele escolheu).
  if (aberto === null) {
    const [atendido] = await db()
      .select()
      .from(pedidosDeRamo)
      .where(and(eq(pedidosDeRamo.clienteId, clienteId), eq(pedidosDeRamo.estado, "atendido")))
      .orderBy(desc(pedidosDeRamo.resolvidoEm), desc(pedidosDeRamo.id))
      .limit(1);
    if (atendido && atendido.setorFinalId !== null && atendido.setorFinalId === marca.nichoId && normalizarBusca(atendido.texto) === normalizarBusca(texto)) {
      // O formulário velho já gravou o texto em `ramo_outro` antes de chegar aqui: sem pedido aberto, ele não pode ficar.
      await db().update(clientes).set({ ramoOutro: null }).where(eq(clientes.id, clienteId));
      return { pedido: atendido, setorProvisorioId: null, limite: false };
    }
  }

  const mesmoTexto = aberto !== null && normalizarBusca(aberto.texto) === normalizarBusca(texto);

  let setorProvisorioId = aberto?.setorProvisorioId ?? null;
  let limite = false;
  let nichoIdDaMarca = marca.nichoId;
  if (!mesmoTexto || setorProvisorioId === null) {
    const palpite = ramoMaisProximo(texto);
    if (palpite) {
      try {
        const { nichoId } = await setorParaAMarca(marca.nichoId, palpite.slug);
        setorProvisorioId = nichoId;
        nichoIdDaMarca = nichoId;
      } catch (erro) {
        if (!(erro instanceof ErroLimiteDeSetores)) throw erro;
        limite = true;
      }
    }
  }

  const [pedido] = await db()
    .insert(pedidosDeRamo)
    .values({ clienteId, texto, setorProvisorioId })
    .onConflictDoUpdate({
      target: pedidosDeRamo.clienteId,
      targetWhere: eq(pedidosDeRamo.estado, "aberto"),
      set: { texto, setorProvisorioId },
    })
    .returning();

  await db().update(clientes).set({ ramoOutro: texto, nichoId: nichoIdDaMarca }).where(eq(clientes.id, clienteId));

  // O setor em que a marca estava antes (o provisório do texto de antes, por exemplo) para de ser pesquisado se ficou sem marca.
  if (marca.nichoId && marca.nichoId !== nichoIdDaMarca) await desligarSetorSeSemMarca(marca.nichoId).catch(() => undefined);

  return { pedido, setorProvisorioId, limite };
}

/**
 * A pessoa escolheu um ramo da lista (no Começar ou na Conta) com um pedido aberto: o pedido deixa de valer, e o texto livre também. Quem
 * chama já levou a marca ao setor escolhido; o setor provisório que ficou sem marca é desligado por quem trocou o setor.
 */
export async function cancelarPedidoAberto(clienteId: number): Promise<void> {
  await db()
    .update(pedidosDeRamo)
    .set({ estado: "cancelado", resolvidoEm: new Date() })
    .where(and(eq(pedidosDeRamo.clienteId, clienteId), eq(pedidosDeRamo.estado, "aberto")));
  await db().update(clientes).set({ ramoOutro: null }).where(eq(clientes.id, clienteId));
}

export type PedidoNaLista = {
  id: number;
  texto: string;
  criadoEm: Date;
  marca: { id: number; nome: string };
  /** O setor provisório em que a marca está agora (nulo se nada casou ou a marca já saiu dele). */
  setorProvisorio: { id: number; nome: string } | null;
  /** O setor em que a marca está agora, quando não é o provisório (a marca que já tinha ramo continua nele enquanto o pedido espera). */
  ramoAtual: { id: number; nome: string } | null;
};

/** Os pedidos abertos, do mais antigo para o mais novo, com a marca e o setor provisório (para a lista do admin). */
export async function listarPedidosAbertos(): Promise<PedidoNaLista[]> {
  const linhas = await db()
    .select({
      id: pedidosDeRamo.id,
      texto: pedidosDeRamo.texto,
      criadoEm: pedidosDeRamo.criadoEm,
      marcaId: clientes.id,
      marcaNome: clientes.nome,
      marcaNichoId: clientes.nichoId,
      setorProvisorioId: pedidosDeRamo.setorProvisorioId,
    })
    .from(pedidosDeRamo)
    .innerJoin(clientes, eq(clientes.id, pedidosDeRamo.clienteId))
    .where(eq(pedidosDeRamo.estado, "aberto"))
    .orderBy(asc(pedidosDeRamo.criadoEm), asc(pedidosDeRamo.id));

  const nomes = new Map<number, string>();
  const ids = [...new Set(linhas.flatMap((l) => [l.setorProvisorioId, l.marcaNichoId]).filter((id): id is number => id !== null))];
  if (ids.length > 0) {
    const setores = await db().select({ id: nichos.id, nome: nichos.nome }).from(nichos).where(inArray(nichos.id, ids));
    for (const setor of setores) nomes.set(setor.id, setor.nome);
  }

  return linhas.map((l) => ({
    id: l.id,
    texto: l.texto,
    criadoEm: l.criadoEm,
    marca: { id: l.marcaId, nome: l.marcaNome },
    setorProvisorio:
      l.setorProvisorioId !== null && l.marcaNichoId === l.setorProvisorioId && nomes.has(l.setorProvisorioId)
        ? { id: l.setorProvisorioId, nome: nomes.get(l.setorProvisorioId)! }
        : null,
    ramoAtual:
      l.marcaNichoId !== null && l.marcaNichoId !== l.setorProvisorioId && nomes.has(l.marcaNichoId)
        ? { id: l.marcaNichoId, nome: nomes.get(l.marcaNichoId)! }
        : null,
  }));
}

/** Quantos pedidos esperam o admin (o número ao lado de "Nichos"). */
export async function contarPedidosAbertos(): Promise<number> {
  const [linha] = await db().select({ total: count() }).from(pedidosDeRamo).where(eq(pedidosDeRamo.estado, "aberto"));
  return linha?.total ?? 0;
}

async function pedidoAbertoPorId(pedidoId: number): Promise<PedidoDeRamo> {
  const [pedido] = await db()
    .select()
    .from(pedidosDeRamo)
    .where(and(eq(pedidosDeRamo.id, pedidoId), eq(pedidosDeRamo.estado, "aberto")));
  if (!pedido) throw new ErroNicho("esse pedido ja foi resolvido ou nao existe.");
  return pedido;
}

/** Leva a marca ao setor, fecha o pedido, e desliga o setor provisório (e o de antes) se ficou sem marca. */
/** Exportada para o teste da corrida (o pedido some entre a conferência e o fechamento); fora disso só este arquivo a chama. */
export async function fecharPedidoComSetor(pedido: PedidoDeRamo, nichoId: number, resolucao: "encaixado" | "ramo_criado"): Promise<void> {
  const [marca] = await db().select({ nichoId: clientes.nichoId }).from(clientes).where(eq(clientes.id, pedido.clienteId));
  await db().transaction(async (tx) => {
    await tx.update(clientes).set({ nichoId, ramoOutro: null }).where(eq(clientes.id, pedido.clienteId));
    const [fechado] = await tx
      .update(pedidosDeRamo)
      .set({ estado: "atendido", resolucao, setorFinalId: nichoId, resolvidoEm: new Date() })
      .where(and(eq(pedidosDeRamo.id, pedido.id), eq(pedidosDeRamo.estado, "aberto")))
      .returning({ id: pedidosDeRamo.id });
    // Numa corrida com a pessoa escolhendo da lista (o pedido foi cancelado entre a conferência e aqui), a marca não é movida: desfaz tudo.
    if (!fechado) throw new ErroNicho("esse pedido ja foi resolvido ou nao existe.");
  });
  for (const antigo of new Set([marca?.nichoId, pedido.setorProvisorioId])) {
    if (antigo && antigo !== nichoId) await desligarSetorSeSemMarca(antigo).catch(() => undefined);
  }
}

/**
 * "Encaixar em um que existe" (admin): a marca vai para o setor do ramo escolhido (que nasce ou volta, se preciso: o teto de setores novos do
 * dia vale), o pedido fecha como encaixado, e o setor provisório desliga se ficou sem marca.
 */
export async function encaixarPedido(pedidoId: number, slugDoRamo: string): Promise<void> {
  const pedido = await pedidoAbertoPorId(pedidoId);
  const [marca] = await db().select({ nichoId: clientes.nichoId }).from(clientes).where(eq(clientes.id, pedido.clienteId));
  const { nichoId } = await setorParaAMarca(marca?.nichoId ?? null, slugDoRamo);
  await fecharPedidoComSetor(pedido, nichoId, "encaixado");
}

/** O pedido ainda está aberto? Quem cria o setor novo do pedido confere antes de criar (um setor criado sem pedido para fechar seria lixo). */
export async function conferirPedidoAberto(pedidoId: number): Promise<PedidoDeRamo> {
  return pedidoAbertoPorId(pedidoId);
}

/** "Criar ramo" (admin), depois de o setor novo existir: a marca vai para ele e o pedido fecha como ramo criado. */
export async function resolverPedidoComSetorNovo(pedidoId: number, nichoId: number): Promise<void> {
  const pedido = await pedidoAbertoPorId(pedidoId);
  await fecharPedidoComSetor(pedido, nichoId, "ramo_criado");
}
