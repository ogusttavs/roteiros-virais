/**
 * As chaves de formato de uma marca (E44 PR 1, `pesquisa/estudo-formatos.md`): as treze chaves do cliente, cada uma ligada ou desligada. Sem linha em
 * `formatos_da_marca`, vale o padrão do estudo (oito ligadas). Duas camadas: a resposta do cliente (`quem = cliente`, do briefing) e a correção do admin
 * (`quem = admin`), que vale por cima; "voltar ao que o cliente escolheu" apaga a linha do admin. A tela vem no PR 2.
 */
import { and, eq } from "drizzle-orm";

import { CHAVES_DE_FORMATO, CHAVES_LIGADAS_POR_PADRAO, FORMATOS_DO_CATALOGO } from "@/config/formatos";
import { db } from "@/db";
import { formatosDaMarca } from "@/db/schema";

/** Uma chave que não existe: o admin e o cliente nunca digitam a chave, mas a ação recebe texto do navegador. */
export class ErroFormato extends Error {}

export type QuemDecidiu = "padrao" | "cliente" | "admin";

export type EstadoDoFormato = {
  chave: string;
  nome: string;
  frase: string;
  ligada: boolean;
  /** De onde vem o estado de agora: o padrão do estudo, a resposta do cliente ou a correção do admin. */
  quem: QuemDecidiu;
  /** O que o cliente respondeu (nulo se não respondeu esta chave), para a tela do admin mostrar a diferença e oferecer "voltar ao que o cliente escolheu". */
  respostaDoCliente: boolean | null;
};

/** As treze chaves da marca com o estado de cada uma. */
export async function formatosDaMarcaComEstado(clienteId: number): Promise<EstadoDoFormato[]> {
  const linhas = await db().select().from(formatosDaMarca).where(eq(formatosDaMarca.clienteId, clienteId));
  return FORMATOS_DO_CATALOGO.map((formato) => {
    const doAdmin = linhas.find((l) => l.chave === formato.chave && l.quem === "admin");
    const doCliente = linhas.find((l) => l.chave === formato.chave && l.quem === "cliente");
    const quem: QuemDecidiu = doAdmin ? "admin" : doCliente ? "cliente" : "padrao";
    return {
      chave: formato.chave,
      nome: formato.nome,
      frase: formato.frase,
      ligada: doAdmin ? doAdmin.ligada : doCliente ? doCliente.ligada : formato.ligadaPorPadrao,
      quem,
      respostaDoCliente: doCliente ? doCliente.ligada : null,
    };
  });
}

/** Só as chaves ligadas da marca, na ordem do catálogo. */
export async function chavesLigadasDaMarca(clienteId: number): Promise<string[]> {
  return (await formatosDaMarcaComEstado(clienteId)).filter((f) => f.ligada).map((f) => f.chave);
}

/**
 * O que os filtros do banco precisam saber da marca: as chaves ligadas e se ela já tem alguma linha (resposta do cliente ou correção do admin). O corte global
 * de meme e recorte da H4 só sai para quem tem linha (compatibilidade até o PR 2).
 */
export type FiltroDeFormatosDaMarca = { ligados: string[]; temResposta: boolean };

export async function filtroDeFormatosDaMarca(clienteId: number): Promise<FiltroDeFormatosDaMarca> {
  const linhas = await db().select({ chave: formatosDaMarca.chave }).from(formatosDaMarca).where(eq(formatosDaMarca.clienteId, clienteId)).limit(1);
  return { ligados: await chavesLigadasDaMarca(clienteId), temResposta: linhas.length > 0 };
}

/** O padrão do estudo, para quem monta o filtro sem uma marca (testes, ferramentas). */
export const FILTRO_DE_FORMATOS_PADRAO: FiltroDeFormatosDaMarca = { ligados: CHAVES_LIGADAS_POR_PADRAO, temResposta: false };

function conferirChave(chave: string): void {
  if (!CHAVES_DE_FORMATO.includes(chave)) throw new ErroFormato("Esse formato não existe.");
}

/**
 * Grava a decisão de uma chave. `cliente` é a resposta do briefing; `admin` é a correção, que vale por cima da do cliente. Idempotente (a mesma decisão
 * duas vezes é uma linha só).
 */
export async function definirFormato(clienteId: number, chave: string, ligada: boolean, quem: "cliente" | "admin", usuarioId: string | null): Promise<void> {
  conferirChave(chave);
  await db()
    .insert(formatosDaMarca)
    .values({ clienteId, chave, ligada, quem, decididoPorUsuarioId: usuarioId })
    .onConflictDoUpdate({
      target: [formatosDaMarca.clienteId, formatosDaMarca.chave, formatosDaMarca.quem],
      set: { ligada, decididoPorUsuarioId: usuarioId, decididoEm: new Date() },
    });
}

/** "Voltar ao que o cliente escolheu": apaga a correção do admin dessa chave (a resposta do cliente, ou o padrão, volta a valer). */
export async function voltarFormatoAoDoCliente(clienteId: number, chave: string): Promise<void> {
  conferirChave(chave);
  await db().delete(formatosDaMarca).where(and(eq(formatosDaMarca.clienteId, clienteId), eq(formatosDaMarca.chave, chave), eq(formatosDaMarca.quem, "admin")));
}

/** O cliente responde as treze de uma vez (o briefing): só as chaves que ele mandou, cada uma ligada ou desligada. */
export async function responderFormatosDoCliente(clienteId: number, respostas: Record<string, boolean>, usuarioId: string): Promise<void> {
  for (const chave of Object.keys(respostas)) conferirChave(chave);
  for (const [chave, ligada] of Object.entries(respostas)) await definirFormato(clienteId, chave, ligada, "cliente", usuarioId);
}
