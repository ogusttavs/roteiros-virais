import { redirect } from "next/navigation";

import { chaveDeVozValida } from "@/lib/chave-da-voz";
import { config, hojeISO } from "@/lib/config";
import { formatarFonteEData } from "@/lib/formatarNumero";
import { idDoBancoOuNulo } from "@/lib/id-rota";
import { sessaoDoPainel } from "@/lib/ver-como";
import { noticiaDoAssuntoDaMarca } from "@/servicos/assuntos";
import { clienteDaSessaoAtual, marcasDoUsuario } from "@/servicos/clientes";
import { assuntoPresoDaLista } from "@/servicos/em-alta";
import { noticiaPorId } from "@/servicos/noticias";
import { diaPorExtenso } from "@/servicos/noticias-assuntos";
import { dadosDoCampoDePesquisa } from "@/servicos/pesquisa-na-hora";
import { rascunhoTemaLivre, temasParaCliente } from "@/servicos/temas";
import { listaDePlataformas, perguntaDoPublicoPelaChave } from "@/servicos/vozes-do-publico";
import { textosHoje } from "@/textos/hoje";
import { textosTemaLivre } from "@/textos/tema-livre";
import { textosVozes } from "@/textos/vozes-do-publico";

import { TemaLivreTela } from "./TemaLivreTela";

type Props = { searchParams: Promise<{ tema?: string; data?: string; noticiaId?: string; noticiaAssuntoId?: string; alta?: string; pergunta?: string }> };

/**
 * `?tema=<assunto>` vem de `/referencias`, "usar como referência" (etapa 12,
 * decisão 1 do `PROXIMO.md`): só preenche o campo, o cliente ainda decide
 * clicar em "avaliar o tema". Vence o rascunho salvo (V5b, item 2): é uma
 * escolha explícita de agora, não um texto esquecido de uma visita anterior.
 *
 * `?noticiaId=<id>` vem de `/noticias`, "Criar vídeo com esta notícia" (E43): escopado pelo nicho
 * do cliente (`noticiaPorId`), nunca confiando num id de outro setor vindo da URL; sem rascunho
 * nem `?tema=` junto (o campo nasce vazio, a pergunta é "o que você pensou", não um assunto).
 *
 * `?alta=<chave>` vem do Criar (E55 PR 2b), "Trazer para o meu ramo": o assunto em alta fica preso no alto, como a notícia, e vale só se ele ainda está na lista de agora (e não é delicado);
 * sem rascunho nem `?tema=` junto, pelo mesmo motivo da notícia. O assunto é para hoje: quem chega com `?data=` de outro dia abre o Tema livre comum.
 *
 * `?pergunta=<chave>` vem do Hoje, de Referências e do Criar (E28, parte 3), "Responder em vídeo": a pergunta do público fica presa no alto, como a notícia. A chave é achada de novo nas vozes DO
 * SETOR da marca (a do navegador sozinha não vale) e só enquanto passa do piso e a leitura é válida; chave que não acha nada abre o Tema livre comum. Vale para qualquer dia (a pergunta não
 * é de hoje); sem rascunho nem `?tema=` junto, pelo mesmo motivo da notícia.
 */
export default async function TemaLivre({ searchParams }: Props) {
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteDaSessaoAtual();
  const [{ tema, data, noticiaId, noticiaAssuntoId, alta, pergunta }, rascunho, marcas, resultadoTemas, dadosDaPesquisa] = await Promise.all([
    searchParams,
    rascunhoTemaLivre(sessao.user.id, cliente.id),
    marcasDoUsuario(sessao.user.id),
    temasParaCliente(cliente),
    // E54 (parte 3): quantas pesquisas do dia a marca já usou, para o campo "Pesquisar antes de escrever" dizer a verdade.
    // Uma falha da consulta opcional só tira o campo: o Tema livre abre do mesmo jeito.
    dadosDoCampoDePesquisa(cliente.id).catch(() => undefined),
  ]);

  // V9a, item 3 e 4: a mesma folha "Gravar agora" de `/hoje`, com "Estou num momento".
  const objetivoRecomendado = resultadoTemas.status === "ok" ? resultadoTemas.objetivoRecomendado : null;
  const outrasMarcas = marcas.filter((marca) => marca.id !== cliente.id);
  // Decisão pendente 5, revisão do Fable no PR #90: veio de "Criar roteiro" num dia vazio.
  const dataInicial = data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : undefined;

  const noticiaIdBanco = idDoBancoOuNulo(noticiaId);
  const noticiaLinha = noticiaIdBanco && cliente.nichoId ? await noticiaPorId(noticiaIdBanco, cliente.nichoId) : null;
  // E53 (parte 3): "Criar roteiro com esta notícia" numa notícia de um assunto da marca (`?noticiaAssuntoId=`): escopada pela marca da sessão (a notícia de outra marca nunca vem), a mesma folha de "A notícia".
  const noticiaDoAssuntoId = idDoBancoOuNulo(noticiaAssuntoId);
  const noticiaDoAssunto = !noticiaLinha && noticiaDoAssuntoId ? await noticiaDoAssuntoDaMarca(cliente.id, noticiaDoAssuntoId) : null;
  const noticia = noticiaLinha
    ? {
        id: noticiaLinha.id,
        origem: "setor" as const,
        titulo: noticiaLinha.titulo,
        fonteEData: formatarFonteEData(noticiaLinha.fonte, noticiaLinha.publicadoEm),
      }
    : noticiaDoAssunto
      ? {
          id: noticiaDoAssunto.id,
          origem: "assunto" as const,
          titulo: noticiaDoAssunto.titulo,
          fonteEData: formatarFonteEData(noticiaDoAssunto.veiculo, noticiaDoAssunto.publicadoEm),
        }
      : undefined;

  const hoje = hojeISO();
  const assuntoPreso = alta && !noticia && (!dataInicial || dataInicial === hoje) ? await assuntoPresoDaLista(alta, hoje).catch(() => null) : null;
  const emAlta = assuntoPreso
    ? { chave: assuntoPreso.chave, assunto: assuntoPreso.assunto, linha: textosHoje.emAlta.linhaDaFonte(assuntoPreso.doGoogle, assuntoPreso.doYoutube, assuntoPreso.desde) }
    : undefined;

  // E28 (parte 3): a pergunta do público presa (uma origem só: a notícia e o assunto em alta têm a vez antes).
  const perguntaAchada = chaveDeVozValida(pergunta) && !noticia && !emAlta ? await perguntaDoPublicoPelaChave(cliente.nichoId, pergunta).catch(() => null) : null;
  const perguntaGuardada = perguntaAchada;
  const perguntaPreso = perguntaGuardada
    ? {
        chave: perguntaGuardada.chave,
        texto: perguntaGuardada.texto,
        reclamacao: perguntaGuardada.tipo === "objecao",
        linha: textosTemaLivre.comPergunta.origem(
          textosVozes.vezes(perguntaGuardada.tipo, perguntaGuardada.vezes),
          listaDePlataformas(perguntaGuardada.plataformas),
          diaPorExtenso(new Date(perguntaGuardada.lidaEm)),
        ),
      }
    : undefined;

  return (
    <TemaLivreTela
      notaMinima={config.regras.notaMinimaTema}
      temaInicial={noticia || emAlta || perguntaPreso ? "" : (tema ?? rascunho ?? "")}
      objetivoRecomendado={objetivoRecomendado}
      outrasMarcas={outrasMarcas}
      tipo={cliente.tipo}
      quemGravaPadrao={cliente.quemGrava}
      dataInicial={dataInicial}
      noticia={noticia}
      emAlta={emAlta}
      pergunta={perguntaPreso}
      marcaAtivaId={cliente.id}
      pesquisa={dadosDaPesquisa}
    />
  );
}
