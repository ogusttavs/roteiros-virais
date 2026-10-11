"use client";

import { CalendarDays, ChevronRight, Mic, Pencil, Search, UserRound, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { rotuloParaQue } from "@/config/fichas";
import type { Objetivo, QuemGrava, TipoMarca } from "@/db/schema";
import type { AssuntoSemEncaixe, CartaoEmAlta as DadosEmAlta } from "@/servicos/em-alta";
import type { DadosDoCampoDePesquisa, PesquisaEmAberto } from "@/servicos/pesquisa-na-hora";
import type { ItemPlano } from "@/servicos/plano";
import type { PerguntasDaTela } from "@/servicos/vozes-do-publico";
import { textosCriar } from "@/textos/criar";
import { textosHoje } from "@/textos/hoje";
import { textosNav } from "@/textos/nav";
import { textosPesquisa } from "@/textos/pesquisa";
import { textosPlano } from "@/textos/plano";
import { textosVozes } from "@/textos/vozes-do-publico";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { CartaoEmAlta, destinoDoCartao } from "@/ui/componentes/CartaoEmAlta";
import { MotivoSemRede } from "@/ui/componentes/MotivoSemRede";
import { ListaDePerguntas } from "@/ui/componentes/PerguntasDoPublico";
import { SemEncaixeEmAlta } from "@/ui/componentes/SemEncaixeEmAlta";
import { ID_FAIXA_SEM_CONEXAO, useConexao } from "@/ui/ConexaoContext";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import { SeletorMarcaCelular, type MarcaResumo } from "../../_casca/SeletorMarcaCelular";
import { useTrocaMarca } from "../../_casca/TrocaMarcaContext";
import { FolhaGravarAgora, type ValoresIniciaisMomento } from "../hoje/FolhaGravarAgora";
import { FolhaMeuPlano } from "../hoje/FolhaMeuPlano";
import { FolhaPlanejarDias } from "../hoje/FolhaPlanejarDias";
import { HojeCabecalho } from "../hoje/HojeCabecalho";
import { pularPlanoAction } from "../hoje/plano/acoes";

import styles from "./CriarTela.module.css";

type Props = {
  marcaAtiva: MarcaResumo;
  marcas: MarcaResumo[];
  nomePessoa: string;
  objetivoRecomendado: Objetivo | null;
  outrasMarcas: MarcaResumo[];
  planoDeHoje: ItemPlano[];
  planoQueVem: ItemPlano[];
  tipo: TipoMarca;
  quemGravaPadrao: QuemGrava | null;
  /** Decisão pendente 5, revisão do Fable no PR #90: veio de "Criar roteiro" num dia vazio que não
   * é hoje; repassada aos caminhos que levam a "para quando é" (temas, assunto seu, momento). */
  dataInicial?: string;
  /** E39c, parte 2a: veio de um sugerido tocado na visão Semana do planejador (`?plano=`, qualquer
   * dia, não só hoje); abre a folha do momento já preenchida com o que a agenda contou daquele dia. */
  itemPlanoInicial?: ItemPlano | null;
  /** A2, item 7: veio do atalho "Criar um Story para hoje" de Hoje (`?formato=story`): abre "Gravar agora" já em Story, com o dia que veio em `dataInicial`. */
  abrirEmStory?: boolean;
  /** O momento que volta preenchido (`?momento=<roteiro>`): abre "Gravar agora" com o que a pessoa tinha contado, editável. */
  momentoInicial?: ValoresIniciaisMomento | null;
  /** E55 PR 2b: o assunto em alta hoje trazido para o ramo da marca, no alto da oficina (nulo sem tema do momento, ou quando se cria para outro dia). */
  emAlta?: DadosEmAlta | null;
  /** E55 PR 2b: sem tema do momento, até três assuntos em alta que não couberam no ramo (nunca os delicados). */
  semEncaixe?: AssuntoSemEncaixe[];
  /** E28 (parte 3b): as perguntas do público desta semana (a quinta porta); nulo no setor sem leitura, e a porta mostra o estado calmo de "ainda sem perguntas". */
  perguntas?: PerguntasDaTela | null;
  /** E54 (parte 3): o dia da marca para o campo "Pesquisar antes de escrever" da folha do momento. */
  pesquisa?: DadosDoCampoDePesquisa;
  /** E54 (parte 3): a pesquisa que a pessoa deixou com "Voltar depois" (rodando, ou pronta e esperando os dados serem marcados). */
  pesquisaEmAberto?: PesquisaEmAberto | null;
};

/**
 * `/criar` (E39a): a oficina. Quatro caminhos sem competir (design v2, `Criar.dc.html`, estado
 * `inicio`); "para quando é" e "em que momento do dia" moram dentro de cada caminho (dúvida 10),
 * não aqui. O plano de hoje, quando existe, fica no alto: é algo para criar, não para acompanhar
 * (Hoje virou só a agenda).
 */
export function CriarTela({
  marcaAtiva,
  marcas,
  nomePessoa,
  objetivoRecomendado,
  outrasMarcas,
  planoDeHoje: planoDeHojeInicial,
  planoQueVem,
  tipo,
  quemGravaPadrao,
  dataInicial,
  itemPlanoInicial,
  abrirEmStory = false,
  momentoInicial = null,
  emAlta = null,
  semEncaixe = [],
  perguntas = null,
  pesquisa,
  pesquisaEmAberto = null,
}: Props) {
  const router = useRouter();
  const { trocando, marcaAlvo } = useTrocaMarca();
  const { semConexao } = useConexao();
  const [ocupado, iniciarTransicao] = useTransition();
  const [acao, setAcao] = useState<string | null>(null);

  const [planoDeHoje, setPlanoDeHoje] = useState(planoDeHojeInicial);
  const [pulandoId, setPulandoId] = useState<number | null>(null);

  /**
   * `useState(planoDeHojeInicial)` acima só lê a prop na primeira montagem: sem este efeito, o
   * plano recém colado (`FolhaPlanejarDias`, `router.refresh()` sem navegação) nunca aparecia,
   * porque Criar não desmonta nesse refresh (achado do e2e desta etapa, `plano.spec.ts`; mesma
   * correção que `HojeTela.tsx` já tinha antes do bloco se mudar para cá).
   */
  useEffect(() => {
    setPlanoDeHoje(planoDeHojeInicial);
  }, [planoDeHojeInicial]);

  const [folhaMomentoAberta, setFolhaMomentoAberta] = useState(false);
  const [itemPlanoParaFolha, setItemPlanoParaFolha] = useState<ItemPlano | null>(null);
  const { fechar: fecharFolhaMomento, fecharENavegar: fecharFolhaMomentoENavegar } = useFolhaNoHistorico(
    folhaMomentoAberta,
    () => {
      setFolhaMomentoAberta(false);
      setItemPlanoParaFolha(null);
    },
  );
  const [folhaPlanejarAberta, setFolhaPlanejarAberta] = useState(false);
  const { fechar: fecharFolhaPlanejar } = useFolhaNoHistorico(folhaPlanejarAberta, () => setFolhaPlanejarAberta(false));
  const [folhaMeuPlanoAberta, setFolhaMeuPlanoAberta] = useState(false);
  const { fechar: fecharFolhaMeuPlano, fecharEDepois: fecharFolhaMeuPlanoEDepois } = useFolhaNoHistorico(
    folhaMeuPlanoAberta,
    () => setFolhaMeuPlanoAberta(false),
  );

  function ir(chave: string, destino: string) {
    if (ocupado) return;
    setAcao(chave);
    iniciarTransicao(() => router.push(destino));
  }

  function abrirGravarAgoraDoPlano(item: ItemPlano) {
    setItemPlanoParaFolha(item);
    setFolhaMomentoAberta(true);
  }

  /** E39c, parte 2a: um sugerido tocado na visão Semana chega aqui por `?plano=` (`page.tsx`,
   * `itemPlanoPorId`); abre a mesma folha de "o seu plano de hoje" usa, sem exigir que a pessoa
   * toque de novo. Só na montagem: trocar de item não deve reabrir a folha sozinha. */
  useEffect(() => {
    if (itemPlanoInicial) {
      abrirGravarAgoraDoPlano(itemPlanoInicial);
    }
  }, [itemPlanoInicial]);

  /** A2, item 7: o atalho de Story de Hoje abre a folha já em Story, uma vez, na montagem (fechar a folha não a reabre). */
  useEffect(() => {
    if (abrirEmStory && !itemPlanoInicial) setFolhaMomentoAberta(true);
  }, [abrirEmStory, itemPlanoInicial]);

  /** O momento que volta preenchido: vindo de "Reescrever o que contei" (`?momento=`), a folha abre sozinha, uma vez, com o texto guardado. */
  useEffect(() => {
    if (momentoInicial && !itemPlanoInicial) setFolhaMomentoAberta(true);
  }, [momentoInicial, itemPlanoInicial]);

  async function pularItemDoPlano(item: ItemPlano) {
    if (pulandoId !== null) return;
    setPulandoId(item.id);
    try {
      await pularPlanoAction(item.id);
      setPlanoDeHoje((atual) => atual.filter((i) => i.id !== item.id));
    } catch {
      // A falha fica só visual (o item continua no bloco), mesmo espírito do Hoje de antes.
    } finally {
      setPulandoId(null);
    }
  }

  function planejarDeNovo() {
    fecharFolhaMeuPlanoEDepois(() => setFolhaPlanejarAberta(true));
  }

  return (
    <div className={styles.pagina}>
      <BarraTopo
        titulo={textosCriar.titulo}
        direita={<SeletorMarcaCelular marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={nomePessoa} />}
      />

      {trocando ? (
        <div className={styles.miolo}>
          <HojeCabecalho estado="trocando" mensagemTrocando={textosNav.abrindoMarca(marcaAlvo ?? "")} />
        </div>
      ) : (
        <div className={styles.miolo}>
          <div className={styles.cabecalhoTela}>
            <h1>{textosCriar.titulo}</h1>
            <p>{textosCriar.subtitulo}</p>
          </div>

          {/* E54 (parte 3): a pesquisa que ficou para depois. Uma linha calma, antes de tudo: é o que a pessoa já pediu e está esperando por ela. */}
          {pesquisaEmAberto ? (
            <section className={styles.pesquisaEmAberto} aria-label={textosPesquisa.emAberto.aria} data-pesquisa-em-aberto={pesquisaEmAberto.estado}>
              <Search size={20} strokeWidth={1.75} aria-hidden="true" />
              <span className={styles.pesquisaEmAbertoTexto}>
                {textosPesquisa.emAberto[pesquisaEmAberto.estado](pesquisaEmAberto.pedido)}
              </span>
              <button type="button" className={styles.trocar} disabled={ocupado} onClick={() => ir("pesquisa-em-aberto", `/criar/pesquisa/${pesquisaEmAberto.id}`)}>
                {pesquisaEmAberto.estado === "pesquisando" ? textosPesquisa.emAberto.verAPesquisa : textosPesquisa.emAberto.verOQueAchou}
              </button>
            </section>
          ) : null}

          {/* E55 PR 2b: o assunto do momento no alto da oficina, antes dos caminhos: é a única coisa do Criar que tem prazo. Aqui o botão é o principal da tela. */}
          {emAlta ? (
            <section className={styles.emAlta} aria-labelledby="t-em-alta">
              <h2 id="t-em-alta" className="so-leitor">
                {textosHoje.emAlta.titulo}
              </h2>
              <CartaoEmAlta
                cartao={emAlta}
                destaque="principal"
                ocupado={ocupado && acao === "em-alta"}
                desabilitado={ocupado}
                aoClicar={() => ir("em-alta", destinoDoCartao(emAlta))}
                acaoExtra={
                  emAlta.roteiro
                    ? undefined
                    : { rotulo: textosCriar.emAlta.trazerDeOutroJeito, aoClicar: () => ir("em-alta-livre", `/criar/tema-livre?alta=${encodeURIComponent(emAlta.chave)}`) }
                }
              />
            </section>
          ) : null}

          <SemEncaixeEmAlta
            assuntos={semEncaixe}
            desabilitado={ocupado}
            aoTrazer={(assunto) => ir(`sem-encaixe-${assunto.chave}`, `/criar/tema-livre?alta=${encodeURIComponent(assunto.chave)}`)}
          />

          {planoDeHoje.length > 0 ? (
            <section className={styles.planoHoje}>
              <div className={styles.planoHojeCabecalho}>
                <h4>{textosPlano.tituloBlocoHoje}</h4>
                <button type="button" className={styles.trocar} onClick={() => setFolhaMeuPlanoAberta(true)}>
                  {textosPlano.botaoMeuPlano}
                </button>
              </div>
              <div className={styles.listaPlano}>
                {planoDeHoje.map((item) => (
                  <div key={item.id} className={styles.linhaPlano}>
                    <span className={styles.blocoPlano}>
                      <span className={styles.rotuloPlano}>
                        {item.lugar.trim() || textosPlano.semLugar} · {rotuloParaQue({ objetivo: item.objetivo, formato: item.formato })}
                      </span>
                      <span className={styles.situacaoPlano}>{item.situacao}</span>
                    </span>
                    <span className={styles.acaoPlano}>
                      {item.estado === "sugerido" ? (
                        <>
                          <button type="button" className={styles.trocar} onClick={() => abrirGravarAgoraDoPlano(item)}>
                            {textosPlano.botaoEscreverRoteiro}
                          </button>
                          <button
                            type="button"
                            className={styles.trocar}
                            disabled={pulandoId === item.id}
                            aria-busy={pulandoId === item.id || undefined}
                            onClick={() => pularItemDoPlano(item)}
                          >
                            {pulandoId === item.id ? textosPlano.pulando : textosPlano.botaoPular}
                          </button>
                        </>
                      ) : item.roteiroId ? (
                        <Link href={`/roteiros/${item.roteiroId}`} className={styles.trocar}>
                          {item.estado === "gravado" ? textosPlano.rotuloGravado : textosPlano.botaoAbrirRoteiro}
                        </Link>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div className={styles.caminhos}>
            <button
              type="button"
              className={`${styles.porta} cartao-toque`}
              disabled={ocupado}
              aria-busy={acao === "temas" || undefined}
              onClick={() => ir("temas", dataInicial ? `/criar/temas?data=${dataInicial}` : "/criar/temas")}
            >
              <span className={styles.marcaPorta} aria-hidden="true">
                <Zap size={20} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <strong>{textosCriar.caminhoTemas.titulo}</strong>
              <span className={styles.ajuda}>{textosCriar.caminhoTemas.ajuda}</span>
              <span className={styles.seta} aria-hidden="true">
                <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
              </span>
            </button>

            <button
              type="button"
              className={`${styles.porta} cartao-toque`}
              disabled={ocupado}
              aria-busy={acao === "tema-livre" || undefined}
              onClick={() => ir("tema-livre", dataInicial ? `/criar/tema-livre?data=${dataInicial}` : "/criar/tema-livre")}
            >
              <span className={styles.marcaPorta} aria-hidden="true">
                <Pencil size={20} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <strong>{textosCriar.caminhoAssuntoSeu.titulo}</strong>
              <span className={styles.ajuda}>{textosCriar.caminhoAssuntoSeu.ajuda}</span>
              <span className={styles.seta} aria-hidden="true">
                <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
              </span>
            </button>

            <button
              type="button"
              className={`${styles.porta} cartao-toque`}
              disabled={semConexao}
              aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
              onClick={() => setFolhaMomentoAberta(true)}
            >
              <span className={styles.marcaPorta} aria-hidden="true">
                <Mic size={20} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <strong>{textosCriar.caminhoMomento.titulo}</strong>
              <span className={styles.ajuda}>{textosCriar.caminhoMomento.ajuda}</span>
              <span className={styles.seta} aria-hidden="true">
                <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <MotivoSemRede className={styles.motivoNaPorta} />
            </button>

            <button
              type="button"
              className={`${styles.porta} cartao-toque`}
              disabled={ocupado || semConexao}
              aria-busy={acao === "plano" || undefined}
              aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
              onClick={() => ir("plano", dataInicial ? `/planejamento?visao=semana&dia=${dataInicial}` : "/planejamento?visao=semana")}
            >
              <span className={styles.marcaPorta} aria-hidden="true">
                <CalendarDays size={20} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <strong>{textosCriar.caminhoPlano.titulo}</strong>
              <span className={styles.ajuda}>{textosCriar.caminhoPlano.ajuda}</span>
              <span className={styles.seta} aria-hidden="true">
                <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <MotivoSemRede className={styles.motivoNaPorta} />
            </button>

            {/* E28 (passo 25): responder o que estão perguntando nos comentários do setor; cada pergunta leva ao Tema livre com ela presa. Sem leitura da semana, o estado calmo (sem aparência de erro). */}
            <section className={styles.portaPerguntas} aria-labelledby="t-porta-perguntas" data-porta-perguntas={perguntas ? "com" : "sem"}>
              <div className={styles.cabecaPorta}>
                <span className={styles.marcaPorta} aria-hidden="true">
                  <UserRound size={20} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <strong id="t-porta-perguntas">{textosVozes.porta.titulo}</strong>
                <span className={styles.ajuda}>{textosVozes.porta.ajuda}</span>
              </div>
              {perguntas ? (
                <>
                  <ListaDePerguntas
                    perguntas={perguntas.perguntas.map((p) => ({ chave: p.chave, texto: p.texto, vezesTexto: textosVozes.vezes(p.tipo, p.vezes) }))}
                    rotuloDoBotao={textosVozes.porta.responder}
                    nomeDoBotao={textosVozes.porta.responderDe}
                    textoAbrindo={textosHoje.abrindo}
                    abrindo={ocupado && acao?.startsWith("pergunta-") ? acao.slice("pergunta-".length) : null}
                    desabilitado={ocupado}
                    aoResponder={(chave) => ir(`pergunta-${chave}`, `/criar/tema-livre?pergunta=${chave}${dataInicial ? `&data=${dataInicial}` : ""}`)}
                  />
                  <p className={styles.leituraPerguntas}>{textosVozes.leitura(perguntas.videos, perguntas.plataformas, perguntas.lidasEm)}</p>
                </>
              ) : (
                <p className={styles.semPerguntas}>{textosVozes.porta.semPerguntas}</p>
              )}
            </section>
          </div>

          <p className={styles.notaAgenda}>{textosCriar.notaAgenda}</p>
        </div>
      )}

      {folhaMomentoAberta ? (
        <FolhaGravarAgora
          aoFechar={fecharFolhaMomento}
          fecharENavegar={fecharFolhaMomentoENavegar}
          objetivoRecomendado={objetivoRecomendado}
          marcas={outrasMarcas}
          planoItemId={itemPlanoParaFolha?.id}
          dataInicial={itemPlanoParaFolha ? undefined : dataInicial}
          marcaAtivaId={marcaAtiva.id}
          formatoInicial={abrirEmStory ? "story" : undefined}
          pesquisa={pesquisa}
          tipo={tipo}
          quemGravaPadrao={quemGravaPadrao}
          valoresIniciais={
            itemPlanoParaFolha
              ? ({
                  onde: itemPlanoParaFolha.lugar,
                  oQueEstaAcontecendo: itemPlanoParaFolha.situacao,
                  oQueDaParaMostrar: itemPlanoParaFolha.oQueMostrar,
                  objetivo: itemPlanoParaFolha.objetivo,
                  formato: itemPlanoParaFolha.formato,
                  marcaId: itemPlanoParaFolha.marcaId,
                } satisfies ValoresIniciaisMomento)
              : (momentoInicial ?? undefined)
          }
        />
      ) : null}

      {folhaPlanejarAberta ? <FolhaPlanejarDias aoFechar={fecharFolhaPlanejar} /> : null}

      {folhaMeuPlanoAberta ? (
        <FolhaMeuPlano aoFechar={fecharFolhaMeuPlano} itens={planoQueVem} aoPlanejarDeNovo={planejarDeNovo} />
      ) : null}
    </div>
  );
}
