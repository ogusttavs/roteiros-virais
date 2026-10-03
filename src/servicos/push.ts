/**
 * As inscrições do aviso de manhã por push (E48 PR 2): uma linha por aparelho que a pessoa deixou receber. O endpoint é único (a mesma inscrição
 * nunca vira duas linhas; se outra pessoa passou a usar o mesmo aparelho, a linha muda de dono). Uma falha de envio conta; a segunda seguida apaga.
 */
import { and, count, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { inscricoesPush, preferenciasUsuario, type InscricaoPush, type SistemaInstalado } from "@/db/schema";
import { adiamentoDoConvite } from "@/lib/convite-instalar";

/** A segunda falha seguida apaga a inscrição (404 e 410 apagam na hora, `enviarPush`). */
export const FALHAS_SEGUIDAS_PARA_APAGAR = 2;

export type DadosDaInscricao = { endpoint: string; p256dh: string; auth: string };

/** Quem chama já conferiu a sessão; o endpoint do navegador é uma URL https do serviço de push, nunca outra coisa. */
export class ErroInscricaoPush extends Error {}

function validar(dados: DadosDaInscricao): void {
  let url: URL;
  try {
    url = new URL(dados.endpoint);
  } catch {
    throw new ErroInscricaoPush("Endereço do aviso inválido.");
  }
  if (url.protocol !== "https:" || dados.p256dh.length < 10 || dados.auth.length < 4 || dados.endpoint.length > 2000) {
    throw new ErroInscricaoPush("Inscrição do aviso inválida.");
  }
}

/** Registra (ou atualiza) a inscrição de um aparelho da pessoa; o sistema é o do aparelho (celular), e a contagem de falhas recomeça. */
export async function registrarInscricaoPush(usuarioId: string, dados: DadosDaInscricao, sistema: SistemaInstalado): Promise<InscricaoPush> {
  validar(dados);
  const [linha] = await db()
    .insert(inscricoesPush)
    .values({ usuarioId, endpoint: dados.endpoint, p256dh: dados.p256dh, auth: dados.auth, sistema })
    .onConflictDoUpdate({
      target: inscricoesPush.endpoint,
      set: { usuarioId, p256dh: dados.p256dh, auth: dados.auth, sistema, ultimaFalhaEm: null, falhasSeguidas: 0 },
    })
    .returning();
  return linha;
}

/** As inscrições da pessoa (todas valem: a que falha é apagada, não marcada). */
export async function inscricoesDaPessoa(usuarioId: string): Promise<InscricaoPush[]> {
  return db().select().from(inscricoesPush).where(eq(inscricoesPush.usuarioId, usuarioId));
}

/** A pessoa tira o aviso deste aparelho (a Conta, "desligar"). Só apaga a inscrição dela. */
export async function apagarInscricaoDaPessoa(usuarioId: string, endpoint: string): Promise<void> {
  await db().delete(inscricoesPush).where(and(eq(inscricoesPush.usuarioId, usuarioId), eq(inscricoesPush.endpoint, endpoint)));
}

/** 404 ou 410: o aparelho não existe mais. */
export async function apagarInscricao(id: number): Promise<void> {
  await db().delete(inscricoesPush).where(eq(inscricoesPush.id, id));
}

/** Um envio aceito: a contagem de falhas seguidas recomeça. */
export async function registrarEnvioBemSucedido(id: number): Promise<void> {
  await db().update(inscricoesPush).set({ falhasSeguidas: 0 }).where(eq(inscricoesPush.id, id));
}

/**
 * Uma falha que não é 404 nem 410: conta uma vez; na segunda seguida a inscrição é apagada (e a pessoa volta ao e-mail). Devolve se apagou.
 */
export async function registrarFalhaDeEnvio(id: number, agora: Date = new Date()): Promise<boolean> {
  const [linha] = await db()
    .update(inscricoesPush)
    .set({ ultimaFalhaEm: agora, falhasSeguidas: sql`${inscricoesPush.falhasSeguidas} + 1` })
    .where(eq(inscricoesPush.id, id))
    .returning({ falhasSeguidas: inscricoesPush.falhasSeguidas });
  if (linha && linha.falhasSeguidas >= FALHAS_SEGUIDAS_PARA_APAGAR) {
    await apagarInscricao(id);
    return true;
  }
  return false;
}

/** "Agora não" no pedido de permissão do aviso: a folha não volta por sete dias, em nenhum aparelho da pessoa. */
export async function adiarPedidoDePush(usuarioId: string, agora: Date = new Date()): Promise<Date> {
  const ate = adiamentoDoConvite(agora);
  await db()
    .insert(preferenciasUsuario)
    .values({ usuarioId, pushAdiadoAte: ate })
    .onConflictDoUpdate({ target: preferenciasUsuario.usuarioId, set: { pushAdiadoAte: ate } });
  return ate;
}

/** Quantos aparelhos ativos cada pessoa tem (para a coluna "push" do admin). */
export async function aparelhosAtivosPorPessoa(usuarioIds: string[]): Promise<Map<string, number>> {
  if (usuarioIds.length === 0) return new Map();
  const linhas = await db()
    .select({ usuarioId: inscricoesPush.usuarioId, total: count() })
    .from(inscricoesPush)
    .where(inArray(inscricoesPush.usuarioId, usuarioIds))
    .groupBy(inscricoesPush.usuarioId);
  return new Map(linhas.map((l) => [l.usuarioId, l.total]));
}

/** O pedido de permissão pode aparecer para esta pessoa? Não com "agora não" ainda valendo. (O resto, ser o aplicativo instalado e a permissão ainda não decidida, só o navegador sabe.) */
export function pedidoDePushPodeAparecer(preferencias: { pushAdiadoAte: Date | null } | null, aparelhosAtivos: number, agora: Date): boolean {
  if (aparelhosAtivos > 0) return false;
  if (preferencias?.pushAdiadoAte && preferencias.pushAdiadoAte > agora) return false;
  return true;
}
