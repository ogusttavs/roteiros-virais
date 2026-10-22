"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { dadosFixosDoBriefing } from "@/config/briefing";
import { AJUDA_EM_DA_FICHA, EXEMPLO_DA_FICHA, FICHAS_EM_ORDEM, FRASE_DA_FICHA, NOME_DA_FICHA, objetivoDaFicha, OBJETIVO_DO_SEM_FALA, OBJETIVO_DO_STORY, PARECE_FEITO_PARA } from "@/config/fichas";
import type { EstiloRoteiro, Ficha, FormatoRoteiro, MomentoDoDia, Objetivo, QuemGrava, TipoMarca } from "@/db/schema";
import {
  DESCRICAO_ESTILO_ROTEIRO,
  ESTILOS_ROTEIRO_EM_ORDEM,
  FORMATOS_ROTEIRO_EM_ORDEM,
  ROTULO_ESTILO_ROTEIRO,
  ROTULO_FORMATO_ROTEIRO,
} from "@/ia/enums";
import { hojeISO } from "@/lib/config";
import { ehFalhaDeRede } from "@/lib/offline";
import type { OrigemRoteiro } from "@/servicos/roteiro";
import { textosComuns } from "@/textos/comuns";
import { textosObjetivo } from "@/textos/objetivo";
import { textosPesquisa } from "@/textos/pesquisa";
import { BarraAcao } from "@/ui/componentes/BarraAcao";
import { CampoComFala } from "@/ui/componentes/CampoComFala";
import { OpcaoObjetivo } from "@/ui/componentes/OpcaoObjetivo";
import { PerguntaMomentoDoDia, PerguntaParaQuando } from "@/ui/componentes/PerguntaAgendamento";
import { TelaEscrevendo } from "@/ui/componentes/TelaEscrevendo";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import { grupoRecenteDesdeAction } from "../../hoje/acoes";
import { FolhaDetalhesVideo } from "../../referencias/FolhaDetalhesVideo";

import { exemplosDaFichaAction, gerarVersoesAction, sugerirEstiloAction, type ExemploDaFicha } from "./acoes";
import { chaveDaEscolha, gravarEscolha, lerEscolha } from "./escolha-guardada";
import styles from "./ObjetivoTela.module.css";

/** A capa do exemplo: a miniatura da plataforma quando existe e carrega; senão o retângulo neutro com o ícone, como no cartão de Referências. */
function CapaDoExemplo({ capaUrl }: { capaUrl: string | null }) {
  const [comErro, setComErro] = useState(false);
  return (
    <span className={styles.exemploCapa} aria-hidden="true" data-capa={capaUrl !== null && !comErro ? "imagem" : "neutra"}>
      {capaUrl !== null && !comErro ? (
        // eslint-disable-next-line @next/next/no-img-element -- url externa (CDN da plataforma), sem otimizacao do Next
        <img src={capaUrl} alt="" className={styles.exemploCapaImagem} onError={() => setComErro(true)} />
      ) : (
        <Play size={20} strokeWidth={1.5} aria-hidden="true" />
      )}
    </span>
  );
}

type Props = {
  origem: OrigemRoteiro;
  temaEscolhidoTexto: string;
  /** E49 PR 1: a ficha que já vem marcada, e de onde veio a recomendação (o tema escolhido, ou o que a pessoa tem postado). */
  fichaRecomendada: Ficha | null;
  recomendadaPor: "tema" | "historico";
  tipo: TipoMarca;
  /** V12c, item 3, a E37b: o `quemGrava` do briefing, para o controle já nascer marcado nele. */
  quemGravaPadrao: QuemGrava | null;
  /** Decisão pendente 5, revisão do Fable no PR #90: veio de "Criar roteiro" num dia vazio que não
   * é hoje; "para quando é" já nasce marcado naquele dia, em vez de hoje. */
  dataInicial?: string;
  /** E43: presente quando o tema veio de "Criar vídeo com esta notícia". */
  noticiaId?: number;
  /** E53 (parte 3): idem, quando a notícia é de um assunto que a marca acompanha. */
  noticiaAssuntoId?: number;
  /** E55 PR 2b: o roteiro é de um assunto em alta, para hoje: a pergunta "Para quando é?" some e a data vai fixa em hoje (o servidor recusa outro dia). */
  paraHoje?: boolean;
  /** E55 PR 2b: a chave do assunto em alta que a pessoa trouxe preso ao Tema livre; vai ao servidor junto, para o roteiro nascer do momento. */
  assuntoEmAlta?: string;
  /** E28 (parte 3): a chave da pergunta do público que a pessoa trouxe presa ao Tema livre; vai ao servidor junto, para o roteiro responder a ela. */
  perguntaChave?: string;
  /** E54 (parte 3): a pesquisa que a pessoa aprovou para este vídeo (`?pesquisa=`), com quantos dados ela marcou; o id vai ao servidor junto, que confere de novo que é desta marca. */
  pesquisa?: { id: number; dados: number };
};

/** `/criar/objetivo` (etapa 11, brief-frontend.md 6.3; `ObjetivoFluxo.dc.html`). */
export function ObjetivoTela({
  origem,
  temaEscolhidoTexto,
  fichaRecomendada,
  recomendadaPor,
  tipo,
  quemGravaPadrao,
  dataInicial,
  noticiaId,
  noticiaAssuntoId,
  paraHoje = false,
  assuntoEmAlta,
  perguntaChave,
  pesquisa,
}: Props) {
  // V12c, item 3: pessoa tem "quem aparece" fixo (config/briefing.ts); o controle nem aparece.
  const opcoesQuemAparece = dadosFixosDoBriefing(tipo).quemGrava;
  const router = useRouter();
  // E49 PR 1: a ficha recomendada pelo tema já vem marcada; a pessoa troca. O Story não pergunta.
  const [ficha, setFicha] = useState<Ficha | null>(fichaRecomendada);
  // E49 PR 2: depois de ESCOLHER uma ficha (um toque), ela fica sozinha com "Ver as cinco de novo" e embaixo vêm os exemplos do setor; a recomendada já marcada não fecha a lista.
  const [compacta, setCompacta] = useState(false);
  const [exemplos, setExemplos] = useState<ExemploDaFicha[] | null>(null);
  // Hotfix de 22/10/2026: o toque num exemplo abre a prévia do vídeo NA PRÓPRIA TELA (a mesma folha de Referências), sem sair do passo; o Voltar do aparelho fecha só a folha.
  const [exemploAbertoId, setExemploAbertoId] = useState<number | null>(null);
  const previa = useFolhaNoHistorico(exemploAbertoId !== null, () => setExemploAbertoId(null));
  const exemploAberto = exemplos?.find((e) => e.id === exemploAbertoId) ?? null;
  // O caminho de onde a pessoa está (com os parâmetros de agora): é o que "Ver mais em Referências" leva como `voltar`, para Referências poder trazê-la de volta.
  const caminhoAtual = usePathname();
  const parametrosAtuais = useSearchParams().toString();
  const caminhoParaVoltar = parametrosAtuais ? `${caminhoAtual}?${parametrosAtuais}` : caminhoAtual;
  // Falha de rede não é "sem exemplos": a seção some em silêncio e o roteiro segue.
  const [exemplosFalharam, setExemplosFalharam] = useState(false);
  // O formato vem ANTES da pergunta (passo 18b): Reels é o padrão, e a pessoa escolhe Story se quiser.
  const [formato, setFormato] = useState<FormatoRoteiro>("reels");
  // Os exemplos acompanham a ficha escolhida (só no modo compacto); a resposta de uma escolha anterior que chega tarde não troca a de agora.
  useEffect(() => {
    if (!compacta || !ficha) return;
    let cancelado = false;
    setExemplos(null);
    setExemplosFalharam(false);
    exemplosDaFichaAction(ficha)
      .then((lista) => {
        if (!cancelado) setExemplos(lista);
      })
      .catch(() => {
        if (!cancelado) setExemplosFalharam(true);
      });
    return () => {
      cancelado = true;
    };
  }, [compacta, ficha]);

  /**
   * M4, item 2: o segundo controle segmentado, Falando/Sem fala. Ao contrário do formato (decidido
   * pelo objetivo, por código, sem round-trip), o estilo nasce da evidência do tema, então a
   * sugestão chega por uma Server Action (`sugerirEstiloAction`) assim que a tela monta.
   */
  const [estilo, setEstilo] = useState<EstiloRoteiro>("falado");
  // A pergunta das fichas só existe no Reels falado: o Story não pergunta, e o sem fala segue o roteiro de cenas (a estrutura das fichas pressupõe fala).
  const pergunta = formato === "reels" && estilo === "falado";
  const [estiloTocado, setEstiloTocado] = useState(false);
  /** E40, item 2: "o que este vídeo precisa comunicar?", opcional, até 200 caracteres. */
  const [objetivoDoVideo, setObjetivoDoVideo] = useState("");
  /** V12c, item 3: nasce no padrão do cliente; a pessoa troca só para este vídeo. */
  const [quemAparece, setQuemAparece] = useState<QuemGrava | "">(quemGravaPadrao ?? "");
  /** E39a: "para quando é?" (dúvida 10: nos temas de hoje e no assunto seu, depois do tema escolhido). */
  const [data, setData] = useState(() => (paraHoje ? hojeISO() : (dataInicial ?? hojeISO())));
  const [momentoDoDia, setMomentoDoDia] = useState<MomentoDoDia | null>(null);

  /**
   * Hotfix de 22/10/2026: o que a pessoa já escolheu aqui fica no `sessionStorage`, por tema; quem vai a Referências (ou recarrega) volta e acha tudo como deixou. Lê uma vez, depois de montar (o servidor
   * não tem `sessionStorage`); só passa a gravar depois de ter lido, para o padrão da tela não apagar a escolha guardada.
   */
  const chaveDaEscolhaDoTema = chaveDaEscolha([origem.origem, temaEscolhidoTexto, noticiaId, noticiaAssuntoId, assuntoEmAlta, perguntaChave, pesquisa?.id]);
  const [escolhaLida, setEscolhaLida] = useState(false);

  // A sugestão que chega depois de a pessoa já ter tocado no controle nunca sobrescreve a escolha dela.
  const estiloTocadoRef = useRef(false);
  // A frase que a tela de erro mostra (ou null, sem erro): falha do servidor e queda de rede dizem coisas diferentes.
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciarTransicao] = useTransition();
  const tratarFalha = useTratarFalha();
  const { avisarRedeOk } = useConexao();
  /**
   * Revisão do PR #62, item 2: "Voltar depois" navegava para o Hoje, mas a transição continuava
   * rodando, e quando `gerarVersoesAction` terminava, o `router.push` para o roteiro disparava de
   * onde a pessoa estivesse (achado do Fable). Mesma ref que `FolhaGravarAgora` já usa: marcada no
   * clique, o sucesso (ou o erro) depois dela não navega nem escreve na tela mais.
   */
  const saiuRef = useRef(false);

  useEffect(() => {
    const guardada = lerEscolha(chaveDaEscolhaDoTema, hojeISO());
    if (guardada) {
      if (guardada.formato) setFormato(guardada.formato);
      if (guardada.estiloTocado && guardada.estilo) {
        // Marcado antes da sugestão chegar: a sugestão do tema nunca passa por cima do que a pessoa escolheu.
        estiloTocadoRef.current = true;
        setEstiloTocado(true);
        setEstilo(guardada.estilo);
      }
      if (guardada.ficha) {
        setFicha(guardada.ficha);
        setCompacta(guardada.compacta === true);
      }
      if (guardada.objetivoDoVideo !== undefined) setObjetivoDoVideo(guardada.objetivoDoVideo);
      if (guardada.quemAparece !== undefined && (guardada.quemAparece === "" || opcoesQuemAparece.opcoes.some((o) => o.valor === guardada.quemAparece))) setQuemAparece(guardada.quemAparece);
      if (guardada.data && !paraHoje) setData(guardada.data);
      if (guardada.momentoDoDia !== undefined) setMomentoDoDia(guardada.momentoDoDia);
    }
    setEscolhaLida(true);
    // Só na montagem: a chave é do tema desta tela, que não muda sem a tela desmontar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!escolhaLida) return;
    gravarEscolha(chaveDaEscolhaDoTema, { ficha, compacta, formato, estilo, estiloTocado, objetivoDoVideo, quemAparece, data, momentoDoDia });
  }, [escolhaLida, chaveDaEscolhaDoTema, ficha, compacta, formato, estilo, estiloTocado, objetivoDoVideo, quemAparece, data, momentoDoDia]);

  /**
   * M4, item 2: busca a sugestão assim que a tela monta (o tema já está escolhido antes de chegar
   * aqui, ao contrário do objetivo). `cancelado` evita aplicar uma resposta que chegou depois de a
   * pessoa já ter tocado no controle ou de a tela ter saído.
   */
  useEffect(() => {
    let cancelado = false;
    sugerirEstiloAction(temaEscolhidoTexto)
      .then((sugestao) => {
        if (!cancelado && !estiloTocadoRef.current) setEstilo(sugestao);
      })
      .catch(() => {
        // Sem sugestão por falha de rede: o controle fica em "falado", a pessoa troca se quiser.
      });
    return () => {
      cancelado = true;
    };
  }, [temaEscolhidoTexto]);

  function escrever() {
    if (pergunta && !ficha) return;
    // O Story e o sem fala não têm ficha: o Story grava o objetivo de falar com quem já segue; o sem fala, o de mais gente te conhecer.
    const objetivo: Objetivo = formato === "story" ? OBJETIVO_DO_STORY : !pergunta || !ficha ? OBJETIVO_DO_SEM_FALA : objetivoDaFicha(ficha);
    setErro(null);
    const desdeMs = Date.now();
    iniciarTransicao(async () => {
      try {
        const resultado = await gerarVersoesAction(
          origem,
          objetivo,
          formato,
          estilo,
          objetivoDoVideo.trim() || undefined,
          quemAparece || undefined,
          // O assunto do momento é para hoje e a pergunta não existe: sem data, o servidor usa o hoje dele (a data calculada ao montar a tela seria a de ontem se a pessoa a deixasse aberta até a meia-noite).
          paraHoje ? undefined : data,
          formato === "story" ? (momentoDoDia ?? undefined) : undefined,
          noticiaId,
          pergunta ? (ficha ?? undefined) : undefined,
          assuntoEmAlta,
          noticiaAssuntoId,
          perguntaChave,
          pesquisa?.id,
        );
        if (saiuRef.current) return;
        if (!resultado.ok) {
          setErro(resultado.erro);
          return;
        }
        avisarRedeOk();
        // E26 4b: o que nasce são as três versões do tema; o roteiro só existe depois de "Ficar com esta".
        router.push(`/criar/versoes/${resultado.dado.grupo}`);
      } catch (falha) {
        if (saiuRef.current) return;
        /**
         * R1, item 0c: a geração não depende da aba continuar aberta (o servidor termina mesmo
         * sem ninguém esperando). Uma falha que parece de rede pode ser só a resposta que não
         * voltou, não a geração que não aconteceu: antes de assumir que precisa repetir, confere
         * se já existem versões novas desta marca escritas desde que a espera começou (cada versão
         * é gravada assim que fica pronta).
         */
        if (ehFalhaDeRede(falha)) {
          try {
            const recuperado = await grupoRecenteDesdeAction(desdeMs);
            if (saiuRef.current) return;
            if (recuperado) {
              avisarRedeOk();
              router.push(`/criar/versoes/${recuperado.grupo}`);
              return;
            }
          } catch {
            // Sem resposta nem na recuperação: segue para a frase de rede de sempre, abaixo.
          }
        }
        if (saiuRef.current) return;
        // Gerar demora e o servidor pode ter terminado antes de a conexão cair: repetir escreve outras versões,
        // então a frase de rede manda olhar o Hoje primeiro (V7, item 4 do PROXIMO.md; E26 4b: as versões prontas aparecem lá).
        setErro(tratarFalha(falha, textosObjetivo.erro, textosObjetivo.conexaoCaiuNoMeio));
      }
    });
  }

  function voltarDepois() {
    saiuRef.current = true;
    // E39a: não /criar; o roteiro, pronto, aparece na Agenda do dia para que ele foi marcado.
    router.push("/hoje");
  }

  if (pendente) {
    return <TelaEscrevendo aberto fraseDemorando={textosObjetivo.demorando} aoVoltarDepois={voltarDepois} titulo={textosObjetivo.esperaVersoesTitulo} duracao={textosObjetivo.esperaVersoesDuracao} />;
  }

  if (erro !== null) {
    // O tema e o objetivo escolhidos continuam na tela: quem tenta de novo confere o que vai pedir (e o Voltar
    // leva de volta sem perder o tema).
    return (
      <div className={styles.pagina}>
        {/* V15, item 2 (design v2, dúvida 2 do passo 7): no erro, o lado é o tema (e o objetivo, se já
            escolhido). Primeiro no DOM, para a ordem no celular continuar a de sempre. */}
        <div className={styles.escolha}>
          <div className={styles.temaEscolhido}>
            <span className={styles.rotulo}>{textosObjetivo.temaEscolhido}</span>
            <span className={styles.tema}>{temaEscolhidoTexto}</span>
            {pesquisa ? <span className={styles.comPesquisa}>{textosPesquisa.objetivo.comPesquisa(pesquisa.dados)}</span> : null}
          </div>
          {pergunta && ficha ? (
            <div className={styles.temaEscolhido}>
              <span className={styles.rotulo}>{textosObjetivo.objetivoEscolhido}</span>
              <span className={styles.tema}>{NOME_DA_FICHA[ficha]}</span>
            </div>
          ) : null}
        </div>
        <div className={styles.colunaPrincipal}>
          <div className={styles.espera}>
            <p className={styles.fraseErro} role="alert">
              {erro}
            </p>
            <BarraAcao
              secundaria={{ rotulo: textosComuns.voltar, onClick: () => router.back() }}
              primaria={{ rotulo: textosComuns.tentarDeNovo, onClick: escrever, precisaDeRede: true }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pagina}>
      {/* V15, item 2 (design v2, dúvida 1 do passo 7): o lado começa no alto, ao lado do título;
          primeiro no DOM, para a ordem no celular continuar a de sempre. */}
      <div className={styles.temaEscolhido}>
        <span className={styles.rotulo}>{textosObjetivo.temaEscolhido}</span>
        <span className={styles.tema}>{temaEscolhidoTexto}</span>
        {pesquisa ? <span className={styles.comPesquisa}>{textosPesquisa.objetivo.comPesquisa(pesquisa.dados)}</span> : null}
      </div>
      <div className={styles.colunaPrincipal}>
      <h1 className={styles.pergunta}>{formato === "story" ? textosObjetivo.storyTitulo : pergunta ? textosObjetivo.pergunta : textosObjetivo.semFalaTitulo}</h1>
      <p className={styles.apoio}>{formato === "story" ? textosObjetivo.storyApoio : pergunta ? textosObjetivo.apoio : textosObjetivo.semFalaTexto}</p>

      <div className={styles.grupoFormato}>
        <span className={styles.rotulo}>{textosObjetivo.formato}</span>
        <div role="tablist" aria-label={textosObjetivo.formato} className={styles.segmentado}>
          {FORMATOS_ROTEIRO_EM_ORDEM.map((opcao) => (
            <button
              key={opcao}
              type="button"
              role="tab"
              aria-selected={formato === opcao}
              className={[styles.segmentoBotao, formato === opcao ? styles.segmentoAtivo : ""]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setFormato(opcao)}
            >
              {ROTULO_FORMATO_ROTEIRO[opcao]}
            </button>
          ))}
        </div>
        <p className={styles.formatoAjuda}>{textosObjetivo.formatoAjuda[formato]}</p>
      </div>

      {pergunta ? (
        <div data-fichas>
          {fichaRecomendada ? (
            <p className={styles.porque} data-recomendada-por={recomendadaPor}>
              {recomendadaPor === "tema" ? textosObjetivo.recomendaPeloTema : textosObjetivo.recomendaPeloHistorico}
              {textosObjetivo.razaoDaRecomendada[fichaRecomendada]}
            </p>
          ) : null}
          <div role="radiogroup" aria-label={textosObjetivo.pergunta} className={styles.opcoes}>
            {FICHAS_EM_ORDEM.filter((f) => !compacta || f === ficha).map((f) => (
              <OpcaoObjetivo
                key={f}
                titulo={NOME_DA_FICHA[f]}
                ajuda={FRASE_DA_FICHA[f]}
                exemplo={EXEMPLO_DA_FICHA[f]}
                ajudaEm={AJUDA_EM_DA_FICHA[f]}
                marcada={ficha === f}
                recomendada={fichaRecomendada === f}
                rotuloRecomendado={textosObjetivo.recomendado}
                onEscolher={() => {
                  setFicha(f);
                  setCompacta(true);
                }}
              />
            ))}
          </div>
          {compacta && ficha ? (
            <>
              <button type="button" className={styles.verAsCinco} onClick={() => setCompacta(false)}>
                {textosObjetivo.verAsCincoDeNovo}
              </button>
              {exemplosFalharam ? null : (
              <section className={styles.exemplos} aria-labelledby="exemplos-titulo" data-exemplos={exemplos === null ? "carregando" : exemplos.length > 0 ? "com" : "sem"}>
                <h3 id="exemplos-titulo">{textosObjetivo.exemplosTitulo}</h3>
                {exemplos === null ? (
                  <p className={styles.apoio}>{textosObjetivo.carregandoExemplos}</p>
                ) : exemplos.length > 0 ? (
                  <>
                    <p className={styles.apoio}>{textosObjetivo.exemplosFrase(PARECE_FEITO_PARA[ficha])}</p>
                    <ul className={styles.listaExemplos}>
                      {exemplos.map((e) => (
                        <li key={e.id} className={styles.exemplo} data-exemplo={e.id}>
                          <button type="button" className={styles.exemploBotao} aria-haspopup="dialog" onClick={() => setExemploAbertoId(e.id)}>
                            <CapaDoExemplo capaUrl={e.video.capaUrl} />
                            <span className={styles.exemploTexto}>
                              <span className={styles.exemploTitulo}>{e.video.titulo}</span>
                              <span className={styles.exemploConta}>
                                {e.video.contaNome}, {e.video.plataformaData}
                              </span>
                              {e.tipo ? <span className={styles.exemploSelo}>{e.tipo}</span> : null}
                              <span className={styles.exemploVer}>{textosObjetivo.verOVideo}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <Link className={styles.verMais} href={`/referencias?feitoPara=${ficha}&periodo=90&voltar=${encodeURIComponent(caminhoParaVoltar)}`}>
                      {textosObjetivo.verMaisEmReferencias}
                    </Link>
                  </>
                ) : (
                  <div className={styles.semExemplos}>
                    <strong>{textosObjetivo.semExemplosTitulo}</strong>
                    <p>{textosObjetivo.semExemplosTexto}</p>
                  </div>
                )}
              </section>
              )}
            </>
          ) : null}
        </div>
      ) : (
        <div className={styles.cartaoStory} data-story-sem-pergunta>
          <h3>{formato === "story" ? textosObjetivo.storyCartaoTitulo : textosObjetivo.semFalaTitulo}</h3>
          <p>{formato === "story" ? textosObjetivo.storyCartaoTexto : textosObjetivo.semFalaTexto}</p>
        </div>
      )}

      <div className={styles.grupoFormato}>
        <span className={styles.rotulo}>{textosObjetivo.estilo}</span>
        <div role="tablist" aria-label={textosObjetivo.estilo} className={styles.segmentado}>
          {ESTILOS_ROTEIRO_EM_ORDEM.map((opcao) => (
            <button
              key={opcao}
              type="button"
              role="tab"
              aria-selected={estilo === opcao}
              className={[styles.segmentoBotao, estilo === opcao ? styles.segmentoAtivo : ""]
                .filter(Boolean)
                .join(" ")}
              title={DESCRICAO_ESTILO_ROTEIRO[opcao]}
              onClick={() => {
                estiloTocadoRef.current = true;
                setEstiloTocado(true);
                setEstilo(opcao);
              }}
            >
              {ROTULO_ESTILO_ROTEIRO[opcao]}
            </button>
          ))}
        </div>
        {!estiloTocado ? <p className={styles.formatoAjuda}>{textosObjetivo.estiloAjuda[estilo]}</p> : null}
      </div>

      {paraHoje ? null : <PerguntaParaQuando data={data} onChange={setData} />}
      {formato === "story" ? <PerguntaMomentoDoDia valor={momentoDoDia} onChange={setMomentoDoDia} /> : null}

      {opcoesQuemAparece.fixoEmPropriaPessoa ? null : (
        <div className={styles.grupoFormato}>
          <span className={styles.rotulo}>{textosObjetivo.quemAparece}</span>
          <div role="radiogroup" aria-label={textosObjetivo.quemAparece} className={styles.opcoes}>
            {opcoesQuemAparece.opcoes.map((opcao) => (
              <OpcaoObjetivo
                key={opcao.valor}
                titulo={opcao.rotulo}
                marcada={quemAparece === opcao.valor}
                onEscolher={() => setQuemAparece(opcao.valor)}
              />
            ))}
          </div>
        </div>
      )}

      <CampoComFala
        rotulo={`${textosObjetivo.objetivoDoVideo} ${textosObjetivo.objetivoDoVideoOpcional}`}
        ajuda={textosObjetivo.objetivoDoVideoAjuda}
        value={objetivoDoVideo}
        onChange={setObjetivoDoVideo}
        placeholder={textosObjetivo.objetivoDoVideoPlaceholder}
        maxLength={200}
        linhasMin={2}
        nomeArquivo="objetivo-do-video"
      />

      <BarraAcao
        secundaria={{ rotulo: textosComuns.voltar, onClick: () => router.back() }}
        primaria={{ rotulo: textosObjetivo.escrever, onClick: escrever, disabled: pergunta && !ficha, precisaDeRede: true }}
      />
      </div>
      <FolhaDetalhesVideo
        video={exemploAberto?.video ?? null}
        url={exemploAberto?.url ?? null}
        aberto={exemploAbertoId !== null}
        aoFechar={previa.fechar}
        soVer={{ rotuloFechar: textosObjetivo.voltarParaORoteiro }}
      />
    </div>
  );
}
