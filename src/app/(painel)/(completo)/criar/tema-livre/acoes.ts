"use server";

import type { Cliente } from "@/db/schema";
import { ErroIA } from "@/ia/erro";
import { chaveDeVozValida } from "@/lib/chave-da-voz";
import { fraseDoErroDaIAParaASessao } from "@/lib/erro-ia-da-sessao";
import { exigirAssinaturaValida } from "@/lib/portao-cobranca";
import { type ResultadoAcao } from "@/lib/resultado-acao";
import { exigirForaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { noticiaDoAssuntoComoPontoDePartida, noticiaDoAssuntoDaMarca, noticiaDoSetorComoPontoDePartida } from "@/servicos/assuntos";
import { ErroAcessoNegado, clienteDaSessaoAtual } from "@/servicos/clientes";
import { noticiaPorId } from "@/servicos/noticias";
import { apagarRascunhoTemaLivre, avaliarTema, ErroTemas, guardarNotaNoRascunho, marcaDoTexto, notaGuardadaDoTexto, salvarRascunhoTemaLivre, type ResultadoAvaliarTema } from "@/servicos/temas";
import { textosTemaLivre } from "@/textos/tema-livre";

/**
 * `/hoje/tema-livre` (V5b, item 2): o rascunho salva sozinho, sem bloquear a
 * digitação; falhou, tenta de novo na próxima tecla, sem aviso (o chamador
 * no client trata a rejeição em silêncio).
 */
export async function salvarRascunhoAction(texto: string): Promise<void> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  await salvarRascunhoTemaLivre(sessao.user.id, cliente.id, texto);
}

/**
 * O cliente sempre vem da sessão, nunca de um parâmetro. O rascunho não
 * some mais quando a avaliação termina com sucesso (item 0 da V6, resto da
 * revisão do PR #50): quem recebe uma nota abaixo da meta, sai e volta
 * precisa achar o texto lá. Só some quando a pessoa avalia outro assunto
 * ou apaga o campo (`salvarRascunhoTemaLivre`).
 *
 * E43: `noticiaId` presente quando o tema nasceu de "Criar vídeo com esta
 * notícia". A notícia é resolvida aqui, escopada pelo setor do cliente, nunca
 * confiando num id de outro setor vindo do client.
 *
 * E55 PR 2b: `assuntoEmAlta` é a chave do assunto em alta trazido para o ramo (o Tema livre
 * `?alta=`); `tendenciasQueTocamOTema` só o aceita se ele está na lista de agora e não é delicado.
 *
 * E28 (parte 3): `perguntaChave` é a chave da pergunta do público que a pessoa prendeu (o Tema livre
 * `?pergunta=`); `avaliarTema` a acha de novo nas vozes do setor da marca da sessão (a chave do
 * navegador sozinha não vale: chave que não acha nada é uma nota como antes).
 */
export async function avaliarTemaAction(texto: string, noticiaId?: number, assuntoEmAlta?: string, noticiaAssuntoId?: number, perguntaChave?: string): Promise<ResultadoAcao<ResultadoAvaliarTema>> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  // O tema que veio preso a uma notícia, a um assunto em alta ou a uma pergunta do público é avaliado com esse contexto: a nota dele nunca é guardada nem reaproveitada pelo texto sozinho.
  const comContexto = Boolean(noticiaId || assuntoEmAlta || noticiaAssuntoId || chaveDeVozValida(perguntaChave));

  // Hotfix de 22/10/2026 (item 3): voltar com o MESMO texto já avaliado mostra a nota que ficou guardada, sem chamar a IA (cada avaliação é paga).
  if (!comContexto) {
    const guardada = await notaGuardadaDoTexto(sessao.user.id, cliente.id, texto);
    if (guardada) return { ok: true, dado: guardada };
  }

  // Hotfix de 22/10/2026 (item 4): a mesma avaliação pedida de novo enquanto a primeira ainda roda (toque repetido, página recarregada, "tentar de novo" com pressa) espera a que já está em curso em vez de
  // pagar outra. A chave leva a marca do texto e o contexto; some assim que a primeira termina, com sucesso ou erro.
  const chave = `${cliente.id}:${marcaDoTexto(texto)}:${noticiaId ?? ""}:${assuntoEmAlta ?? ""}:${noticiaAssuntoId ?? ""}:${chaveDeVozValida(perguntaChave) ?? ""}`;
  let emCurso = AVALIACOES_EM_CURSO.get(chave);
  if (!emCurso) {
    emCurso = avaliarEGuardar(sessao.user.id, cliente, texto, comContexto, noticiaId, assuntoEmAlta, noticiaAssuntoId, perguntaChave).finally(() => AVALIACOES_EM_CURSO.delete(chave));
    AVALIACOES_EM_CURSO.set(chave, emCurso);
  }
  return emCurso;
}

/**
 * As avaliações que estão rodando agora neste processo, por marca, texto e contexto (ver `avaliarTemaAction`).
 *
 * Limite conhecido (revisão do Fable de 22/10/2026): isto é memória de UM processo. Hoje há um único container `web` em produção, então o toque repetido espera a chamada em curso e não paga duas
 * vezes. Com duas instâncias, ou durante a troca de container num deploy, o mesmo texto pode ser avaliado (e pago) duas vezes. Se um dia houver mais de um processo, a saída é trocar o `Map` por uma
 * trava no banco, como o webhook do Stripe faz (`pg_advisory_xact_lock`). A chave não leva o `usuarioId` de propósito: duas pessoas da mesma marca dividem a chamada.
 */
const AVALIACOES_EM_CURSO = new Map<string, Promise<ResultadoAcao<ResultadoAvaliarTema>>>();

async function avaliarEGuardar(
  usuarioId: string,
  cliente: Cliente,
  texto: string,
  comContexto: boolean,
  noticiaId?: number,
  assuntoEmAlta?: string,
  noticiaAssuntoId?: number,
  perguntaChave?: string,
): Promise<ResultadoAcao<ResultadoAvaliarTema>> {
  const noticia = noticiaId && cliente.nichoId ? await noticiaPorId(noticiaId, cliente.nichoId) : null;
  // E53 (parte 3): a notícia de um assunto DESTA marca (a de outra nunca vem): o título e o resumo nosso, como a do setor.
  const noticiaDoAssunto = !noticia && noticiaAssuntoId ? await noticiaDoAssuntoDaMarca(cliente.id, noticiaAssuntoId) : null;
  const origem = noticia ? noticiaDoSetorComoPontoDePartida(noticia) : noticiaDoAssunto ? noticiaDoAssuntoComoPontoDePartida(noticiaDoAssunto) : undefined;
  try {
    const resultado = await avaliarTema(cliente, texto, origem, assuntoEmAlta, chaveDeVozValida(perguntaChave));
    if (!comContexto) {
      // Guardar a nota é um favor: se falhar, a pessoa ainda vê a nota agora.
      await guardarNotaNoRascunho(usuarioId, cliente.id, texto, resultado).catch(() => undefined);
    }
    return { ok: true, dado: resultado };
  } catch (falha) {
    // Hotfix de 22/10/2026 (item 4): a falha da IA chega à tela como frase calma (resultado, não exceção: o Next troca a mensagem de uma exceção por um texto genérico em produção), e a tela mostra "Tentar de novo".
    if (falha instanceof ErroIA) return { ok: false, erro: await fraseDoErroDaIAParaASessao(falha) };
    if (falha instanceof ErroTemas) return { ok: false, erro: textosTemaLivre.textoErro };
    throw falha;
  }
}

/**
 * "Descartar" da linha "Continuar de onde parou" do Criar (hotfix de 22/10/2026, item 3): apaga o rascunho do Tema livre desta pessoa, nesta marca, com a nota junto.
 */
export async function descartarTemaLivreAction(): Promise<void> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  await apagarRascunhoTemaLivre(sessao.user.id, cliente.id);
}
