/**
 * E61 PR 2 (28/10/2026), os temas do dia POR CONTA: o que a conta com foco confirmado lê no lugar dos temas do setor.
 *
 * A pesquisa continua por setor (`temas_dia`, uma linha por setor e dia). Para a conta que disse sobre o que fala e para quem (`clientes.foco`, PR 1), o job `temas-do-dia` escreve também uma linha
 * em `temas_dia_conta` (`jobs/temas-do-dia-conta.ts`): os candidatos são os do setor, filtrados e ordenados pela proximidade com o foco, e o texto dos três temas é escrito para ele. Aqui ficam as
 * partes puras e a leitura:
 *
 *  - `temasDaContaDeHoje`: lê a linha da PRÓPRIA conta (sempre por `cliente_id`), e só vale se o foco de agora é o foco com que ela foi feita (`foco_hash`): quem muda ou tira o foco volta aos temas
 *    do setor na mesma hora, sem esperar o job, e o texto de um foco antigo nunca aparece depois dele.
 *  - `completarComOSetor`: o dia da conta sempre fecha três; o que o foco não sustentou com prova é completado com temas do setor, marcados `doSetor` (a tela diz isso em uma frase).
 *  - `hashDoFoco` e `hashDosCandidatos`: a identidade do foco e do que o setor tinha na hora de escrever, para o job só refazer o que mudou.
 */
import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { temasDiaConta, type Cliente, type TemaDoDia } from "@/db/schema";

import { focoConfirmado, limparFoco } from "./foco-da-conta";

/** Quantos temas o dia fecha (os "três temas" do produto). */
export const TEMAS_POR_DIA_DA_CONTA = 3;

/** A identidade do foco: o mesmo texto (sem diferença de caixa nem de espaço) dá o mesmo hash; mudou uma palavra, é outro foco. */
export function hashDoFoco(foco: string): string {
  return createHash("sha256").update(limparFoco(foco).toLowerCase()).digest("hex").slice(0, 32);
}

/**
 * O que o setor tinha quando a linha da conta foi escrita: os ids dos vídeos candidatos e os títulos dos temas do setor daquele momento (o que completa o dia). Mudou qualquer um, a linha é refeita;
 * senão, fica como está (nada de pagar de novo o que já foi escrito).
 */
export function hashDosCandidatos(idsDeVideo: number[], titulosDoSetor: string[]): string {
  const material = JSON.stringify([[...idsDeVideo].sort((a, b) => a - b), [...titulosDoSetor].sort()]);
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

const semAcento = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Completa os temas próprios da conta com os do setor até três. Os do setor que o filtro do foco ainda reconhece como próximos (algum vídeo de prova deles está entre os `idsProximos`) vêm primeiro; o
 * resto segue a ordem do setor. Tema repetido (mesmo título) não entra, o tema do momento nunca é copiado (ele é do dia e do setor, e a leitura o traz por conta própria), e cada tema copiado leva
 * `doSetor`. Sem tema próprio nenhum, devolve vazio: a conta recebe exatamente os temas do setor, sem cópia.
 */
export function completarComOSetor(proprios: TemaDoDia[], doSetor: TemaDoDia[], idsProximos: Set<number>, total: number = TEMAS_POR_DIA_DA_CONTA): TemaDoDia[] {
  if (proprios.length === 0) return [];
  const vagas = total - proprios.length;
  if (vagas <= 0) return proprios.slice(0, total);
  const titulos = new Set(proprios.map((t) => semAcento(t.titulo)));
  const candidatos = doSetor.filter((t) => !t.doMomento && !titulos.has(semAcento(t.titulo)));
  const proximo = (t: TemaDoDia) => t.evidencias.some((id) => idsProximos.has(id));
  const ordenados = [...candidatos.filter(proximo), ...candidatos.filter((t) => !proximo(t))];
  const copiados: TemaDoDia[] = [];
  for (const tema of ordenados) {
    if (copiados.length >= vagas) break;
    if (copiados.some((c) => semAcento(c.titulo) === semAcento(tema.titulo))) continue;
    copiados.push({ ...tema, doSetor: true });
  }
  return [...proprios, ...copiados];
}

/**
 * Os temas do dia da conta, ou `null` (e quem chama usa os do setor): sem foco confirmado, sem linha do dia, linha vazia (o foco não achou prova), ou linha feita com outro foco que não o de agora.
 * Lê só a linha da conta que recebe (`cliente.id`, que vem da sessão).
 */
export async function temasDaContaDeHoje(cliente: Pick<Cliente, "id" | "foco" | "focoOrigem" | "focoConfirmadoEm">, data: string): Promise<TemaDoDia[] | null> {
  const foco = focoConfirmado(cliente);
  if (!foco) return null;
  const [linha] = await db()
    .select({ temas: temasDiaConta.temas, focoHash: temasDiaConta.focoHash })
    .from(temasDiaConta)
    .where(and(eq(temasDiaConta.clienteId, cliente.id), eq(temasDiaConta.data, data)));
  if (!linha || linha.temas.length === 0 || linha.focoHash !== hashDoFoco(foco)) return null;
  return linha.temas;
}
