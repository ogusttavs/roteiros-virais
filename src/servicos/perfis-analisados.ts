/**
 * E38, partes 2 e 3 ("o contexto da marca"): a leitura do que a API de verdade mostra de cada
 * perfil citado pelo cliente ou da própria marca, e o que o admin vê para decidir se um perfil
 * vira conta vigiada do setor. A conferência e a análise em si (`confirmarYoutube`,
 * `confirmarInstagram`, a tarefa de IA) moram em `src/jobs/analisar-perfil.ts`, camada que fala
 * com API externa; aqui só leitura do banco e o disparo do job, como todo serviço do projeto.
 */
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { clientes, perfisAnalisados, perfisCitados, type PerfisCliente } from "@/db/schema";

import { FILAS, boss, garantirBossPronto } from "../jobs/fila";

export type PerfilAnalisado = typeof perfisAnalisados.$inferSelect;
/** `tipoCitado` só preenchido quando `origem === "citado"` (join com `perfisCitados`); a tela
 * usa para o rótulo certo ("concorrente citado" ou "perfil que você admira"). */
export type PerfilAnalisadoComTipo = PerfilAnalisado & { tipoCitado: "concorrente" | "admira" | null };

/** Para o briefing (seção própria) e para o prompt do roteiro (evidência exclusiva). */
export async function leiturasDoCliente(clienteId: number): Promise<PerfilAnalisadoComTipo[]> {
  const linhas = await db()
    .select({ perfil: perfisAnalisados, tipoCitado: perfisCitados.tipo })
    .from(perfisAnalisados)
    .leftJoin(perfisCitados, eq(perfisCitados.id, perfisAnalisados.perfilCitadoId))
    .where(eq(perfisAnalisados.clienteId, clienteId));
  return linhas.map((l) => ({ ...l.perfil, tipoCitado: l.tipoCitado ?? null }));
}

/** Admin do setor (parte 3): perfis indicados por clientes deste nicho, que passaram na régua e
 * ainda não viraram conta. */
export async function listarPerfisIndicados(
  nichoId: number,
): Promise<(PerfilAnalisado & { clienteNome: string })[]> {
  const linhas = await db()
    .select({ perfil: perfisAnalisados, clienteNome: clientes.nome })
    .from(perfisAnalisados)
    .innerJoin(clientes, eq(clientes.id, perfisAnalisados.clienteId))
    .where(
      and(
        eq(clientes.nichoId, nichoId),
        eq(perfisAnalisados.qualificaParaSetor, true),
        isNull(perfisAnalisados.viraDoSetorEm),
      ),
    );
  return linhas.map((l) => ({ ...l.perfil, clienteNome: l.clienteNome }));
}

/** Dispara a análise de um perfil citado, sem esperar (mesmo padrão de `resolverMetaIgId` em
 * `salvarPerfilConta`: enfileirar é rápido, a conferência na API pode não ser). */
export async function enfileirarAnaliseDePerfil(clienteId: number, perfilCitadoId: number): Promise<void> {
  const [citado] = await db().select().from(perfisCitados).where(eq(perfisCitados.id, perfilCitadoId));
  if (!citado) return;
  await garantirBossPronto();
  await boss().send(FILAS.analisarPerfil, {
    clienteId,
    perfilCitadoId,
    origem: "citado",
    tipoCitado: citado.tipo,
    rede: citado.rede,
    handle: citado.handle,
  });
}

/** Dispara a análise de cada rede preenchida em `clientes.perfis` (o perfil da própria marca). */
export async function enfileirarAnaliseDaPropriaMarca(clienteId: number, perfis: PerfisCliente): Promise<void> {
  const redes: { rede: "instagram" | "youtube"; handle: string | null }[] = [
    { rede: "instagram", handle: perfis.instagram },
    { rede: "youtube", handle: perfis.youtube },
  ];
  if (!redes.some((r) => r.handle)) return;
  await garantirBossPronto();
  for (const { rede, handle } of redes) {
    if (!handle) continue;
    await boss().send(FILAS.analisarPerfil, {
      clienteId,
      perfilCitadoId: null,
      origem: "propria_marca",
      tipoCitado: null,
      rede,
      handle,
    });
  }
}
