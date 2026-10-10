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
 *
 * V9b, item 4: quando a marca tem plano colado para hoje, o e-mail traz os
 * itens do plano (lugar e situação, `planoDoDia` já exclui pulado) acima do
 * texto de sempre. `nomesPendentes` virou `MarcaPendente[]` para carregar
 * esses itens junto do nome.
 *
 * E39a, item 7: o e-mail também lista o que já está marcado na Agenda daquele
 * dia (`agendaDoDia`), reels e stories, com o estado de cada um. É uma lista
 * a mais, não troca o texto de sempre nem o gatilho de quem recebe (a marca
 * continua "pendente" por não ter sido aberta hoje com tema pronto, do jeito
 * que já era antes da agenda existir).
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { clientes, membrosMarca, preferenciasUsuario, user } from "@/db/schema";
import { config, hojeISO, horaAtualISO } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { logger } from "@/lib/log";
import { enviarPush } from "@/lib/push";
import { acessouHoje } from "@/servicos/clientes";
import { planoDoDia } from "@/servicos/plano";
import {
  apagarInscricao,
  inscricoesDaPessoa,
  registrarEnvioBemSucedido,
  registrarFalhaDeEnvio,
  registrarFalhaQueNaoConta,
} from "@/servicos/push";
import { agendaDoDia, atrasados } from "@/servicos/roteiro";
import { temasDoDiaOuRecente } from "@/servicos/temas";
import { marcasComAssuntoDoMomento, textosEmail, type ItemAgendaPendente, type MarcaPendente } from "@/textos/email";
import { textosPush } from "@/textos/push";

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
  let enviadosPorPush = 0;
  const erros: string[] = [];

  for (const candidato of candidatos) {
    if (acessouHoje(candidato.ultimoLembreteEm, agora)) {
      jaReceberam += 1;
      continue;
    }

    const marcasDoCandidato = await db()
      .select({
        id: clientes.id,
        nome: clientes.nome,
        ativo: clientes.ativo,
        nichoId: clientes.nichoId,
        ultimoAcessoEm: clientes.ultimoAcessoEm,
      })
      .from(membrosMarca)
      .innerJoin(clientes, eq(clientes.id, membrosMarca.clienteId))
      .where(eq(membrosMarca.usuarioId, candidato.usuarioId))
      // Estável: o aviso fala da primeira marca com o assunto do momento, e a ordem do banco sem ORDER BY muda de um dia para o outro.
      .orderBy(clientes.nome, clientes.id);
    const variasMarcas = marcasDoCandidato.filter((marca) => marca.ativo).length > 1;

    const nomesPendentes: MarcaPendente[] = [];
    for (const marca of marcasDoCandidato) {
      if (!marca.ativo) continue;
      if (acessouHoje(marca.ultimoAcessoEm, agora)) continue;
      const temasDaMarca = marca.nichoId ? await temasDoDiaOuRecente(marca.nichoId, hoje, agora) : null;
      if (!temasDaMarca) continue;
      // E55 PR 2c: o tema do momento só existe no dia dele (`temasDoDiaOuRecente` já tirou o que o assunto deixou de valer): é o que o aviso põe na frente.
      const temaDoMomento = temasDaMarca.dataUsada === hoje ? temasDaMarca.temas.find((tema) => tema.doMomento !== undefined) : undefined;
      const [planoHoje, agendaHoje, atrasadosDaMarca] = await Promise.all([
        planoDoDia(marca.id, hoje),
        agendaDoDia(marca.id, hoje),
        atrasados(marca.id, hoje),
      ]);
      const itensAgenda: ItemAgendaPendente[] = [...agendaHoje.reels, ...agendaHoje.stories].map((item) => ({
        titulo: item.titulo,
        status: item.status,
      }));
      nomesPendentes.push({
        nome: marca.nome,
        emAlta: temaDoMomento?.doMomento ? { assunto: assuntoSemQuebra(temaDoMomento.doMomento.assunto), tituloDoTema: temaDoMomento.titulo } : null,
        atrasados: atrasadosDaMarca.map((item) => item.titulo),
        planoHoje: planoHoje.map((item) => ({ lugar: item.lugar, situacao: item.situacao })),
        agendaHoje: itensAgenda,
      });
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
        // E48 PR 2: quem tem aparelho inscrito recebe o push; o e-mail só sai para quem não tem inscrição ativa, ou quando nenhum push foi aceito
        // (a inscrição que falhou já foi apagada ou contada, e a pessoa não fica sem o lembrete do dia).
        const chegouPorPush = await mandarPush(candidato.usuarioId, nomesPendentes, agora, variasMarcas);
        if (chegouPorPush) {
          enviadosPorPush += 1;
        } else {
          await enviarEmail({
            para: candidato.email,
            assunto: textosEmail.assuntoDoLembrete(nomesPendentes),
            html: textosEmail.corpoLembrete(nomesPendentes),
          });
        }
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
    enviadosPorPush,
    jaReceberam,
    semMarcaPendente,
    erros: erros.length > 0 ? erros : undefined,
  };
}

/** O assunto do momento vem de um feed público: quebra de linha e caractere de controle no meio viram espaço (ele vai no assunto do e-mail e no título do push). */
function assuntoSemQuebra(assunto: string): string {
  return assunto.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * O push do lembrete para os aparelhos inscritos da pessoa (E48 PR 2). O texto: "O seu roteiro de hoje está pronto" quando alguma marca dela tem roteiro marcado
 * na agenda do dia, senão "Os temas de hoje chegaram"; o toque abre `/hoje`. 404 e 410 apagam a inscrição na hora; outra falha conta uma vez e a segunda seguida
 * apaga. Devolve se algum aparelho aceitou o aviso (se nenhum aceitou, quem chama manda o e-mail).
 */
async function mandarPush(usuarioId: string, marcas: MarcaPendente[], agora: Date, variasMarcas: boolean): Promise<boolean> {
  const inscricoes = await inscricoesDaPessoa(usuarioId);
  if (inscricoes.length === 0) return false;
  const temRoteiroNaAgenda = marcas.some((marca) => marca.agendaHoje.length > 0);
  // E55 PR 2c: o assunto do momento vem na frente do que estiver marcado: o título é o assunto (a notícia do dia, não o nome do app) e o toque abre o Hoje, com o cartão no alto.
  // Quem cuida de mais de uma marca abre o Hoje da marca ativa, que pode não ser a do assunto: o corpo diz de qual marca é.
  const [comAlta] = marcasComAssuntoDoMomento(marcas);
  const aviso = comAlta
    ? { titulo: textosPush.emAlta.titulo(comAlta.emAlta.assunto), corpo: variasMarcas ? textosPush.emAlta.corpoDaMarca(comAlta.nome) : textosPush.emAlta.corpo, url: "/hoje" }
    : {
        titulo: config.appName,
        corpo: temRoteiroNaAgenda ? textosPush.roteiroPronto : textosPush.temasChegaram,
        url: "/hoje",
      };
  let algumAceitou = false;
  for (const inscricao of inscricoes) {
    const resultado = await enviarPush(inscricao, aviso);
    if (resultado.ok) algumAceitou = true;
    // A contabilidade de cada aparelho nunca derruba o envio aos outros nem desfaz o carimbo do dia: o aviso já saiu (ou não), e uma falha do banco aqui
    // só deixa a contagem de falhas desatualizada.
    try {
      if (resultado.ok) {
        await registrarEnvioBemSucedido(inscricao.id, agora);
      } else if (resultado.apagar) {
        await apagarInscricao(inscricao.id);
      } else if (resultado.contar) {
        const apagou = await registrarFalhaDeEnvio(inscricao.id, agora);
        logger.warn({ usuarioId, inscricaoId: inscricao.id, apagou, motivo: resultado.motivo }, "lembrete: o push falhou");
      } else {
        // Não conta como falha seguida, mas a falha corrente começa: depois de 14 dias sem nenhum envio aceito a inscrição é apagada.
        const apagou = await registrarFalhaQueNaoConta(inscricao.id, agora);
        logger.warn(
          { usuarioId, inscricaoId: inscricao.id, apagou, motivo: resultado.motivo },
          "lembrete: o push falhou por causa do ambiente ou do servico de push (nao conta como falha do aparelho)",
        );
      }
    } catch (erro) {
      logger.error({ usuarioId, inscricaoId: inscricao.id, err: erro }, "lembrete: nao foi possivel atualizar a inscricao depois do envio");
    }
  }
  return algumAceitou;
}
