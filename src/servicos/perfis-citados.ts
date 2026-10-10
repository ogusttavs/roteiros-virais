/**
 * Concorrentes e perfis admirados citados pelo cliente, em campos de @
 * (V12c, item 7, a E37b): substitui o texto solto que a pessoa digitava na
 * P12. Nesta etapa só guarda e mostra (sem conferir na API nem analisar,
 * isso é a E38). Isolado por cliente, como todo serviço deste projeto.
 */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { perfisCitados, type Plataforma, type TipoPerfilCitado } from "@/db/schema";
import { limparCampoPerfil } from "@/lib/perfil-redes";

import { enfileirarAnaliseDePerfil } from "./perfis-analisados";

export class ErroPerfilCitado extends Error {}

const LIMITE_POR_LISTA = 10;

export type PerfilCitado = typeof perfisCitados.$inferSelect;

/** Os dois tipos, sempre juntos: a tela mostra as duas listas lado a lado. */
export async function perfisCitadosDoCliente(
  clienteId: number,
): Promise<{ concorrentes: PerfilCitado[]; admira: PerfilCitado[] }> {
  const linhas = await db()
    .select()
    .from(perfisCitados)
    .where(eq(perfisCitados.clienteId, clienteId))
    .orderBy(asc(perfisCitados.criadoEm));

  return {
    concorrentes: linhas.filter((l) => l.tipo === "concorrente"),
    admira: linhas.filter((l) => l.tipo === "admira"),
  };
}

const adicionarSchema = z.object({
  rede: z.enum(["instagram", "tiktok", "youtube"]),
  handle: z.string().trim().min(1),
});

/**
 * "Nunca pedir link" (item 7): `bruto` pode ser o que a pessoa colou, do
 * jeito que veio do campo (`CampoPerfilRede` já limpa ao digitar, mas a
 * gravação confere de novo, mesma defesa de `dadosFixosSchema` com `site`).
 * Até `LIMITE_POR_LISTA` por tipo; item igual (mesma rede e handle já
 * normalizado) não duplica, só não faz nada (idempotente a um duplo toque).
 */
export async function adicionarPerfilCitado(
  clienteId: number,
  tipo: TipoPerfilCitado,
  dadosBrutos: unknown,
): Promise<PerfilCitado> {
  // O tipo chega como texto livre do navegador e é a chave do teto de dez por lista: com um tipo qualquer o teto sumia, e cada linha nova enfileira uma análise (Meta, YouTube e uma chamada de IA).
  if (tipo !== "concorrente" && tipo !== "admira") throw new ErroPerfilCitado("tipo de perfil invalido.");
  const dados = adicionarSchema.parse(dadosBrutos);
  const handle = limparCampoPerfil(dados.handle, dados.rede);
  if (!handle) throw new ErroPerfilCitado("escreva o nome do perfil.");

  const atuais = await db()
    .select({ id: perfisCitados.id })
    .from(perfisCitados)
    .where(and(eq(perfisCitados.clienteId, clienteId), eq(perfisCitados.tipo, tipo)));
  if (atuais.length >= LIMITE_POR_LISTA) {
    throw new ErroPerfilCitado(`até ${LIMITE_POR_LISTA} perfis nesta lista.`);
  }

  const [linha] = await db()
    .insert(perfisCitados)
    .values({ clienteId, tipo, rede: dados.rede, handle })
    .onConflictDoNothing()
    .returning();

  if (linha) {
    // E38, partes 2 e 3: a conferência na API pode demorar; a tela não espera por ela.
    void enfileirarAnaliseDePerfil(clienteId, linha.id).catch(() => undefined);
    return linha;
  }

  // onConflictDoNothing: ja existia esse mesmo cliente+tipo+rede+handle; devolve a linha de verdade.
  const [existente] = await db()
    .select()
    .from(perfisCitados)
    .where(
      and(
        eq(perfisCitados.clienteId, clienteId),
        eq(perfisCitados.tipo, tipo),
        eq(perfisCitados.rede, dados.rede),
        eq(perfisCitados.handle, handle),
      ),
    );
  if (!existente) throw new ErroPerfilCitado("nao foi possivel salvar o perfil.");
  return existente;
}

/** Isolado por cliente: só remove quando a linha é mesmo deste cliente. */
export async function removerPerfilCitado(id: number, clienteId: number): Promise<void> {
  await db().delete(perfisCitados).where(and(eq(perfisCitados.id, id), eq(perfisCitados.clienteId, clienteId)));
}

/** Para o perfil compilado (item 8): só o handle com @ (sem analisar, sem conferir). */
export function formatarPerfilComArroba(perfil: Pick<PerfilCitado, "rede" | "handle">): string {
  const comArroba = perfil.rede === "youtube" ? perfil.handle : `@${perfil.handle}`;
  return `${comArroba} (${perfil.rede})`;
}

export type { Plataforma, TipoPerfilCitado };
