/**
 * Job `lembrete` (etapa 12, decisão 5; guardas da etapa 13, ajuste 3 do
 * `PROXIMO.md`): a cada hora cheia, manda e-mail para quem escolheu aquela
 * hora em `/conta` e ainda não abriu o painel hoje. `ultimoAcessoEm` é
 * atualizado pelo layout do painel uma vez por dia (`src/servicos/
 * clientes.ts`); comparado em data local do Brasil, não UTC, mesmo
 * raciocínio de `hojeISO`.
 *
 * Duas guardas novas, para nunca prometer o que não pode cumprir e nunca
 * mandar duas vezes: só envia se existir `temas_dia` do nicho do cliente
 * para hoje (`temaDeHojeExisteParaNicho`), e grava `ultimo_lembrete_em` ao
 * enviar, pulando quem já recebeu hoje (mesma comparação de `acessouHoje`).
 * Isso cobre tanto uma execução manual (`npm run job -- lembrete`) quanto
 * uma repetição do pg-boss no mesmo dia.
 *
 * Grava `ultimo_lembrete_em` **antes** de chamar `enviarEmail`, não depois
 * (achado da revisão adversarial desta etapa): mandar o e-mail e só then
 * gravar deixa uma janela onde o processo pode cair (ou o job ser repetido)
 * depois do e-mail sair mas antes da marca gravar, mandando de novo. Gravar
 * primeiro fecha essa janela; se o envio falhar depois, a marca é desfeita
 * no catch, para não perder o lembrete do cliente naquele dia por causa de
 * uma falha comum do provedor de e-mail (mais provável que o processo cair
 * no meio).
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { clientes, user } from "@/db/schema";
import { horaAtualISO } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { acessouHoje } from "@/servicos/clientes";
import { temaDeHojeExisteParaNicho } from "@/servicos/temas";
import { textosEmail } from "@/textos/email";

/**
 * `agora` é injetável (hora real por padrão) para o teste de integração
 * poder escolher um `clientes.hora_lembrete` determinístico, em vez de
 * depender da hora real do relógio de quem roda o teste.
 */
export async function rodarLembrete(agora = new Date()): Promise<Record<string, unknown>> {
  const horaAtual = horaAtualISO(agora);

  const candidatos = await db()
    .select({
      clienteId: clientes.id,
      email: user.email,
      nichoId: clientes.nichoId,
      ultimoAcessoEm: clientes.ultimoAcessoEm,
      ultimoLembreteEm: clientes.ultimoLembreteEm,
    })
    .from(clientes)
    .innerJoin(user, eq(user.id, clientes.usuarioId))
    .where(and(eq(clientes.ativo, true), eq(clientes.horaLembrete, horaAtual)));

  let enviados = 0;
  let jaAbriram = 0;
  let jaReceberam = 0;
  let semTema = 0;
  const erros: string[] = [];

  for (const candidato of candidatos) {
    if (acessouHoje(candidato.ultimoAcessoEm, agora)) {
      jaAbriram += 1;
      continue;
    }
    if (acessouHoje(candidato.ultimoLembreteEm, agora)) {
      jaReceberam += 1;
      continue;
    }
    if (!candidato.nichoId || !(await temaDeHojeExisteParaNicho(candidato.nichoId, agora))) {
      semTema += 1;
      continue;
    }

    try {
      await db().update(clientes).set({ ultimoLembreteEm: agora }).where(eq(clientes.id, candidato.clienteId));
      try {
        await enviarEmail({
          para: candidato.email,
          assunto: textosEmail.assuntoLembrete,
          html: textosEmail.corpoLembrete(),
        });
        enviados += 1;
      } catch (erroDeEnvio) {
        await db()
          .update(clientes)
          .set({ ultimoLembreteEm: candidato.ultimoLembreteEm })
          .where(eq(clientes.id, candidato.clienteId));
        throw erroDeEnvio;
      }
    } catch (erro) {
      erros.push(`cliente ${candidato.clienteId}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  return {
    horaAtual,
    candidatos: candidatos.length,
    enviados,
    jaAbriram,
    jaReceberam,
    semTema,
    erros: erros.length > 0 ? erros : undefined,
  };
}
