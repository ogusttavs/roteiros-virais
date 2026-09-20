"use server";

import { revalidatePath } from "next/cache";

import { sessaoAtual } from "@/lib/sessao";
import {
  darAcesso,
  ErroCliente,
  garantirSessaoAdmin,
  gerarSenhaNova,
  tirarAcesso,
  type ResultadoDarAcesso,
} from "@/servicos/clientes";

/**
 * "Essa pessoa já tem acesso a esta marca." e "O dono não pode ter o acesso
 * tirado." (V3, item 5) precisam chegar com o texto exato na tela: Next.js
 * troca a mensagem de erro de uma Server Action por um texto generico em
 * producao, entao o erro esperado vem como resultado, nao lançado
 * (`erro instanceof ErroCliente` cobre so os dois casos conhecidos; erro de
 * outra natureza continua subindo, para nao esconder bug de verdade).
 */
export type ResultadoAcao<T> = { ok: true; dado: T } | { ok: false; erro: string };

export async function darAcessoAction(clienteId: number, email: string): Promise<ResultadoAcao<ResultadoDarAcesso>> {
  garantirSessaoAdmin(await sessaoAtual());
  try {
    const resultado = await darAcesso(clienteId, email);
    revalidatePath(`/admin/clientes/${clienteId}`);
    revalidatePath("/admin/clientes");
    return { ok: true, dado: resultado };
  } catch (erro) {
    if (erro instanceof ErroCliente) return { ok: false, erro: erro.message };
    throw erro;
  }
}

export async function gerarSenhaNovaAction(usuarioId: string): Promise<string> {
  garantirSessaoAdmin(await sessaoAtual());
  return gerarSenhaNova(usuarioId);
}

export async function tirarAcessoAction(clienteId: number, usuarioId: string): Promise<ResultadoAcao<null>> {
  garantirSessaoAdmin(await sessaoAtual());
  try {
    await tirarAcesso(clienteId, usuarioId);
    revalidatePath(`/admin/clientes/${clienteId}`);
    revalidatePath("/admin/clientes");
    return { ok: true, dado: null };
  } catch (erro) {
    if (erro instanceof ErroCliente) return { ok: false, erro: erro.message };
    throw erro;
  }
}
