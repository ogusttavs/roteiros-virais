"use server";

import { idDoBancoOuNulo } from "@/lib/id-rota";
import { exigirAssinaturaValida } from "@/lib/portao-cobranca";
import type { ResultadoAcao } from "@/lib/resultado-acao";
import { recusaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { aprovarAnimacao, dispensarAnimacao, pedirAnimacao, tentarAnimacaoDeNovo, type VistaDaAnimacao } from "@/servicos/animacao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { fraseDaAnimacao } from "@/textos/animacao";

/** Marca e pessoa vêm da sessão, nunca de um parâmetro (isolamento no nível da ação). */
async function quemPede() {
  const sessao = await sessaoDoPainel();
  if (!sessao) return null;
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  return cliente ? { usuarioId: sessao.user.id, clienteId: cliente.id } : null;
}

type Resultado = ResultadoAcao<{ animacao: VistaDaAnimacao | null }>;

/**
 * Todas as ações do vídeo de animação: o "ver como" nunca (primeira linha); o portão da cobrança; só a marca da sessão, e só se ela está na lista `ANIMACAO_CONTAS` (fora dela a ação responde
 * "não achamos", igual a um vídeo que não existe: o serviço devolve 404 e a tela mostra a frase).
 */
async function comQuem(fazer: (quem: { usuarioId: string; clienteId: number }) => Promise<Resultado>): Promise<Resultado> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  await exigirAssinaturaValida();
  const quem = await quemPede();
  if (!quem) return { ok: false, erro: fraseDaAnimacao("nao-achou") };
  return fazer(quem);
}

export async function pedirAnimacaoAction(roteiroId: number): Promise<Resultado> {
  return comQuem(async (quem) => {
    const id = idDoBancoOuNulo(roteiroId);
    if (id === null) return { ok: false, erro: fraseDaAnimacao("nao-achou") };
    const r = await pedirAnimacao({ clienteId: quem.clienteId, usuarioId: quem.usuarioId, roteiroId: id });
    return r.ok ? { ok: true, dado: { animacao: r.animacao } } : { ok: false, erro: r.frase };
  });
}

export async function aprovarAnimacaoAction(animacaoId: number): Promise<Resultado> {
  return comQuem(async (quem) => {
    const id = idDoBancoOuNulo(animacaoId);
    if (id === null) return { ok: false, erro: fraseDaAnimacao("nao-achou") };
    const r = await aprovarAnimacao(quem.clienteId, id);
    return r.ok ? { ok: true, dado: { animacao: r.animacao } } : { ok: false, erro: r.frase };
  });
}

/** "Agora não": a animação sai (a tela volta ao chamado). */
export async function dispensarAnimacaoAction(animacaoId: number): Promise<Resultado> {
  return comQuem(async (quem) => {
    const id = idDoBancoOuNulo(animacaoId);
    if (id === null) return { ok: false, erro: fraseDaAnimacao("nao-achou") };
    const r = await dispensarAnimacao(quem.clienteId, id);
    return r.ok ? { ok: true, dado: { animacao: null } } : { ok: false, erro: r.frase };
  });
}

export async function tentarAnimacaoDeNovoAction(animacaoId: number): Promise<Resultado> {
  return comQuem(async (quem) => {
    const id = idDoBancoOuNulo(animacaoId);
    if (id === null) return { ok: false, erro: fraseDaAnimacao("nao-achou") };
    const r = await tentarAnimacaoDeNovo(quem.clienteId, id);
    return r.ok ? { ok: true, dado: { animacao: r.animacao } } : { ok: false, erro: r.frase };
  });
}
