/**
 * As inscrições do aviso de manhã por push (E48 PR 2): uma linha por aparelho que a pessoa deixou receber. O endpoint é único (a mesma inscrição
 * nunca vira duas linhas). Uma falha de envio do aparelho conta; a segunda seguida apaga. Falha que não é do aparelho só apaga depois de 14 dias sem nenhum envio aceito.
 */
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";

import { HORA_LEMBRETE_PADRAO } from "@/config/lembrete";
import { db } from "@/db";
import { inscricoesPush, preferenciasUsuario, type InscricaoPush, type SistemaInstalado } from "@/db/schema";
import { adiamentoDoConvite } from "@/lib/convite-instalar";
import { logger } from "@/lib/log";

/** A segunda falha seguida apaga a inscrição (404 e 410 apagam na hora, `enviarPush`). */
export const FALHAS_SEGUIDAS_PARA_APAGAR = 2;

export type DadosDaInscricao = { endpoint: string; p256dh: string; auth: string };

/** Quem chama já conferiu a sessão; o endpoint do navegador é uma URL https do serviço de push, nunca outra coisa. */
export class ErroInscricaoPush extends Error {}

/** Serviços de push conhecidos, por sufixo de nome (A2). Fontes: o endpoint que cada navegador gera: FCM (Chrome, Edge e Samsung no Android), `*.push.apple.com` (Safari), `*.push.services.mozilla.com` (Firefox, inclui `updates.`), `*.notify.windows.com` (WNS). */
const SERVICOS_DE_PUSH_EXATOS = ["fcm.googleapis.com"];
const SERVICOS_DE_PUSH_POR_SUFIXO = [".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com"];

/**
 * O servidor faz um POST no endereço da inscrição ao mandar o aviso (às 4h, pelo worker): por isso só vale o endereço de um serviço de push conhecido
 * (lista fechada por nome), `https`, porta padrão, sem ponto final no nome e sem usuário na URL. Um nome público que resolva para um IP interno
 * (`127.0.0.1.nip.io`), `localhost.`, IP literal e porta qualquer ficam todos de fora. Navegador novo com serviço novo: acrescentar o sufixo aqui, com a fonte.
 */
export function enderecoDeServicoDePush(endpoint: string): { ok: true } | { ok: false; host: string } {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, host: "(invalido)" };
  }
  const host = url.hostname.toLowerCase();
  const permitido =
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    !host.endsWith(".") &&
    (SERVICOS_DE_PUSH_EXATOS.includes(host) || SERVICOS_DE_PUSH_POR_SUFIXO.some((sufixo) => host.endsWith(sufixo) && host.length > sufixo.length));
  return permitido ? { ok: true } : { ok: false, host };
}

function validar(dados: DadosDaInscricao): void {
  if (dados.p256dh.length < 10 || dados.auth.length < 4 || dados.endpoint.length > 2000) throw new ErroInscricaoPush("Inscrição do aviso inválida.");
  const confere = enderecoDeServicoDePush(dados.endpoint);
  if (!confere.ok) {
    logger.warn({ host: confere.host }, "push: endereco de inscricao recusado (fora da lista de servicos de push)");
    throw new ErroInscricaoPush("Endereço do aviso inválido.");
  }
}

/**
 * Registra a inscrição de um aparelho da pessoa. Endereço novo: cria. O mesmo endereço de volta (a Conta reconcilia ao abrir):
 * - chaves diferentes (o navegador trouxe uma inscrição nova): vale como nova, troca o dono se preciso e recomeça a contagem de falhas;
 * - chaves iguais e a mesma pessoa: só confirma o sistema, sem zerar as falhas (a reconciliação não pode apagar a falha corrente);
 * - chaves iguais e outra pessoa: recusa. Quem passou a usar o aparelho precisa desligar e ligar de novo, o que gera uma inscrição nova.
 */
export async function registrarInscricaoPush(usuarioId: string, dados: DadosDaInscricao, sistema: SistemaInstalado): Promise<InscricaoPush> {
  validar(dados);
  const [existente] = await db().select().from(inscricoesPush).where(eq(inscricoesPush.endpoint, dados.endpoint));
  if (!existente) {
    const [criada] = await db()
      .insert(inscricoesPush)
      .values({ usuarioId, endpoint: dados.endpoint, p256dh: dados.p256dh, auth: dados.auth, sistema })
      .onConflictDoNothing()
      .returning();
    // Duas gravações ao mesmo tempo: quem perdeu a corrida lê o que o outro criou e segue a regra do endereço que já existe.
    return criada ?? registrarInscricaoPush(usuarioId, dados, sistema);
  }
  const chavesIguais = existente.p256dh === dados.p256dh && existente.auth === dados.auth;
  if (chavesIguais && existente.usuarioId !== usuarioId) {
    throw new ErroInscricaoPush("Esse aparelho já está inscrito por outra pessoa; desligue e ligue o aviso de novo.");
  }
  const [atualizada] = await db()
    .update(inscricoesPush)
    .set(
      chavesIguais
        ? { sistema }
        : { usuarioId, p256dh: dados.p256dh, auth: dados.auth, sistema, ultimaFalhaEm: null, falhasSeguidas: 0 },
    )
    .where(eq(inscricoesPush.id, existente.id))
    .returning();
  return atualizada;
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

/** Um envio aceito: a contagem de falhas seguidas recomeça, a falha corrente acaba e o sucesso fica anotado. */
export async function registrarEnvioBemSucedido(id: number, agora: Date = new Date()): Promise<void> {
  await db().update(inscricoesPush).set({ falhasSeguidas: 0, ultimaFalhaEm: null, ultimoSucessoEm: agora }).where(eq(inscricoesPush.id, id));
}

/** Quantos dias de falha corrente, sem nenhum envio aceito, uma inscrição aguenta antes de ser apagada (A2). */
export const DIAS_DE_FALHA_PARA_APAGAR = 14;

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Uma falha que não é do aparelho (credenciais, limite, queda do serviço, rede): não conta como falha seguida, mas começa (ou continua) a falha corrente.
 * Passados `DIAS_DE_FALHA_PARA_APAGAR` dias dela sem nenhum envio aceito, a inscrição é apagada (a pessoa volta ao pedido de permissão). Devolve se apagou.
 */
export async function registrarFalhaQueNaoConta(id: number, agora: Date = new Date()): Promise<boolean> {
  const [linha] = await db()
    .update(inscricoesPush)
    .set({ ultimaFalhaEm: sql`coalesce(${inscricoesPush.ultimaFalhaEm}, ${agora})` })
    .where(eq(inscricoesPush.id, id))
    .returning({ ultimaFalhaEm: inscricoesPush.ultimaFalhaEm });
  if (linha?.ultimaFalhaEm && agora.getTime() - linha.ultimaFalhaEm.getTime() > DIAS_DE_FALHA_PARA_APAGAR * DIA_MS) {
    await apagarInscricao(id);
    return true;
  }
  return false;
}

/**
 * Uma falha que não é 404 nem 410: conta uma vez; na segunda seguida a inscrição é apagada (e a pessoa volta ao e-mail). Devolve se apagou.
 */
export async function registrarFalhaDeEnvio(id: number, agora: Date = new Date()): Promise<boolean> {
  const [linha] = await db()
    .update(inscricoesPush)
    .set({ ultimaFalhaEm: sql`coalesce(${inscricoesPush.ultimaFalhaEm}, ${agora})`, falhasSeguidas: sql`${inscricoesPush.falhasSeguidas} + 1` })
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
    .values({ usuarioId, pushAdiadoAte: ate, horaLembrete: HORA_LEMBRETE_PADRAO })
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

/** Quantos aparelhos da pessoa estão sem falha corrente (a inscrição que já falha não conta: a pessoa pode ser convidada a ligar de novo). */
export async function aparelhosSemFalha(usuarioId: string): Promise<number> {
  const [linha] = await db()
    .select({ total: count() })
    .from(inscricoesPush)
    .where(and(eq(inscricoesPush.usuarioId, usuarioId), isNull(inscricoesPush.ultimaFalhaEm)));
  return linha?.total ?? 0;
}

/** O pedido de permissão pode aparecer para esta pessoa? Não com "agora não" ainda valendo. (O resto, ser o aplicativo instalado e a permissão ainda não decidida, só o navegador sabe.) */
export function pedidoDePushPodeAparecer(preferencias: { pushAdiadoAte: Date | null } | null, aparelhosAtivos: number, agora: Date): boolean {
  if (aparelhosAtivos > 0) return false;
  if (preferencias?.pushAdiadoAte && preferencias.pushAdiadoAte > agora) return false;
  return true;
}
