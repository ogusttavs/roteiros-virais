/**
 * Job `email-acompanhamento` (V10, item 4): todo dia as 08:00 (fuso do
 * Brasil), manda para `EMAIL_ACOMPANHAMENTO` o resumo do topo da tela
 * `/admin/viagem` mais a linha de ontem de cada marca ativa. Sem a
 * variável, não manda nada (não é erro, só não há destinatário
 * configurado ainda); `agenda.ts` também só agenda com ela preenchida.
 */
import { config } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { acompanhamentoDaViagem, diasDoPeriodo, resumoQuebradoAgora } from "@/servicos/admin-acompanhamento";
import { textosEmailAcompanhamento } from "@/textos/email-acompanhamento";

export async function rodarEmailAcompanhamento(agora = new Date()): Promise<Record<string, unknown>> {
  if (!config.emailAcompanhamento) {
    return { enviado: false, motivo: "EMAIL_ACOMPANHAMENTO nao configurada" };
  }

  // `agora` passado para acompanhamentoDaViagem: sem isso, o "ontem" calculado aqui podia cair
  // num dia diferente do que os dois dias que a consulta interna de fato buscou (cada uma com o
  // seu proprio relogio), e a linha de ontem sumiria do e-mail mesmo com dado real no banco.
  const [ontem] = diasDoPeriodo(2, agora);
  const [resumo, marcas] = await Promise.all([resumoQuebradoAgora(), acompanhamentoDaViagem(7, undefined, agora)]);

  await enviarEmail({
    para: config.emailAcompanhamento,
    assunto: textosEmailAcompanhamento.assunto,
    html: textosEmailAcompanhamento.corpo(resumo, marcas, ontem),
  });

  return { enviado: true, marcas: marcas.length };
}
