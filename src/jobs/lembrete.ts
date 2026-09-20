/**
 * Job `lembrete` (etapa 12, decisão 5; guardas da etapa 13, ajuste 3; V3,
 * item 6 do `PROXIMO.md`): a cada hora cheia, manda um e-mail por PESSOA
 * (não por marca) para quem escolheu aquela hora em `/conta`, listando as
 * marcas dela que têm tema do dia e ainda não foram abertas hoje, por ela ou
 * por outro membro. `clientes.ultimoAcessoEm` é o acesso da marca inteira
 * (`src/servicos/clientes.ts`, `registrarAcessoHoje`), atualizado por
 * qualquer membro que abre o painel; é essa a coluna que decide se uma marca
 * está pendente, não o acesso individual em `membrosMarca`. Comparado em
 * data local do Brasil, não UTC, mesmo raciocínio de `hojeISO`.
 *
 * Duas guardas por pessoa, para nunca mandar duas vezes e nunca mandar um
 * e-mail vazio: pula quem já recebeu hoje (`acessouHoje` sobre
 * `preferenciasUsuario.ultimoLembreteEm`), e sem nenhuma marca pendente não
 * envia. Uma marca só entra na lista se tiver tema do dia
 * (`temasDoDiaOuRecente`, a mesma regra de estabilidade de `/hoje`: o mais
 * recente dos últimos 3 dias, não só hoje) e ainda não tiver sido aberta
 * hoje. Isso cobre tanto uma execução manual (`npm run job -- lembrete`)
 * quanto uma repetição do pg-boss no mesmo dia.
 *
 * Grava `ultimo_lembrete_em` **antes** de chamar `enviarEmail`, não depois
 * (achado da revisão adversarial da etapa 13): mandar o e-mail e só then
 * gravar deixa uma janela onde o processo pode cair (ou o job ser repetido)
 * depois do e-mail sair mas antes da marca gravar, mandando de novo. Gravar
 * primeiro fecha essa janela; se o envio falhar depois, a marca é desfeita
 * no catch, para não perder o lembrete da pessoa naquele dia por causa de
 * uma falha comum do provedor de e-mail (mais provável que o processo cair
 * no meio).
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { clientes, membrosMarca, preferenciasUsuario, user } from "@/db/schema";
import { hojeISO, horaAtualISO } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { acessouHoje } from "@/servicos/clientes";
import { temasDoDiaOuRecente } from "@/servicos/temas";
import { textosEmail } from "@/textos/email";

/**
 * `agora` é injetável (hora real por padrão) para o teste de integração
 * poder escolher uma `preferencias_usuario.hora_lembrete` determinística, em
 * vez de depender da hora real do relógio de quem roda o teste.
 */
export async function rodarLembrete(agora = new Date()): Promise<Record<string, unknown>> {
  const horaAtual = horaAtualISO(agora);
  const hoje = hojeISO(agora);

  const candidatos = await db()
    .select({
      usuarioId: preferenciasUsuario.usuarioId,
      email: user.email,
      ultimoLembreteEm: preferenciasUsuario.ultimoLembreteEm,
    })
    .from(preferenciasUsuario)
    .innerJoin(user, eq(user.id, preferenciasUsuario.usuarioId))
    .where(eq(preferenciasUsuario.horaLembrete, horaAtual));

  let enviados = 0;
  let jaReceberam = 0;
  let semMarcaPendente = 0;
  const erros: string[] = [];

  for (const candidato of candidatos) {
    if (acessouHoje(candidato.ultimoLembreteEm, agora)) {
      jaReceberam += 1;
      continue;
    }

    const marcasDoCandidato = await db()
      .select({
        nome: clientes.nome,
        ativo: clientes.ativo,
        nichoId: clientes.nichoId,
        ultimoAcessoEm: clientes.ultimoAcessoEm,
      })
      .from(membrosMarca)
      .innerJoin(clientes, eq(clientes.id, membrosMarca.clienteId))
      .where(eq(membrosMarca.usuarioId, candidato.usuarioId));

    const nomesPendentes: string[] = [];
    for (const marca of marcasDoCandidato) {
      if (!marca.ativo) continue;
      if (acessouHoje(marca.ultimoAcessoEm, agora)) continue;
      if (!marca.nichoId || !(await temasDoDiaOuRecente(marca.nichoId, hoje))) continue;
      nomesPendentes.push(marca.nome);
    }

    if (nomesPendentes.length === 0) {
      semMarcaPendente += 1;
      continue;
    }

    try {
      await db()
        .update(preferenciasUsuario)
        .set({ ultimoLembreteEm: agora })
        .where(eq(preferenciasUsuario.usuarioId, candidato.usuarioId));
      try {
        await enviarEmail({
          para: candidato.email,
          assunto: textosEmail.assuntoLembrete,
          html: textosEmail.corpoLembrete(nomesPendentes),
        });
        enviados += 1;
      } catch (erroDeEnvio) {
        await db()
          .update(preferenciasUsuario)
          .set({ ultimoLembreteEm: candidato.ultimoLembreteEm })
          .where(eq(preferenciasUsuario.usuarioId, candidato.usuarioId));
        throw erroDeEnvio;
      }
    } catch (erro) {
      erros.push(`usuario ${candidato.usuarioId}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  return {
    horaAtual,
    candidatos: candidatos.length,
    enviados,
    jaReceberam,
    semMarcaPendente,
    erros: erros.length > 0 ? erros : undefined,
  };
}
