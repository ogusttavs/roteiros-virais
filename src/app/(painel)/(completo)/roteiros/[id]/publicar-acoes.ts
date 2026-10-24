"use server";

import { revalidatePath } from "next/cache";

import { idDoBancoOuNulo } from "@/lib/id-rota";
import { exigirAssinaturaValida } from "@/lib/portao-cobranca";
import type { ResultadoAcao } from "@/lib/resultado-acao";
import { recusaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { ehDonoDaMarca } from "@/servicos/conta-conectada";
import { cancelarEnvio, conferirPublicacao, iniciarPublicacao, type VistaDaPublicacao } from "@/servicos/publicar-instagram";
import { fraseDeRecusa } from "@/textos/publicar";

/** Marca e pessoa vêm da sessão, nunca de um parâmetro (isolamento no nível da ação). */
async function quemPublica() {
  const sessao = await sessaoDoPainel();
  if (!sessao) return null;
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  return cliente ? { usuarioId: sessao.user.id, clienteId: cliente.id } : null;
}

export type DadosParaPublicar = {
  tipo: string;
  legenda: string;
  tamanhoBytes: number;
  tipoDoArquivo: string;
  nomeDoArquivo?: string;
};

/**
 * E56 PR 1: o começo de uma publicação no Instagram. O "ver como" nunca (primeira linha); o portão da cobrança (publicar é coisa de produto); só o dono da marca (o serviço confere). Cria o envio
 * na Meta e devolve o número da publicação; o vídeo sobe depois, por `PUT /api/publicar/<id>/video`.
 */
export async function iniciarPublicacaoAction(roteiroId: number, dados: DadosParaPublicar): Promise<ResultadoAcao<{ publicacaoId: number }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) return { ok: false, erro: fraseDeRecusa("so-dono") };
  await exigirAssinaturaValida();
  const quem = await quemPublica();
  const id = idDoBancoOuNulo(roteiroId);
  if (!quem || id === null) return { ok: false, erro: fraseDeRecusa("sem-roteiro") };
  const resultado = await iniciarPublicacao({
    usuarioId: quem.usuarioId,
    clienteId: quem.clienteId,
    roteiroId: id,
    tipo: String(dados.tipo),
    legenda: String(dados.legenda ?? ""),
    tamanhoBytes: Number(dados.tamanhoBytes),
    tipoDoArquivo: String(dados.tipoDoArquivo ?? ""),
    nomeDoArquivo: dados.nomeDoArquivo === undefined ? undefined : String(dados.nomeDoArquivo),
  });
  if (!resultado.ok) return { ok: false, erro: resultado.frase };
  return { ok: true, dado: { publicacaoId: resultado.publicacaoId } };
}

/**
 * A tela pergunta como está uma publicação (e, se o vídeo já estiver pronto, é esta pergunta que o publica, se o worker ainda não o fez). Devolve também em quantos segundos perguntar de novo: a tela obedece a esse número. Só o dono; só da marca da sessão; o "ver como" nunca,
 * porque a conferência pode publicar.
 */
export async function conferirPublicacaoAction(publicacaoId: number): Promise<ResultadoAcao<{ vista: VistaDaPublicacao; reconferirEmSeg: number | null }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) return { ok: false, erro: fraseDeRecusa("so-dono") };
  await exigirAssinaturaValida();
  const quem = await quemPublica();
  const id = idDoBancoOuNulo(publicacaoId);
  if (!quem || id === null) return { ok: false, erro: fraseDeRecusa("nao-achou") };
  if (!(await ehDonoDaMarca(quem.usuarioId, quem.clienteId))) return { ok: false, erro: fraseDeRecusa("so-dono") };
  const resultado = await conferirPublicacao(id, { clienteId: quem.clienteId });
  if (!resultado.vista) return { ok: false, erro: fraseDeRecusa("nao-achou") };
  if (resultado.vista.estado === "publicada") revalidatePath("/roteiros");
  return { ok: true, dado: { vista: resultado.vista, reconferirEmSeg: resultado.reconferirEmSeg } };
}

/** "Cancelar": enquanto o vídeo está subindo ou esperando o Instagram prepará-lo (não depois de mandado publicar). Libera o roteiro para tentar de novo. */
export async function cancelarEnvioAction(publicacaoId: number): Promise<ResultadoAcao<{ vista: VistaDaPublicacao }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) return { ok: false, erro: fraseDeRecusa("so-dono") };
  await exigirAssinaturaValida();
  const quem = await quemPublica();
  const id = idDoBancoOuNulo(publicacaoId);
  if (!quem || id === null) return { ok: false, erro: fraseDeRecusa("nao-achou") };
  const vista = await cancelarEnvio(quem.usuarioId, quem.clienteId, id);
  if (!vista) return { ok: false, erro: fraseDeRecusa("nao-achou") };
  return { ok: true, dado: { vista } };
}
