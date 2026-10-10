"use server";

import { ErroIA } from "@/ia/erro";
import { type ResultadoAcao } from "@/lib/resultado-acao";
import { recusaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { clienteDaSessaoAtual, ErroAcessoNegado, garantirMembroDaMarca } from "@/servicos/clientes";
import { ErroRoteiro } from "@/servicos/roteiro";
import { ficarComVersao, gerarOutraVersao, paraVersaoDaTela, pedidoDoGrupo, type VersaoParaTela } from "@/servicos/versoes";
import { textosRoteiro } from "@/textos/roteiro";

/** O maior valor de uma coluna `integer` do Postgres: um número maior que isto nunca é um id e estouraria no banco. */
const ID_MAXIMO = 2_147_483_647;
const GRUPO_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Gerar outra" (E26 4b): mais uma versão do mesmo grupo, a mesma pergunta, o mesmo tema e o mesmo objetivo. A marca vem da sessão, nunca do navegador; o grupo de outra marca é "não achei".
 * `ErroIA.mensagemCliente` e `ErroRoteiro.message` voltam como resultado (R1, item 0c).
 */
export async function gerarOutraVersaoAction(grupo: string): Promise<ResultadoAcao<{ versao: VersaoParaTela }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  if (!GRUPO_VALIDO.test(grupo)) return { ok: false, erro: textosRoteiro.versoes.naoEncontrada };
  const cliente = await clienteDaSessaoAtual();
  try {
    // A única porta para outra marca é a marca citada num momento: a pessoa ainda tem de ser da marca, como na hora de escrever a primeira.
    const pedido = await pedidoDoGrupo(cliente.id, grupo);
    if (pedido?.origem === "momento" && pedido.momento.marcaId !== undefined) {
      await garantirMembroDaMarca(sessao.user.id, pedido.momento.marcaId);
    }
    const versao = await gerarOutraVersao(cliente.id, grupo);
    return { ok: true, dado: { versao: paraVersaoDaTela(versao) } };
  } catch (falha) {
    if (falha instanceof ErroIA) return { ok: false, erro: falha.mensagemCliente };
    if (falha instanceof ErroRoteiro) return { ok: false, erro: falha.message };
    throw falha;
  }
}

/** "Ficar com esta" (E26 4b): a versão vira o roteiro e a tela abre nele. Uma vez só por versão (escolher de novo devolve o mesmo roteiro). */
export async function ficarComVersaoAction(versaoId: number): Promise<ResultadoAcao<{ id: number }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  if (!Number.isSafeInteger(versaoId) || versaoId <= 0 || versaoId > ID_MAXIMO) return { ok: false, erro: textosRoteiro.versoes.naoEncontrada };
  const cliente = await clienteDaSessaoAtual();
  try {
    const roteiro = await ficarComVersao(cliente.id, versaoId);
    return { ok: true, dado: { id: roteiro.id } };
  } catch (falha) {
    if (falha instanceof ErroRoteiro) return { ok: false, erro: falha.message };
    throw falha;
  }
}
