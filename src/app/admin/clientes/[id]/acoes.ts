"use server";

import { revalidatePath } from "next/cache";

import { CUSTO_DIARIO_DE_SETOR_NOVO_USD } from "@/config/precos-ia";
import type { Cliente, PlanoMarca, TipoMarca } from "@/db/schema";
import { type ResultadoAcao } from "@/lib/resultado-acao";
import { sessaoAtual } from "@/lib/sessao";
import {
  darAcesso,
  definirPlano,
  ErroCliente,
  garantirSessaoAdmin,
  gerarSenhaNova,
  mudarTipoMarca,
  renomearCliente,
  renomearPessoa,
  tirarAcesso,
  type ResultadoDarAcesso,
} from "@/servicos/clientes";
import { definirFormato, ErroFormato, voltarFormatoAoDoCliente } from "@/servicos/formatos";
import { ErroLimiteDeSetores } from "@/servicos/ramos";
import { ErroRamosDaConta, ligarRamoAlternativo, previaDeLigarRamo, tirarRamoAlternativo } from "@/servicos/ramos-da-conta";
import { textosRamo } from "@/textos/ramo";

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

/** P1, item 1: trocar o tipo de conteúdo em `/admin/clientes/[id]`; apaga o briefing (a tela já confirmou). */
export async function mudarTipoMarcaAction(clienteId: number, tipo: TipoMarca): Promise<ResultadoAcao<Cliente>> {
  garantirSessaoAdmin(await sessaoAtual());
  try {
    const cliente = await mudarTipoMarca(clienteId, tipo);
    revalidatePath(`/admin/clientes/${clienteId}`);
    revalidatePath("/admin/clientes");
    return { ok: true, dado: cliente };
  } catch (erro) {
    if (erro instanceof ErroCliente) return { ok: false, erro: erro.message };
    throw erro;
  }
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

/** E45 PR 3: o que o admin vê antes de confirmar a ligação de um ramo alternativo: o setor já é pesquisado, ou vai começar (e quanto custa por dia). */
export type PreviaNaTela = { estado: "pesquisado" | "comeca"; nome: string; custoPorDia: string };

export async function previaDeLigarRamoAction(slugDoRamo: string): Promise<ResultadoAcao<PreviaNaTela>> {
  garantirSessaoAdmin(await sessaoAtual());
  try {
    const previa = await previaDeLigarRamo(slugDoRamo);
    const custoPorDia = `US$ ${CUSTO_DIARIO_DE_SETOR_NOVO_USD.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return { ok: true, dado: { ...previa, custoPorDia } };
  } catch (erro) {
    if (erro instanceof ErroRamosDaConta) return { ok: false, erro: erro.message };
    throw erro;
  }
}

/** E45 PR 3: o admin liga um ramo alternativo à marca (no máximo dois). O teto de setores novos do dia volta como frase, como no Começar. */
export async function ligarRamoAlternativoAction(clienteId: number, slugDoRamo: string): Promise<ResultadoAcao<null>> {
  const sessao = await sessaoAtual();
  garantirSessaoAdmin(sessao);
  try {
    await ligarRamoAlternativo(clienteId, slugDoRamo, sessao!.user.id);
    revalidatePath(`/admin/clientes/${clienteId}`);
    return { ok: true, dado: null };
  } catch (erro) {
    if (erro instanceof ErroLimiteDeSetores) return { ok: false, erro: textosRamo.limiteDeRamosNovos };
    if (erro instanceof ErroRamosDaConta) return { ok: false, erro: erro.message };
    throw erro;
  }
}

/** E45 PR 3: o admin tira um ramo alternativo; o setor que ficou sem marca para de ser pesquisado. */
export async function tirarRamoAlternativoAction(clienteId: number, ramoDaContaId: number): Promise<ResultadoAcao<null>> {
  garantirSessaoAdmin(await sessaoAtual());
  try {
    await tirarRamoAlternativo(clienteId, ramoDaContaId);
    revalidatePath(`/admin/clientes/${clienteId}`);
    return { ok: true, dado: null };
  } catch (erro) {
    if (erro instanceof ErroRamosDaConta) return { ok: false, erro: erro.message };
    throw erro;
  }
}

/** E44 PR 1: o admin corrige uma chave de formato da marca (vale por cima da resposta do cliente). A tela é do PR 2. */
export async function definirFormatoDaMarcaAction(clienteId: number, chave: string, ligada: boolean): Promise<ResultadoAcao<null>> {
  const sessao = await sessaoAtual();
  garantirSessaoAdmin(sessao);
  try {
    await definirFormato(clienteId, chave, ligada, "admin", sessao!.user.id);
  } catch (erro) {
    if (erro instanceof ErroFormato) return { ok: false, erro: erro.message };
    throw erro;
  }
  revalidatePath(`/admin/clientes/${clienteId}`);
  return { ok: true, dado: null };
}

/** E44 PR 1: "voltar ao que o cliente escolheu": apaga a correção do admin dessa chave. */
export async function voltarFormatoAoDoClienteAction(clienteId: number, chave: string): Promise<ResultadoAcao<null>> {
  garantirSessaoAdmin(await sessaoAtual());
  try {
    await voltarFormatoAoDoCliente(clienteId, chave);
  } catch (erro) {
    if (erro instanceof ErroFormato) return { ok: false, erro: erro.message };
    throw erro;
  }
  revalidatePath(`/admin/clientes/${clienteId}`);
  return { ok: true, dado: null };
}
