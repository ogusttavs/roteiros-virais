import type { CausaDoErroIA } from "@/ia/erro";

import { envolverEmail } from "./casca-email";

/**
 * O e-mail do admin quando a IA está trancada por uma causa que só o dono resolve: a chave da Anthropic recusada ou a conta sem crédito (achado B1 da revisão de 23/11/2026: a chave voltou 401 em
 * produção e ninguém soube). Sai no máximo uma vez por dia por causa, enquanto a falha seguir aparecendo. Texto interno (só o admin lê), mas sem travessão e sem emoji, como todo o projeto.
 */

type CausaQueTranca = Extract<CausaDoErroIA, "credito" | "chave">;

const O_QUE_ACONTECEU: Record<CausaQueTranca, string> = {
  chave: "a Anthropic recusou a chave da IA (erro 401)",
  credito: "a conta da Anthropic está sem crédito",
};

const O_QUE_FAZER: Record<CausaQueTranca, string> = {
  chave:
    "Confira a ANTHROPIC_API_KEY no .env da máquina de produção (e se a chave ainda existe no console da Anthropic), e reinicie o aplicativo e o worker depois de trocar.",
  credito: "Recarregue em Plans & Billing, no console da Anthropic. A IA volta sozinha na próxima geração.",
};

export type FalhaParaOAviso = { causa: CausaQueTranca; tarefa: string; em: Date };

function quando(em: Date): string {
  const dia = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(em);
  const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(em);
  return `${dia}, ${hora}`;
}

export const textosAvisoDaIA = {
  assunto: (f: FalhaParaOAviso) => (f.causa === "chave" ? "A chave da IA foi recusada" : "A IA está sem crédito"),
  corpo: (f: FalhaParaOAviso, enderecoDoAdmin: string) =>
    envolverEmail(
      `<p><strong>A IA parou de responder.</strong></p><p>Desde ${quando(f.em)}, ${O_QUE_ACONTECEU[f.causa]}. Nenhum roteiro, tema ou avaliação do briefing sai enquanto isso. A última tarefa que falhou foi "${f.tarefa}".</p><p>O que fazer: ${O_QUE_FAZER[f.causa]}</p><p>Quem usa o aplicativo está vendo "Estamos com um problema do nosso lado e já fomos avisados. Volte mais tarde.". Este aviso sai uma vez por dia enquanto a falha continuar.</p><p><a href="${enderecoDoAdmin}">Abrir o Início do admin</a></p>`,
    ),
};
