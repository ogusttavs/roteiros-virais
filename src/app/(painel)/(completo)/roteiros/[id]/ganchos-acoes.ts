"use server";

import { idDoBancoOuNulo } from "@/lib/id-rota";
import { exigirAssinaturaValida } from "@/lib/portao-cobranca";
import type { ResultadoAcao } from "@/lib/resultado-acao";
import { recusaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { ErroGanchos, pedirGanchosAlternativos, trocarGancho, type VisaoDosGanchos } from "@/servicos/ganchos-alternativos";
import { fraseDosGanchos } from "@/textos/ganchos";

/** A marca vem da sessão, nunca de um parâmetro (isolamento no nível da ação). */
async function marcaDaSessao() {
  const sessao = await sessaoDoPainel();
  if (!sessao) return null;
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  return cliente ? { clienteId: cliente.id } : null;
}

type Resultado = ResultadoAcao<{ ganchos: VisaoDosGanchos }>;

/** "Outros ganchos": o "ver como" nunca (primeira linha); o portão da cobrança; só a marca da sessão. */
export async function pedirGanchosAction(roteiroId: number): Promise<Resultado> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  await exigirAssinaturaValida();
  const quem = await marcaDaSessao();
  const id = idDoBancoOuNulo(roteiroId);
  if (!quem || id === null) return { ok: false, erro: fraseDosGanchos("nao-achou") };
  try {
    return { ok: true, dado: { ganchos: await pedirGanchosAlternativos(quem.clienteId, id) } };
  } catch (erro) {
    if (erro instanceof ErroGanchos) return { ok: false, erro: fraseDosGanchos(erro.motivo) };
    throw erro;
  }
}

/** Troca o gancho do roteiro por um da lista (índice) ou volta ao de antes (`"original"`). */
export async function trocarGanchoAction(roteiroId: number, escolha: number | "original"): Promise<Resultado> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  await exigirAssinaturaValida();
  const quem = await marcaDaSessao();
  const id = idDoBancoOuNulo(roteiroId);
  if (!quem || id === null) return { ok: false, erro: fraseDosGanchos("nao-achou") };
  // Uma Server Action não confere tipo em tempo de execução: o que chega forjado é recusado com a frase.
  if (escolha !== "original" && !Number.isInteger(escolha)) return { ok: false, erro: fraseDosGanchos("escolha-invalida") };
  try {
    return { ok: true, dado: { ganchos: await trocarGancho(quem.clienteId, id, escolha) } };
  } catch (erro) {
    if (erro instanceof ErroGanchos) return { ok: false, erro: fraseDosGanchos(erro.motivo) };
    throw erro;
  }
}
