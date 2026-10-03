/**
 * Os ramos alternativos de uma marca (E45, PR 3): `clientes.nicho_id` é o ramo principal (os temas do dia vêm só dele) e esta tabela guarda
 * até dois alternativos, que SÓ o admin liga e desliga (decisão do Gustavo de 02/10/2026). Eles entram no tema livre, nas Referências e na
 * evidência do roteiro; nunca nos temas do dia. Ter um alternativo ligado conta como "ter marca" para o setor: ele não é desligado enquanto
 * houver quem o use (`desligarSetorSeSemMarca`), e ligar um alternativo a um setor parado o reativa.
 */
import { and, asc, count, eq, ne, sql } from "drizzle-orm";

import { ramoPorSlug } from "@/config/ramos";
import { db } from "@/db";
import { clientes, nichos, ramosDaConta } from "@/db/schema";
import { MAXIMO_DE_RAMOS_ALTERNATIVOS } from "@/lib/ramos-alternativos";

import { ErroNicho } from "./nichos";
import { desligarSetorSeSemMarca, garantirNichoDoRamo, nichoDoRamo } from "./ramos";

export { MAXIMO_DE_RAMOS_ALTERNATIVOS };

/** Um erro que o admin lê em frase: o terceiro ramo, o ramo repetido, o ramo que a marca já tem. */
export class ErroRamosDaConta extends ErroNicho {}

export type RamoAlternativo = {
  /** O id da linha em `ramos_da_conta` (o que "tirar" recebe). */
  id: number;
  nichoId: number;
  nome: string;
  ramoSlug: string | null;
  ligadoEm: Date;
};

/** Os ramos alternativos ligados à marca, do mais antigo para o mais novo. */
export async function ramosAlternativosDaMarca(clienteId: number): Promise<RamoAlternativo[]> {
  const linhas = await db()
    .select({
      id: ramosDaConta.id,
      nichoId: ramosDaConta.nichoId,
      nome: nichos.nome,
      ramoCatalogo: nichos.ramoCatalogo,
      ligadoEm: ramosDaConta.ligadoEm,
    })
    .from(ramosDaConta)
    .innerJoin(nichos, eq(nichos.id, ramosDaConta.nichoId))
    .innerJoin(clientes, eq(clientes.id, ramosDaConta.clienteId))
    // Um alternativo que virou o ramo principal (a marca trocou de ramo depois de o admin ligá-lo) deixa de contar: nunca aparece duas vezes.
    .where(and(eq(ramosDaConta.clienteId, clienteId), ne(ramosDaConta.nichoId, sql`coalesce(${clientes.nichoId}, -1)`)))
    .orderBy(asc(ramosDaConta.ligadoEm), asc(ramosDaConta.id));
  return linhas.map((l) => ({
    id: l.id,
    nichoId: l.nichoId,
    nome: ramoPorSlug(l.ramoCatalogo)?.nome ?? l.nome,
    ramoSlug: ramoPorSlug(l.ramoCatalogo)?.slug ?? null,
    ligadoEm: l.ligadoEm,
  }));
}

async function contarLinhasDaMarca(clienteId: number): Promise<number> {
  const [linha] = await db().select({ total: count() }).from(ramosDaConta).where(eq(ramosDaConta.clienteId, clienteId));
  return linha?.total ?? 0;
}

/**
 * O ramo alternativo que a marca escolheu como principal sai da tabela (quem chama é todo caminho que troca `clientes.nicho_id`: o Começar, a
 * Conta, o palpite do "Não achei o meu" e o admin que resolve o pedido). Sem isto a linha ficava parada, escondida, e reaparecia como alternativo,
 * com o custo de pesquisa junto, na troca de principal seguinte. Nunca derruba a troca de quem chama.
 */
export async function tirarAlternativoQueViraPrincipal(clienteId: number, nichoIdNovo: number | null | undefined): Promise<void> {
  if (!nichoIdNovo) return;
  await db()
    .delete(ramosDaConta)
    .where(and(eq(ramosDaConta.clienteId, clienteId), eq(ramosDaConta.nichoId, nichoIdNovo)))
    .catch(() => undefined);
}

/**
 * Os setores da conta, o principal primeiro: o que o tema livre, as Referências e a evidência do roteiro olham. Sem ramo principal, só os
 * alternativos (o admin liga alternativo a quem já tem principal, mas o dado pode ter ficado assim se o principal mudou depois).
 */
export async function setoresDaConta(clienteId: number, nichoIdPrincipal: number | null): Promise<number[]> {
  const alternativos = await ramosAlternativosDaMarca(clienteId);
  const ids = nichoIdPrincipal ? [nichoIdPrincipal] : [];
  for (const alt of alternativos) if (!ids.includes(alt.nichoId)) ids.push(alt.nichoId);
  return ids;
}

export type PreviaDeLigarRamo = {
  /** `pesquisado`: o setor já existe e está ligado (outra marca o usa), sem custo novo; `comeca`: parado ou inexistente, passa a ser pesquisado hoje. */
  estado: "pesquisado" | "comeca";
  nome: string;
};

/** O que acontece se o admin ligar este ramo: o setor já é pesquisado ou vai começar a ser (e custar por dia). Só lê. */
export async function previaDeLigarRamo(slugDoRamo: string): Promise<PreviaDeLigarRamo> {
  const ramo = ramoPorSlug(slugDoRamo);
  if (!ramo) throw new ErroRamosDaConta("Ramo desconhecido.");
  const setor = await nichoDoRamo(slugDoRamo);
  return { estado: setor?.ativo ? "pesquisado" : "comeca", nome: ramo.nome };
}

/**
 * O admin liga um ramo do catálogo como alternativo da marca. Recusa em frase: a marca sem ramo principal, o ramo que ela já tem como
 * principal, o ramo já ligado, e o terceiro (o máximo é dois). O setor do ramo nasce ou volta (a pesquisa começa; o teto de setores novos do
 * dia vale e lança `ErroLimiteDeSetores`, que a ação transforma em frase). Devolve a linha criada.
 */
export async function ligarRamoAlternativo(clienteId: number, slugDoRamo: string, usuarioId: string): Promise<RamoAlternativo> {
  const ramo = ramoPorSlug(slugDoRamo);
  if (!ramo) throw new ErroRamosDaConta("Ramo desconhecido.");

  const [marca] = await db().select({ nichoId: clientes.nichoId }).from(clientes).where(eq(clientes.id, clienteId));
  if (!marca) throw new ErroRamosDaConta("Marca não encontrada.");
  if (!marca.nichoId) throw new ErroRamosDaConta("A marca ainda não tem ramo principal; escolha o principal antes de ligar outro.");
  const [principal] = await db().select({ ramoCatalogo: nichos.ramoCatalogo }).from(nichos).where(eq(nichos.id, marca.nichoId));
  if (principal?.ramoCatalogo === slugDoRamo) throw new ErroRamosDaConta("Esse já é o ramo principal da marca.");

  // Linhas paradas de antes (o alternativo que a marca já escolheu como principal) saem aqui, antes de contar o teto.
  await tirarAlternativoQueViraPrincipal(clienteId, marca.nichoId);
  const ligados = await ramosAlternativosDaMarca(clienteId);
  if (ligados.some((l) => l.ramoSlug === slugDoRamo)) throw new ErroRamosDaConta("Esse ramo já está ligado à marca.");
  // O teto conta as LINHAS da tabela, não só as visíveis: uma linha que ficou parada (o alternativo virou principal e a marca trocou de novo) conta até sair.
  if ((await contarLinhasDaMarca(clienteId)) >= MAXIMO_DE_RAMOS_ALTERNATIVOS) {
    throw new ErroRamosDaConta(`A marca já tem ${MAXIMO_DE_RAMOS_ALTERNATIVOS} ramos alternativos; tire um antes de ligar outro.`);
  }

  const { nicho } = await garantirNichoDoRamo(slugDoRamo);
  const [linha] = await db()
    .insert(ramosDaConta)
    .values({ clienteId, nichoId: nicho.id, ligadoPorUsuarioId: usuarioId })
    .onConflictDoNothing()
    .returning();
  if (!linha) throw new ErroRamosDaConta("Esse ramo já está ligado à marca.");

  // Duas ligações ao mesmo tempo passariam as duas pela conferência acima: a que passou do máximo se desfaz.
  const depois = await ramosAlternativosDaMarca(clienteId);
  if (depois.length > MAXIMO_DE_RAMOS_ALTERNATIVOS) {
    await db().delete(ramosDaConta).where(eq(ramosDaConta.id, linha.id));
    // O setor que `garantirNichoDoRamo` acabou de criar ou reativar não fica ligado sem marca.
    await desligarSetorSeSemMarca(nicho.id).catch(() => undefined);
    throw new ErroRamosDaConta(`A marca já tem ${MAXIMO_DE_RAMOS_ALTERNATIVOS} ramos alternativos; tire um antes de ligar outro.`);
  }
  return { id: linha.id, nichoId: nicho.id, nome: ramo.nome, ramoSlug: ramo.slug, ligadoEm: linha.ligadoEm };
}

/** O admin tira um ramo alternativo da marca; o setor que ficou sem marca (nem principal nem alternativo) para de ser pesquisado. */
export async function tirarRamoAlternativo(clienteId: number, ramoDaContaId: number): Promise<void> {
  const [removida] = await db()
    .delete(ramosDaConta)
    .where(and(eq(ramosDaConta.id, ramoDaContaId), eq(ramosDaConta.clienteId, clienteId)))
    .returning({ nichoId: ramosDaConta.nichoId });
  if (!removida) throw new ErroRamosDaConta("Esse ramo já foi tirado ou não é desta marca.");
  await desligarSetorSeSemMarca(removida.nichoId).catch(() => undefined);
}
