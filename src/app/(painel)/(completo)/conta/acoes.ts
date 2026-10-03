"use server";

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
}) {
  const sessao = await sessaoAtual();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  const cliente = await clienteDaSessaoAtual();
  const [clienteAtualizado, , preferencias] = await Promise.all([
    salvarPerfilConta(cliente.id, { nome: dados.nome, perfis: dados.perfis, site: dados.site }),
    salvarTema(cliente.id, dados.tema),
    salvarHoraLembrete(sessao.user.id, dados.horaLembrete),
    dados.alcance
      ? salvarOndeConta(cliente.id, { alcance: dados.alcance, regiao: dados.regiao, pais: dados.pais, paises: dados.paises })
      : Promise.resolve(null),
    dados.ramo ? salvarRamoConta(cliente.id, dados.ramo) : Promise.resolve(null),
  ]);
  return { ...clienteAtualizado, tema: dados.tema, horaLembrete: preferencias.horaLembrete };
}
