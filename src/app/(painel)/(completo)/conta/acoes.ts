"use server";

import { clienteDaSessaoAtual, salvarPerfilConta, salvarTema } from "@/servicos/clientes";

/**
 * Uma acao so para o botao "salvar" unico da tela (EntrarContaTela.dc.html):
 * grava nome e perfis, e o tema, juntos. O cliente sempre vem da sessao,
 * nunca de um parametro (isolamento no nivel de rota).
 */
export async function salvarContaAction(dados: {
  nome: string;
  perfis: { instagram?: string; tiktok?: string; youtube?: string };
  tema: string;
  horaLembrete: string;
}) {
  const cliente = await clienteDaSessaoAtual();
  const [clienteAtualizado] = await Promise.all([
    salvarPerfilConta(cliente.id, { nome: dados.nome, perfis: dados.perfis, horaLembrete: dados.horaLembrete }),
    salvarTema(cliente.id, dados.tema),
  ]);
  return { ...clienteAtualizado, tema: dados.tema };
}
