"use server";

import type { ResultadoAcao } from "@/lib/resultado-acao";
import { sessaoAtual } from "@/lib/sessao";
import {
  clienteDaSessaoAtual,
  ErroAcessoNegado,
  salvarHoraLembrete,
  salvarOndeConta,
  salvarPerfilConta,
  salvarRamoConta,
  salvarTema,
} from "@/servicos/clientes";
import { registrarPedidoDeRamo } from "@/servicos/pedidos-de-ramo";
import { ErroLimiteDeSetores, ramoAtualDoCliente } from "@/servicos/ramos";
import { textosRamo } from "@/textos/ramo";

/**
 * Uma acao so para o botao "salvar" unico da tela (EntrarContaTela.dc.html):
 * grava nome, perfis e tema (da marca ativa), onde esta o publico (E42a,
 * item 1) e a hora do lembrete (da pessoa, V3 item 4), juntos. Cliente e
 * usuario sempre vem da sessao, nunca de um parametro (isolamento no nivel
 * de rota).
 */
export async function salvarContaAction(dados: {
  nome: string;
  perfis: { instagram?: string; tiktok?: string; youtube?: string };
  /** E38 PR 2: o site da marca; vazio apaga, ausente não mexe. */
  site?: string;
  tema: string;
  horaLembrete: string;
  alcance?: string;
  regiao?: string;
  pais?: string;
  paises?: string;
  /** E45, PR 1: o ramo do catálogo escolhido (o `slug`); ausente não mexe no ramo. */
  ramo?: string;
  /** E45 PR 2: "Não achei o meu": o que a pessoa escreveu; abre (ou atualiza) o pedido de ramo e põe a marca no ramo provisório. */
  ramoOutro?: string;
}): Promise<ResultadoAcao<{ pedidoDeRamo: PedidoDeRamoNaTela | null | undefined }>> {
  const sessao = await sessaoAtual();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  const cliente = await clienteDaSessaoAtual();

  // O ramo vai ANTES do resto, e sozinho: se o teto de setores novos do dia o segura, a frase volta para a tela (`ResultadoAcao`, porque o Next
  // esconde a mensagem de um erro lançado) e NADA do resto foi gravado, então a pessoa tenta tudo de novo amanhã sem uma gravação pela metade.
  // `undefined`: o ramo não mexeu; `null`: o pedido fechou (ela escolheu da lista); objeto: o pedido aberto e o ramo provisório.
  let pedidoDeRamo: PedidoDeRamoNaTela | null | undefined;
  try {
    if (dados.ramo) {
      await salvarRamoConta(cliente.id, dados.ramo);
      pedidoDeRamo = null;
    } else if (dados.ramoOutro?.trim()) {
      const resultado = await registrarPedidoDeRamo(cliente.id, dados.ramoOutro);
      const provisorio = resultado.setorProvisorioId ? await ramoAtualDoCliente(resultado.setorProvisorioId) : null;
      pedidoDeRamo = { texto: resultado.pedido.texto, ramoProvisorio: provisorio?.nome ?? null };
    }
  } catch (erro) {
    if (erro instanceof ErroLimiteDeSetores) return { ok: false, erro: textosRamo.limiteDeRamosNovos };
    throw erro;
  }

  await Promise.all([
    salvarPerfilConta(cliente.id, { nome: dados.nome, perfis: dados.perfis, site: dados.site }),
    salvarTema(cliente.id, dados.tema),
    salvarHoraLembrete(sessao.user.id, dados.horaLembrete),
    dados.alcance
      ? salvarOndeConta(cliente.id, { alcance: dados.alcance, regiao: dados.regiao, pais: dados.pais, paises: dados.paises })
      : Promise.resolve(null),
  ]);
  return { ok: true, dado: { pedidoDeRamo } };
}

/** O pedido de ramo aberto como a tela o mostra: o que a pessoa escreveu e o ramo provisório em que ela espera (nulo se nada casou). */
export type PedidoDeRamoNaTela = { texto: string; ramoProvisorio: string | null };
