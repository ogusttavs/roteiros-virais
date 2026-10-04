import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { ramoPorSlug } from "@/config/ramos";
import { db } from "@/db";
import { alteracoesDoAdmin, type AlteracaoDoAdmin, briefings, clientes, membrosMarca, nichos, roteiros, session, user, type TipoMarca } from "@/db/schema";
import { hojeISO } from "@/lib/config";
import { diasDoPeriodo } from "@/servicos/admin-acompanhamento";
import { listarClientesAdmin, type ClienteAdmin } from "@/servicos/admin-coleta";

/** O que a conta fez em um dia (E46 PR 1, `AdminClientes.dc.html`): gravou, gerou roteiro, só entrou, ou nada. Vale o mais forte do dia. */
export type EstadoDoDia = "gravou" | "gerou" | "entrou" | "nada";

/** "Parou": nada por este tanto de dias seguidos; "Usando": gravou em algum dos últimos dias abaixo (decisão do desenho, dúvida 4 do passo 15). */
export const DIAS_PARA_PARAR = 4;
export const DIAS_PARA_USANDO = 3;
/** A nota mínima do briefing (CLAUDE.md: "Nota mínima 8 no briefing"). */
export const NOTA_MINIMA_DO_BRIEFING = 8;

export type PessoaDaConta = { usuarioId: string; nome: string; email: string; papel: string; ultimoAcessoEm: Date | null };

export type ContaAdmin = ClienteAdmin & {
  tipo: TipoMarca;
  /** O nome do ramo (do catálogo, quando há); nulo se a conta ainda não tem setor. */
  ramoNome: string | null;
  quemTemAcesso: PessoaDaConta[];
  /** O estado do briefing para a lista: sem ele, incompleto (quantas das 12 respondidas), completo com a nota acima ou abaixo do mínimo. */
  briefingEstado: { tipo: "sem" } | { tipo: "incompleto"; respondidas: number } | { tipo: "pronto"; nota: number; abaixo: boolean };
  ultimos7: { dia: string; estado: EstadoDoDia }[];
  /** Ninguém da conta abriu o aplicativo até hoje. */
  nuncaEntrou: boolean;
  usando: boolean;
  parou: boolean;
};

const ORDEM: Record<EstadoDoDia, number> = { nada: 0, entrou: 1, gerou: 2, gravou: 3 };

function maisForte(a: EstadoDoDia, b: EstadoDoDia): EstadoDoDia {
  return ORDEM[a] >= ORDEM[b] ? a : b;
}

/**
 * Os sete dias de cada conta, do mais antigo ao de hoje. Pura, para provar sem banco: `roteirosPorDia` diz, por dia, se houve roteiro e se algum foi gravado ou
 * postado; `entrouNoDia` são os dias em que alguém da conta abriu o aplicativo.
 */
export function estadosDosDias(dias: string[], roteirosPorDia: Map<string, { gravado: boolean }>, entrouNoDia: Set<string>): { dia: string; estado: EstadoDoDia }[] {
  return dias.map((dia) => {
    let estado: EstadoDoDia = "nada";
    if (entrouNoDia.has(dia)) estado = maisForte(estado, "entrou");
    const r = roteirosPorDia.get(dia);
    if (r) estado = maisForte(estado, r.gravado ? "gravou" : "gerou");
    return { dia, estado };
  });
}

/** "Usando": gravou em algum dos últimos 3 dias. "Parou": os últimos 4 dias sem nada (nem entrar). */
export function classificarUso(ultimos7: { estado: EstadoDoDia }[]): { usando: boolean; parou: boolean } {
  const usando = ultimos7.slice(-DIAS_PARA_USANDO).some((d) => d.estado === "gravou");
  const parou = ultimos7.length >= DIAS_PARA_PARAR && ultimos7.slice(-DIAS_PARA_PARAR).every((d) => d.estado === "nada");
  return { usando, parou };
}

function diaDoBrasil(coluna: unknown) {
  return sql<string>`to_char((${coluna} at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD')`;
}

/** Quem tem acesso a cada conta, com o e-mail (a lista de Contas busca por conta e por pessoa; uma pessoa em duas contas aparece nas duas). */
async function pessoasPorConta(clienteId?: number): Promise<Map<number, PessoaDaConta[]>> {
  const linhas = await db()
    .select({ clienteId: membrosMarca.clienteId, usuarioId: user.id, nome: user.name, email: user.email, papel: membrosMarca.papel, ultimoAcessoEm: membrosMarca.ultimoAcessoEm })
    .from(membrosMarca)
    .innerJoin(user, eq(user.id, membrosMarca.usuarioId))
    .where(clienteId === undefined ? undefined : eq(membrosMarca.clienteId, clienteId))
    .orderBy(membrosMarca.criadoEm);
  const mapa = new Map<number, PessoaDaConta[]>();
  for (const { clienteId, ...pessoa } of linhas) mapa.set(clienteId, [...(mapa.get(clienteId) ?? []), pessoa]);
  return mapa;
}

/** Quem tem acesso a uma conta, com a última vez que cada pessoa abriu o aplicativo nela. */
export async function pessoasDaConta(clienteId: number): Promise<PessoaDaConta[]> {
  return (await pessoasPorConta(clienteId)).get(clienteId) ?? [];
}

/** A lista de Contas do admin (E46 PR 1): a de hoje com o tipo, o ramo, as pessoas e os últimos 7 dias. */
export async function listarContasAdmin(agora: Date = new Date()): Promise<ContaAdmin[]> {
  const base = await listarClientesAdmin();
  const dias = diasDoPeriodo(7, agora);
  const desde = new Date(agora.getTime() - 8 * 24 * 60 * 60 * 1000);

  const [detalhes, pessoas, roteirosDosDias, sessoes, briefingsDeTodos] = await Promise.all([
    db()
      .select({ id: clientes.id, tipo: clientes.tipo, ultimoAcessoEm: clientes.ultimoAcessoEm, ramoCatalogo: nichos.ramoCatalogo, nichoNome: nichos.nome })
      .from(clientes)
      .leftJoin(nichos, eq(nichos.id, clientes.nichoId)),
    pessoasPorConta(),
    db()
      .select({
        clienteId: roteiros.clienteId,
        dia: roteiros.data,
        gravado: sql<boolean>`bool_or(${roteiros.status} in ('gravado','postado'))`,
      })
      .from(roteiros)
      .where(gte(roteiros.data, dias[0]))
      .groupBy(roteiros.clienteId, roteiros.data),
    db()
      .select({ usuarioId: session.userId, dia: diaDoBrasil(session.updatedAt) })
      .from(session)
      .where(gte(session.updatedAt, desde))
      .groupBy(session.userId, diaDoBrasil(session.updatedAt)),
    db().select({ clienteId: briefings.clienteId, completo: briefings.completo, nota: briefings.notaGeral, respostas: briefings.respostas }).from(briefings),
  ]);

  const roteirosPorConta = new Map<number, Map<string, { gravado: boolean }>>();
  for (const r of roteirosDosDias) {
    const mapa = roteirosPorConta.get(r.clienteId) ?? new Map<string, { gravado: boolean }>();
    mapa.set(r.dia, { gravado: r.gravado });
    roteirosPorConta.set(r.clienteId, mapa);
  }
  const diasDeSessaoPorPessoa = new Map<string, Set<string>>();
  for (const s of sessoes) diasDeSessaoPorPessoa.set(s.usuarioId, (diasDeSessaoPorPessoa.get(s.usuarioId) ?? new Set()).add(s.dia));
  const todasAsPessoas = [...new Set([...pessoas.values()].flat().map((p) => p.usuarioId))];
  const sessaoAlgumaVez = new Set(
    todasAsPessoas.length === 0 ? [] : (await db().selectDistinct({ usuarioId: session.userId }).from(session).where(inArray(session.userId, todasAsPessoas))).map((s) => s.usuarioId),
  );

  return base.map((conta) => {
    const detalhe = detalhes.find((d) => d.id === conta.id);
    const gente = pessoas.get(conta.id) ?? [];
    const entrouNoDia = new Set<string>();
    for (const p of gente) {
      for (const dia of diasDeSessaoPorPessoa.get(p.usuarioId) ?? []) entrouNoDia.add(dia);
      if (p.ultimoAcessoEm) entrouNoDia.add(hojeISO(p.ultimoAcessoEm));
    }
    if (detalhe?.ultimoAcessoEm) entrouNoDia.add(hojeISO(detalhe.ultimoAcessoEm));
    const ultimos7 = estadosDosDias(dias, roteirosPorConta.get(conta.id) ?? new Map(), entrouNoDia);
    const b = briefingsDeTodos.find((x) => x.clienteId === conta.id);
    const respondidas = b ? Object.values(b.respostas).filter((r) => typeof r === "string" && r.trim().length > 0).length : 0;
    const briefingEstado: ContaAdmin["briefingEstado"] =
      !b || (!b.completo && respondidas === 0) ? { tipo: "sem" } : b.completo && b.nota !== null ? { tipo: "pronto", nota: Number(b.nota), abaixo: Number(b.nota) < NOTA_MINIMA_DO_BRIEFING } : { tipo: "incompleto", respondidas };
    const ramo = ramoPorSlug(detalhe?.ramoCatalogo ?? null);
    return {
      ...conta,
      tipo: detalhe?.tipo ?? "negocio",
      ramoNome: ramo?.nome ?? detalhe?.nichoNome ?? null,
      quemTemAcesso: gente,
      briefingEstado,
      ultimos7,
      nuncaEntrou: !detalhe?.ultimoAcessoEm && gente.every((p) => !p.ultimoAcessoEm && !sessaoAlgumaVez.has(p.usuarioId)),
      ...classificarUso(ultimos7),
    };
  });
}

// ---------------------------------------------------------------------------
// O registro das trocas do admin
// ---------------------------------------------------------------------------

export type CampoAlterado = "ramo" | "tipo" | "rede_principal" | "publico" | "roteiros_por_dia";

/** Acrescenta uma linha ao registro (quem, o quê, quando). Nunca derruba a troca de quem chama: a troca já valeu, o registro que falhar deixa rastro no log. */
export async function registrarAlteracao(dado: { clienteId: number; porUsuarioId: string | null; campo: CampoAlterado; antes: string | null; depois: string | null }): Promise<void> {
  await db().insert(alteracoesDoAdmin).values(dado);
}

export type AlteracaoComNome = AlteracaoDoAdmin & { porNome: string | null };

/** As últimas trocas do admin numa conta, da mais nova para a mais antiga. */
export async function alteracoesDaConta(clienteId: number, limite = 10): Promise<AlteracaoComNome[]> {
  const linhas = await db()
    .select({ alteracao: alteracoesDoAdmin, porNome: user.name })
    .from(alteracoesDoAdmin)
    .leftJoin(user, eq(user.id, alteracoesDoAdmin.porUsuarioId))
    .where(eq(alteracoesDoAdmin.clienteId, clienteId))
    .orderBy(desc(alteracoesDoAdmin.em), desc(alteracoesDoAdmin.id))
    .limit(limite);
  return linhas.map((l) => ({ ...l.alteracao, porNome: l.porNome }));
}

/** O que a conta fez nos últimos 14 dias, dia a dia (roteiros escritos, gravados, postados), para a tabela "Dia a dia" da página da conta. */
export async function usoDosUltimosDias(clienteId: number, quantos = 14, agora: Date = new Date()): Promise<{ dia: string; escritos: number; gravados: number; postados: number }[]> {
  const dias = diasDoPeriodo(quantos, agora);
  const linhas = await db()
    .select({ dia: roteiros.data, status: roteiros.status, total: sql<number>`count(*)::int` })
    .from(roteiros)
    .where(and(eq(roteiros.clienteId, clienteId), gte(roteiros.data, dias[0])))
    .groupBy(roteiros.data, roteiros.status);
  return dias.map((dia) => {
    const doDia = linhas.filter((l) => l.dia === dia);
    const soma = (f: (s: string) => boolean) => doDia.filter((l) => f(l.status)).reduce((a, l) => a + l.total, 0);
    return { dia, escritos: soma(() => true), gravados: soma((s) => s === "gravado" || s === "postado"), postados: soma((s) => s === "postado") };
  });
}
