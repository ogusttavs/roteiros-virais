"use server";

import { revalidatePath } from "next/cache";

import type { Cliente, PlanoMarca } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";
import {
  darAcesso,
  definirPlano,
  ErroCliente,
  garantirSessaoAdmin,
  gerarSenhaNova,
  renomearCliente,
  renomearPessoa,
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

/** V12b, item 4: a folha "Dar acesso" pede o nome também, não só o e-mail. */
export async function darAcessoAction(
  clienteId: number,
  nome: string,
  email: string,
): Promise<ResultadoAcao<ResultadoDarAcesso>> {
  garantirSessaoAdmin(await sessaoAtual());
  try {
    const resultado = await darAcesso(clienteId, nome, email);
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

/** V9b-0, item 1: o interruptor de plano em `/admin/clientes/[id]`. */
export async function definirPlanoAction(clienteId: number, plano: PlanoMarca): Promise<void> {
  garantirSessaoAdmin(await sessaoAtual());
  await definirPlano(clienteId, plano);
  revalidatePath(`/admin/clientes/${clienteId}`);
}

/** V12b, item 3: editar o nome da marca, ao lado do título. */
export async function renomearClienteAction(clienteId: number, nome: string): Promise<ResultadoAcao<Cliente>> {
  garantirSessaoAdmin(await sessaoAtual());
  try {
    const cliente = await renomearCliente(clienteId, nome);
    revalidatePath(`/admin/clientes/${clienteId}`);
    revalidatePath("/admin/clientes");
    return { ok: true, dado: cliente };
  } catch (erro) {
    if (erro instanceof ErroCliente) return { ok: false, erro: erro.message };
    throw erro;
  }
}

/** V12b, item 4: editar o nome de uma pessoa em "Quem tem acesso", na própria linha. */
export async function renomearPessoaAction(
  clienteId: number,
  usuarioId: string,
  nome: string,
): Promise<ResultadoAcao<null>> {
  garantirSessaoAdmin(await sessaoAtual());
  try {
    await renomearPessoa(clienteId, usuarioId, nome);
    revalidatePath(`/admin/clientes/${clienteId}`);
    return { ok: true, dado: null };
  } catch (erro) {
    if (erro instanceof ErroCliente) return { ok: false, erro: erro.message };
    throw erro;
  }
}
