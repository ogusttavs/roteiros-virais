"use server";

import { sessaoAtual } from "@/lib/sessao";
import {
  clienteDaSessaoAtual,
  ErroAcessoNegado,
  salvarHoraLembrete,
  salvarPerfilConta,
  salvarTema,
} from "@/servicos/clientes";

/**
 * Uma acao so para o botao "salvar" unico da tela (EntrarContaTela.dc.html):
 * grava nome, perfis e tema (da marca ativa) e a hora do lembrete (da
 * pessoa, V3 item 4), juntos. Cliente e usuario sempre vem da sessao, nunca
 * de um parametro (isolamento no nivel de rota).
 */
export async function salvarContaAction(dados: {
  nome: string;
  perfis: { instagram?: string; tiktok?: string; youtube?: string };
  tema: string;
  horaLembrete: string;
}) {
  const sessao = await sessaoAtual();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  const cliente = await clienteDaSessaoAtual();
  const [clienteAtualizado, , preferencias] = await Promise.all([
    salvarPerfilConta(cliente.id, { nome: dados.nome, perfis: dados.perfis }),
    salvarTema(cliente.id, dados.tema),
    salvarHoraLembrete(sessao.user.id, dados.horaLembrete),
  ]);
  return { ...clienteAtualizado, tema: dados.tema, horaLembrete: preferencias.horaLembrete };
}
