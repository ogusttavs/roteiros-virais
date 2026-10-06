"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";

import { CUSTO_DIARIO_DE_SETOR_NOVO_USD } from "@/config/precos-ia";
import type { Alcance, Cliente, PlanoMarca, TipoMarca } from "@/db/schema";
import { type ResultadoAcao } from "@/lib/resultado-acao";
import { sessaoAtual } from "@/lib/sessao";
import { NOME_COOKIE_VER_COMO, DURACAO_VER_COMO_MS, opcoesCookieVerComo, valorCookieVerComo } from "@/lib/ver-como-cookie";
import { trocarPlanoDaConta, trocarPublicoDaConta, trocarRamoDaConta, trocarRedeDaConta, trocarTipoDaConta } from "@/servicos/admin-trocas";
import { adicionarAssunto, ErroAssunto, fixarAssunto, removerAssunto } from "@/servicos/assuntos";
import {
  clientePorId,
  darAcesso,
  ErroCliente,
  garantirSessaoAdmin,
  gerarSenhaNova,
  renomearCliente,
  renomearPessoa,
  tirarAcesso,
  type ResultadoDarAcesso,
} from "@/servicos/clientes";
import { definirFormato, ErroFormato, voltarFormatoAoDoCliente } from "@/servicos/formatos";
import { ErroNicho } from "@/servicos/nichos";
import { ErroLimiteDeSetores } from "@/servicos/ramos";
import { ErroRamosDaConta, ligarRamoAlternativo, previaDeLigarRamo, tirarRamoAlternativo } from "@/servicos/ramos-da-conta";
import { ErroVerComo, registrarEntradaVerComo } from "@/servicos/ver-como";
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
  const sessao = await sessaoAtual();
  garantirSessaoAdmin(sessao);
  if (!Number.isInteger(clienteId) || (plano !== "padrao" && plano !== "sem_limite")) throw new ErroCliente("pedido invalido.");
  await trocarPlanoDaConta(clienteId, plano, sessao!.user.id);
  revalidatePath(`/admin/clientes/${clienteId}`);
}

/** P1, item 1: trocar o tipo de conteúdo em `/admin/clientes/[id]`; apaga o briefing (a tela já confirmou). */
export async function mudarTipoMarcaAction(clienteId: number, tipo: TipoMarca): Promise<ResultadoAcao<Cliente>> {
  const sessao = await sessaoAtual();
  garantirSessaoAdmin(sessao);
  if (tipo !== "negocio" && tipo !== "pessoa") return { ok: false, erro: "pedido invalido." };
  try {
    await trocarTipoDaConta(clienteId, tipo, sessao!.user.id);
    const cliente = (await clientePorId(clienteId))!;
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
  if (!Number.isInteger(clienteId) || typeof chave !== "string" || typeof ligada !== "boolean") return { ok: false, erro: "Pedido inválido." };
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
  if (!Number.isInteger(clienteId) || typeof chave !== "string") return { ok: false, erro: "Pedido inválido." };
  try {
    await voltarFormatoAoDoCliente(clienteId, chave);
  } catch (erro) {
    if (erro instanceof ErroFormato) return { ok: false, erro: erro.message };
    throw erro;
  }
  revalidatePath(`/admin/clientes/${clienteId}`);
  return { ok: true, dado: null };
}

/** E46 PR 1, item 4: trocar o ramo principal da conta. O briefing e os roteiros ficam; a base de vídeos e os temas passam a ser os do ramo novo a partir da próxima madrugada. */
export async function trocarRamoDaContaAction(clienteId: number, ramoSlug: string): Promise<ResultadoAcao<{ mudou: boolean }>> {
  const sessao = await sessaoAtual();
  garantirSessaoAdmin(sessao);
  try {
    const dado = await trocarRamoDaConta(clienteId, ramoSlug, sessao!.user.id);
    revalidatePath(`/admin/clientes/${clienteId}`);
    revalidatePath("/admin/clientes");
    return { ok: true, dado };
  } catch (erro) {
    if (erro instanceof ErroLimiteDeSetores) return { ok: false, erro: textosRamo.limiteDeRamosNovos };
    if (erro instanceof ErroCliente || erro instanceof ErroNicho) return { ok: false, erro: erro.message };
    throw erro;
  }
}

/** E46 PR 1, item 4: a rede principal da conta. */
export async function trocarRedePrincipalAction(clienteId: number, rede: string): Promise<ResultadoAcao<null>> {
  const sessao = await sessaoAtual();
  garantirSessaoAdmin(sessao);
  try {
    await trocarRedeDaConta(clienteId, rede, sessao!.user.id);
    revalidatePath(`/admin/clientes/${clienteId}`);
    return { ok: true, dado: null };
  } catch (erro) {
    if (erro instanceof ErroCliente) return { ok: false, erro: erro.message };
    throw erro;
  }
}

/** E46 PR 1, item 4: o público da conta (Brasil todo, uma cidade ou região, outro país, mais de um). */
export async function trocarPublicoDaContaAction(clienteId: number, dados: { alcance: Alcance; regiao?: string; pais?: string; paises?: string }): Promise<ResultadoAcao<null>> {
  const sessao = await sessaoAtual();
  garantirSessaoAdmin(sessao);
  try {
    await trocarPublicoDaConta(clienteId, dados, sessao!.user.id);
    revalidatePath(`/admin/clientes/${clienteId}`);
    return { ok: true, dado: null };
  } catch (erro) {
    if (erro instanceof ErroCliente) return { ok: false, erro: erro.message };
    if (erro instanceof ZodError) return { ok: false, erro: erro.issues[0]?.message ?? "confira o que foi escrito." };
    throw erro;
  }
}

/**
 * E46 PR 2: entra no "ver como". Só admin (`garantirSessaoAdmin` na primeira linha, e `registrarEntradaVerComo` confere o papel de novo no banco); a pessoa tem de ser membro da
 * conta e não ser admin. A sessão do admin NÃO é trocada: grava a entrada em `ver_como_entradas` e um cookie próprio, assinado, com a hora de expiração (30 minutos). Em seguida
 * leva ao painel (`/hoje`), onde a faixa fica fixa no alto.
 */
export async function entrarVerComoAction(clienteId: number, pessoaId: string): Promise<ResultadoAcao<null>> {
  const sessao = await sessaoAtual();
  garantirSessaoAdmin(sessao);
  if (!Number.isInteger(clienteId) || typeof pessoaId !== "string" || pessoaId === "") return { ok: false, erro: "pedido invalido." };
  try {
    const entrada = await registrarEntradaVerComo(sessao!.user.id, clienteId, pessoaId);
    const jar = await cookies();
    jar.set(
      NOME_COOKIE_VER_COMO,
      valorCookieVerComo({ a: sessao!.user.id, p: pessoaId, c: clienteId, r: entrada.id, e: entrada.expiraEm.getTime() }),
      opcoesCookieVerComo(Math.round(DURACAO_VER_COMO_MS / 1000)),
    );
  } catch (erro) {
    if (erro instanceof ErroVerComo) return { ok: false, erro: erro.message };
    throw erro;
  }
  redirect("/hoje");
}

/** E53: o admin põe um assunto para a marca acompanhar (até cinco; o texto e, se quiser, os termos). */
export async function adicionarAssuntoAction(clienteId: number, texto: string, termos: string): Promise<ResultadoAcao<null>> {
  garantirSessaoAdmin(await sessaoAtual());
  try {
    await adicionarAssunto(clienteId, texto, termos);
    revalidatePath(`/admin/clientes/${clienteId}`);
    return { ok: true, dado: null };
  } catch (erro) {
    if (erro instanceof ErroAssunto) return { ok: false, erro: erro.message };
    throw erro;
  }
}

export async function removerAssuntoAction(clienteId: number, assuntoId: number): Promise<ResultadoAcao<null>> {
  garantirSessaoAdmin(await sessaoAtual());
  try {
    await removerAssunto(clienteId, assuntoId);
    revalidatePath(`/admin/clientes/${clienteId}`);
    return { ok: true, dado: null };
  } catch (erro) {
    if (erro instanceof ErroAssunto) return { ok: false, erro: erro.message };
    throw erro;
  }
}

export async function fixarAssuntoAction(clienteId: number, assuntoId: number, fixado: boolean): Promise<ResultadoAcao<null>> {
  garantirSessaoAdmin(await sessaoAtual());
  try {
    await fixarAssunto(clienteId, assuntoId, fixado);
    revalidatePath(`/admin/clientes/${clienteId}`);
    return { ok: true, dado: null };
  } catch (erro) {
    if (erro instanceof ErroAssunto) return { ok: false, erro: erro.message };
    throw erro;
  }
}
