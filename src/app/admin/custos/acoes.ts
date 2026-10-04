"use server";

import { revalidatePath } from "next/cache";

import type { ResultadoAcao } from "@/lib/resultado-acao";
import { sessaoAtual } from "@/lib/sessao";
import { adicionarFixo, definirTetoDiario, editarFixo, ErroCusto, tirarFixo, type DadosDoFixo } from "@/servicos/admin-custos";
import { garantirSessaoAdmin } from "@/servicos/clientes";

async function comAdmin<T>(tarefa: (usuarioId: string) => Promise<T>): Promise<ResultadoAcao<T>> {
  const sessao = await sessaoAtual();
  garantirSessaoAdmin(sessao);
  try {
    const dado = await tarefa(sessao!.user.id);
    revalidatePath("/admin/custos");
    revalidatePath("/admin");
    return { ok: true, dado };
  } catch (erro) {
    if (erro instanceof ErroCusto) return { ok: false, erro: erro.message };
    throw erro;
  }
}

/** E46 PR 3: trocar o teto do dia (só avisa, nunca para nada). */
export async function trocarTetoAction(reais: number): Promise<ResultadoAcao<null>> {
  return comAdmin(async (usuarioId) => {
    await definirTetoDiario(reais, usuarioId);
    return null;
  });
}

export async function adicionarFixoAction(dados: DadosDoFixo): Promise<ResultadoAcao<null>> {
  return comAdmin(async () => {
    await adicionarFixo(dados);
    return null;
  });
}

export async function editarFixoAction(id: number, dados: DadosDoFixo): Promise<ResultadoAcao<null>> {
  return comAdmin(async () => {
    if (!Number.isInteger(id) || id < 1 || id > 2_000_000_000) throw new ErroCusto("esse custo não existe mais.");
    await editarFixo(id, dados);
    return null;
  });
}

export async function tirarFixoAction(id: number): Promise<ResultadoAcao<null>> {
  return comAdmin(async () => {
    if (!Number.isInteger(id) || id < 1 || id > 2_000_000_000) throw new ErroCusto("esse custo não existe mais.");
    await tirarFixo(id);
    return null;
  });
}
