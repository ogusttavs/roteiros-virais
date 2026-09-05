/**
 * Job `lembrete` (etapa 12, decisão 5 do `PROXIMO.md`): a cada hora cheia,
 * manda e-mail para quem escolheu aquela hora em `/conta` e ainda não abriu
 * o painel hoje. `ultimoAcessoEm` é atualizado pelo layout do painel uma vez
 * por dia (`src/servicos/clientes.ts`); comparado em data local do Brasil,
 * não UTC, mesmo raciocínio de `hojeISO`.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { clientes, user } from "@/db/schema";
import { horaAtualISO } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { acessouHoje } from "@/servicos/clientes";
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
      ultimoAcessoEm: clientes.ultimoAcessoEm,
    })
    .from(clientes)
    .innerJoin(user, eq(user.id, clientes.usuarioId))
    .where(and(eq(clientes.ativo, true), eq(clientes.horaLembrete, horaAtual)));

  let enviados = 0;
  let jaAbriram = 0;
  const erros: string[] = [];

  for (const candidato of candidatos) {
    if (acessouHoje(candidato.ultimoAcessoEm, agora)) {
      jaAbriram += 1;
      continue;
    }

    try {
      await enviarEmail({
        para: candidato.email,
        assunto: textosEmail.assuntoLembrete,
        html: textosEmail.corpoLembrete(),
      });
      enviados += 1;
    } catch (erro) {
      erros.push(`cliente ${candidato.clienteId}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  return {
    horaAtual,
    candidatos: candidatos.length,
    enviados,
    jaAbriram,
    erros: erros.length > 0 ? erros : undefined,
  };
}
