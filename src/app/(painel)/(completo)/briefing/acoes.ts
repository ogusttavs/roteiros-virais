"use server";

import { revalidatePath } from "next/cache";

import { exigirAssinaturaValida } from "@/lib/portao-cobranca";
import { exigirForaDoVerComo } from "@/lib/ver-como";
import { desativarRegra, reativarRegra } from "@/servicos/aprendizado";
import { avaliarResposta, salvarRascunho } from "@/servicos/briefing";
import { clienteDaSessaoAtual, clientePorId } from "@/servicos/clientes";
import { confirmarItem, corrigirItem, desfazerTirarItem, tirarItem } from "@/servicos/contexto-marca";
import {
  confirmarFoco,
  ErroFoco,
  escreverFoco,
  focoParaATela,
  sugerirFoco,
  TAMANHO_MAXIMO_DO_FOCO,
  TAMANHO_MINIMO_DO_FOCO,
  tirarFoco,
  type FocoParaATela,
} from "@/servicos/foco-da-conta";
import { pedirPesquisaDoFoco } from "@/servicos/pesquisa-do-foco";
import { pedirTemasDaConta } from "@/servicos/temas";
import { textosBriefing } from "@/textos/briefing";

/**
 * Edicao do briefing vivo (brief-frontend.md, 6.8). O cliente sempre vem da
 * sessao, nunca de um parametro; mesma defesa de /comecar/acoes.ts.
 */

export async function salvarRascunhoAction(perguntaId: string, resposta: string, transcricaoBruta?: string) {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  const cliente = await clienteDaSessaoAtual();
  await salvarRascunho(cliente.id, perguntaId, resposta, cliente.tipo, transcricaoBruta);
}

export async function avaliarRespostaAction(perguntaId: string, resposta: string) {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  const cliente = await clienteDaSessaoAtual();
  return avaliarResposta(cliente.id, perguntaId, resposta, cliente.tipo);
}

/** "O que a gente aprendeu com você" (E27 parte 2, item 4): "Não é bem assim" e "Desfazer". */
export async function desativarRegraAction(regraId: number): Promise<void> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  const cliente = await clienteDaSessaoAtual();
  await desativarRegra(cliente.id, regraId);
}

export async function reativarRegraAction(regraId: number): Promise<void> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  const cliente = await clienteDaSessaoAtual();
  await reativarRegra(cliente.id, regraId);
}

/**
 * "O que a IA tirou das suas redes e do seu site" (E38 PR 2): confirmar, corrigir, tirar e desfazer
 * um item. A marca vem da sessão (nunca de um parâmetro, e o serviço confere `id` e `clienteId`
 * juntos no `WHERE`): um id de item de outra marca nunca vale.
 */
export async function confirmarItemContextoAction(itemId: number, textoVisto: string): Promise<"confirmado" | "mudou"> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  const cliente = await clienteDaSessaoAtual();
  return confirmarItem(cliente.id, itemId, textoVisto);
}

export async function corrigirItemContextoAction(itemId: number, texto: string): Promise<void> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  const cliente = await clienteDaSessaoAtual();
  await corrigirItem(cliente.id, itemId, texto);
}

export async function tirarItemContextoAction(itemId: number): Promise<void> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  const cliente = await clienteDaSessaoAtual();
  await tirarItem(cliente.id, itemId);
}

export async function desfazerTirarItemContextoAction(itemId: number): Promise<void> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  const cliente = await clienteDaSessaoAtual();
  await desfazerTirarItem(cliente.id, itemId);
}

/**
 * "O foco da sua conta" (E61 PR 1). A conta vem da sessão (nunca de um parâmetro) e cada função do serviço escreve só com o `id` dela. Toda ação devolve o foco como ele ficou (ou como já estava, quando
 * não deu): a tela mostra o que o servidor tem, não o que ela supõe. A frase do erro é escolhida aqui, pelo `motivo`, porque a mensagem de uma exceção não chega à tela em produção.
 */
export type ResultadoFoco = { ok: true; foco: FocoParaATela } | { ok: false; erro: string; foco: FocoParaATela };

const tf = textosBriefing.focoDaConta;

/** Cada ação abaixo chama `exigirForaDoVerComo` e `exigirAssinaturaValida` antes (o `checar-ver-como` e o `checar-portao-cobranca` exigem a chamada em cada uma); aqui só roda a tarefa. */
async function comOFoco(tarefa: (clienteId: number) => Promise<void>, frasePadrao: string, opcoes?: { pedirTemas?: boolean }): Promise<ResultadoFoco> {
  const cliente = await clienteDaSessaoAtual();
  let erro: string | null = null;
  try {
    await tarefa(cliente.id);
  } catch (falha) {
    if (!(falha instanceof ErroFoco)) throw falha;
    erro =
      falha.motivo === "limite_do_dia"
        ? tf.erroSugerirLimite
        : falha.motivo === "sem_base"
          ? tf.erroSugerirSemBriefing
          : falha.motivo === "texto_curto"
            ? tf.textoCurto(TAMANHO_MINIMO_DO_FOCO)
            : falha.motivo === "texto_longo"
              ? tf.textoLongo(TAMANHO_MAXIMO_DO_FOCO)
              : falha.motivo === "ja_confirmado"
                ? tf.mudouEnquantoLia
                : frasePadrao;
  }
  revalidatePath("/briefing");
  // Lê a linha de novo (e não a `cliente` da sessão, que pode ser a de antes da escrita).
  const atual = await clientePorId(cliente.id);
  const foco: FocoParaATela = atual ? focoParaATela(atual) : { estado: "sem" };
  // E61 PR 2: o foco acabou de ficar confirmado (a pessoa disse "Está certo" ou escreveu o dela): os temas do dia dela nascem agora, sem esperar a madrugada. Falha aqui nunca vira erro na tela.
  if (erro === null && opcoes?.pedirTemas && foco.estado === "confirmado" && atual) {
    await pedirTemasDaConta(atual.id, atual.nichoId, foco.texto).catch(() => "nao");
    // E61 PR 3: a pesquisa do assunto dela (frases e canais de referência) também começa agora, só para esta conta.
    await pedirPesquisaDoFoco(atual.id, foco.texto).catch(() => "nao");
  }
  return erro === null ? { ok: true, foco } : { ok: false, erro, foco };
}

export async function sugerirFocoAction(): Promise<ResultadoFoco> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  return comOFoco(async (clienteId) => {
    await sugerirFoco(clienteId);
  }, tf.erroSugerir);
}

export async function confirmarFocoAction(textoVisto: string): Promise<ResultadoFoco> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  return comOFoco(async (clienteId) => {
    if ((await confirmarFoco(clienteId, textoVisto)) === "mudou") throw new ErroFoco("a sugestao mudou", "ja_confirmado");
  }, tf.erroConfirmar, { pedirTemas: true });
}

export async function escreverFocoAction(texto: string): Promise<ResultadoFoco> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  return comOFoco((clienteId) => escreverFoco(clienteId, texto), tf.erroSalvar, { pedirTemas: true });
}

export async function tirarFocoAction(): Promise<ResultadoFoco> {
  await exigirForaDoVerComo();
  await exigirAssinaturaValida();
  return comOFoco((clienteId) => tirarFoco(clienteId), tf.erroTirar);
}
