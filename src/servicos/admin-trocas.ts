import type { Alcance, Plataforma, PlanoMarca, TipoMarca } from "@/db/schema";
import { logger } from "@/lib/log";
import { registrarAlteracao, type CampoAlterado } from "@/servicos/admin-contas";
import { clientePorId, definirPlano, mudarTipoMarca, salvarOndeConta, salvarRamoConta, salvarRedePrincipal, ErroCliente } from "@/servicos/clientes";
import { ramoAtualDoCliente } from "@/servicos/ramos";

/**
 * As trocas que antes exigiam o banco (E46 PR 1, item 4): ramo, tipo, rede principal, público e roteiros por dia. Cada uma usa o serviço que já existia para o
 * cliente ou para o admin e deixa uma linha no registro (quem, o quê, antes e depois). O registro nunca derruba uma troca que já valeu.
 */

export const NOME_DA_REDE: Record<Plataforma, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };
const NOME_DO_TIPO: Record<TipoMarca, string> = { negocio: "Empresa", pessoa: "Pessoa" };
const NOME_DO_PLANO: Record<PlanoMarca, string> = { padrao: "um por dia", sem_limite: "sem limite" };

export function descreverPublico(c: { alcance: Alcance | null; regiao: string | null; pais: string | null; paises: string | null }): string {
  switch (c.alcance) {
    case "brasil":
      return "Brasil todo";
    case "local":
      return `Local, em ${c.regiao ?? "?"}`;
    case "outro_pais":
      return `Outro país, ${c.pais ?? "?"}`;
    case "mais_de_um_pais":
      return `Mais de um país, ${c.paises ?? "?"}`;
    default:
      return "Não informado";
  }
}

async function anotar(clienteId: number, porUsuarioId: string, campo: CampoAlterado, antes: string | null, depois: string | null): Promise<void> {
  if (antes === depois) return;
  try {
    await registrarAlteracao({ clienteId, porUsuarioId, campo, antes, depois });
  } catch (erro) {
    logger.error({ err: erro, clienteId, campo }, "admin: a troca valeu, mas o registro dela nao foi gravado");
  }
}

export async function trocarRamoDaConta(clienteId: number, ramoSlug: string, porUsuarioId: string): Promise<{ mudou: boolean }> {
  const cliente = await clientePorId(clienteId);
  if (!cliente) throw new ErroCliente("conta nao encontrada.");
  const antes = await ramoAtualDoCliente(cliente.nichoId);
  const { mudou } = await salvarRamoConta(clienteId, ramoSlug);
  const depois = await ramoAtualDoCliente((await clientePorId(clienteId))?.nichoId);
  if (mudou) await anotar(clienteId, porUsuarioId, "ramo", antes?.nome ?? null, depois?.nome ?? null);
  return { mudou };
}

export async function trocarTipoDaConta(clienteId: number, tipo: TipoMarca, porUsuarioId: string): Promise<void> {
  const antes = await clientePorId(clienteId);
  if (!antes) throw new ErroCliente("conta nao encontrada.");
  await mudarTipoMarca(clienteId, tipo);
  await anotar(clienteId, porUsuarioId, "tipo", NOME_DO_TIPO[antes.tipo], NOME_DO_TIPO[tipo]);
}

export async function trocarRedeDaConta(clienteId: number, rede: string, porUsuarioId: string): Promise<void> {
  const antes = await clientePorId(clienteId);
  if (!antes) throw new ErroCliente("conta nao encontrada.");
  const depois = await salvarRedePrincipal(clienteId, rede);
  await anotar(clienteId, porUsuarioId, "rede_principal", antes.redePrincipal ? NOME_DA_REDE[antes.redePrincipal] : null, depois.redePrincipal ? NOME_DA_REDE[depois.redePrincipal] : null);
}

export async function trocarPublicoDaConta(clienteId: number, dados: unknown, porUsuarioId: string): Promise<void> {
  const antes = await clientePorId(clienteId);
  if (!antes) throw new ErroCliente("conta nao encontrada.");
  const depois = await salvarOndeConta(clienteId, dados);
  await anotar(clienteId, porUsuarioId, "publico", descreverPublico(antes), descreverPublico(depois));
}

export async function trocarPlanoDaConta(clienteId: number, plano: PlanoMarca, porUsuarioId: string): Promise<void> {
  const antes = await clientePorId(clienteId);
  if (!antes) throw new ErroCliente("conta nao encontrada.");
  await definirPlano(clienteId, plano);
  await anotar(clienteId, porUsuarioId, "roteiros_por_dia", NOME_DO_PLANO[antes.plano], NOME_DO_PLANO[plano]);
}
