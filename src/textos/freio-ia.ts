import { envolverEmail } from "./casca-email";

/**
 * Os textos do freio de gasto da IA por marca (achado A4 da auditoria de segurança de 26/11/2026, `src/ia/freio.ts`): a frase que a pessoa lê quando a marca passa do limite e o e-mail
 * do alarme da IA para o admin. A frase da pessoa não fala em dólar nem em limite: diz o que aconteceu, por que e quando volta.
 */

export type JanelaDoAviso = "hora" | "dia";

export type FreioParaOAviso = { clienteId: number; nome: string; tarefa: string; janela: JanelaDoAviso; gastoUsd: number; limiteUsd: number; em: Date };

function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function quando(em: Date): string {
  const dia = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(em);
  const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(em);
  return `${dia}, ${hora}`;
}

const dolar = (valor: number) => `US$ ${valor.toFixed(2).replace(".", ",")}`;

const NA_JANELA: Record<JanelaDoAviso, string> = { hora: "na última hora", dia: "nas últimas 24 horas" };

const VARIAVEL_DO_LIMITE: Record<JanelaDoAviso, string> = { hora: "FREIO_IA_POR_HORA_USD", dia: "FREIO_IA_POR_DIA_USD" };

export const textosFreioDaIA = {
  cliente: {
    hora: "Você pediu muita coisa em pouco tempo. Para proteger a sua conta, espere um pouco e tente de novo.",
    dia: "Você já usou bastante o aplicativo hoje. Para proteger a sua conta, novos pedidos voltam em algumas horas. Se precisar antes, fale com a gente.",
  } satisfies Record<JanelaDoAviso, string>,
  aviso: {
    assunto: (f: FreioParaOAviso) => `A marca ${f.nome} passou do limite de gasto da IA`,
    corpo: (f: FreioParaOAviso, enderecoDaConta: string) =>
      envolverEmail(
        `<p><strong>Uma marca passou do limite de gasto da IA.</strong></p><p>Em ${quando(f.em)}, a marca "${escaparHtml(f.nome)}" (conta ${f.clienteId}) chegou a ${dolar(f.gastoUsd)} de IA ${NA_JANELA[f.janela]}; o limite é ${dolar(f.limiteUsd)}. A tarefa recusada foi "${escaparHtml(f.tarefa)}". As outras marcas seguem normais.</p><p>Enquanto o gasto dessa janela não cair abaixo do limite, os pedidos dessa marca são recusados com uma frase para esperar. Se for uso de verdade, suba o limite em ${VARIAVEL_DO_LIMITE[f.janela]} no .env (ou desligue o freio com FREIO_IA=0) e reinicie o aplicativo e o worker. Se não for, confira quem está entrando nessa conta.</p><p>Este aviso sai uma vez por dia por marca.</p><p><a href="${enderecoDaConta}">Abrir a conta no admin</a></p>`,
      ),
  },
};
