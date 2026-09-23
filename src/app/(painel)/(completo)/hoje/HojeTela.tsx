"use client";

import { Check, RefreshCw, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { ConteudoRoteiro, Objetivo, PlanoMarca, TemaDoDia } from "@/db/schema";
import { ROTULO_TEMA_CARTAO } from "@/ia/enums";
import type { ItemPlano } from "@/servicos/plano";
import type { OrigemRoteiro } from "@/servicos/roteiro";
import type { Constancia } from "@/servicos/temas";
import { textosHistorico } from "@/textos/historico";
import { textosHoje } from "@/textos/hoje";
import { textosMomento } from "@/textos/momento";
import { textosNav } from "@/textos/nav";
import { textosPlano } from "@/textos/plano";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { MotivoSemRede } from "@/ui/componentes/MotivoSemRede";
import { TemaCartao, type EvidenciaTema } from "@/ui/componentes/TemaCartao";
import { ID_FAIXA_SEM_CONEXAO, useConexao } from "@/ui/ConexaoContext";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import { SeletorMarcaCelular, type MarcaResumo } from "../../_casca/SeletorMarcaCelular";
import { useTrocaMarca } from "../../_casca/TrocaMarcaContext";

import { FolhaColarAgenda } from "./FolhaColarAgenda";
import { FolhaGravarAgora, type ValoresIniciaisMomento } from "./FolhaGravarAgora";
import { FolhaMeuPlano } from "./FolhaMeuPlano";
import { HojeCabecalho } from "./HojeCabecalho";
import { HojeEsqueleto } from "./HojeEsqueleto";
import styles from "./HojeTela.module.css";
import { pularPlanoAction } from "./plano/acoes";

type RoteiroDeHoje = { id: number; objetivo: Objetivo; criadoEm: Date; corpo: ConteudoRoteiro };

/** V9b-0, plano `sem_limite`: cada cartão sabe a própria origem, para o rótulo "momento" do Histórico. */
type RoteiroDeHojeComOrigem = RoteiroDeHoje & { origem: OrigemRoteiro["origem"] };

export type SemanaDia = { rotulo: string; gravou: boolean; hoje: boolean };

export type UltimoVideoAparte = {
  views: string;
  horas: number;
  multiplo: string;
  acimaDoNormal: boolean;
};

type Props = {
  temas: TemaDoDia[];
  evidenciasTemas: (EvidenciaTema | null)[];
  avisoLinhaEditorial: string | null;
  avisoVideoSubindo: string | null;
  constancia: Constancia;
  roteiroHoje: RoteiroDeHoje | null;
  evidenciaRoteiroHoje: EvidenciaTema | null;
  /** V9b-0: plano da marca ativa; `sem_limite` troca o cartão único pela lista de cartões abaixo. */
  plano: PlanoMarca;
  /** V9b-0, plano `sem_limite`: todos os roteiros de hoje, mais recente primeiro; vazio no plano `padrao`. */
  roteirosDeHoje: RoteiroDeHojeComOrigem[];
  /** V9b-0, plano `sem_limite`: a evidência de cada roteiro de `roteirosDeHoje`, no mesmo índice. */
  evidenciasRoteirosDeHoje: (EvidenciaTema | null)[];
  semana: SemanaDia[];
  ultimoVideo: UltimoVideoAparte | null;
  /**
   * Para o seletor de marca na barra do topo, só no celular (revisão do PR
   * #31, item 8; V3, item 3: virou a marca ativa, não mais o avatar da
   * pessoa).
   */
  marcaAtiva: MarcaResumo;
  marcas: MarcaResumo[];
  nomePessoa: string;
  /** V9a, item 3: o objetivo já marcado na folha "Gravar agora" (mesma origem de `/hoje/objetivo`). */
  objetivoRecomendado: Objetivo | null;
  /** V9a, item 4: as outras marcas, para o seletor "Falar de" da folha (a ativa já fora desta lista). */
  outrasMarcas: MarcaResumo[];
  /** V9b, item 3: o bloco "o seu plano de hoje", vazio sem plano para hoje. */
  planoDeHoje: ItemPlano[];
  /** V9b, item 3: os dias que vêm, para a folha "Meu plano" (só existe quando há plano hoje). */
  planoQueVem: ItemPlano[];
};

function AparteSemanaCurva({
  semana,
  ultimoVideo,
}: {
  semana: SemanaDia[];
  ultimoVideo: UltimoVideoAparte | null;
}) {
  return (
    <aside className={styles.aparte}>
      <div>
        <h4>{textosHoje.suaSemana}</h4>
        <div className={styles.semana}>
          {semana.map((dia, indice) => (
            <span
              key={indice}
              className={[
                styles.dia,
                dia.gravou ? styles.diaGravou : "",
                dia.hoje ? styles.diaHoje : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <i></i>
              {dia.rotulo}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.curva}>
        <h4>{textosHoje.seuUltimoVideo}</h4>
        {ultimoVideo ? (
          <>
            <span className={styles.curvaValor}>{ultimoVideo.views}</span>
            <span className={styles.curvaLegenda}>
              {textosHoje.visualizacoesEmHoras(ultimoVideo.views, ultimoVideo.horas)}
            </span>
            {ultimoVideo.acimaDoNormal ? (
              <span className={styles.curvaAcima}>
                <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                {textosHoje.acimaDoSeuNormal(ultimoVideo.multiplo)}
              </span>
            ) : (
              <span className={styles.curvaLegenda}>
                {textosHoje.doNormalDaSuaConta(ultimoVideo.multiplo)}
              </span>
            )}
            <Link href="/historico" className={styles.verComoFoi}>
              {textosHoje.verComoFoi}
            </Link>
          </>
        ) : (
          <p className={styles.curvaVazia}>{textosHoje.semVideoAinda}</p>
        )}
      </div>
    </aside>
  );
}

/** `/hoje` (design v2, `entrega/telas/Hoje.dc.html`; `PROXIMO.md`, D2 parte 1, item 5). */
export function HojeTela({
  temas,
  evidenciasTemas,
  avisoLinhaEditorial,
  avisoVideoSubindo,
  constancia,
  roteiroHoje,
  evidenciaRoteiroHoje,
  plano,
  roteirosDeHoje,
  evidenciasRoteirosDeHoje,
  semana,
  ultimoVideo,
  marcaAtiva,
  marcas,
  nomePessoa,
  objetivoRecomendado,
  outrasMarcas,
  planoDeHoje: planoDeHojeInicial,
  planoQueVem,
}: Props) {
  const router = useRouter();
  const [outrosAbertos, setOutrosAbertos] = useState(false);
  const [folhaMomentoAberta, setFolhaMomentoAberta] = useState(false);
  const [itemPlanoParaFolha, setItemPlanoParaFolha] = useState<ItemPlano | null>(null);
  const { fechar: fecharFolhaMomento, fecharEDepois: fecharFolhaMomentoEDepois } = useFolhaNoHistorico(
    folhaMomentoAberta,
    () => {
      setFolhaMomentoAberta(false);
      setItemPlanoParaFolha(null);
    },
  );
  const [folhaAgendaAberta, setFolhaAgendaAberta] = useState(false);
  const { fechar: fecharFolhaAgenda } = useFolhaNoHistorico(folhaAgendaAberta, () => setFolhaAgendaAberta(false));
  const [folhaMeuPlanoAberta, setFolhaMeuPlanoAberta] = useState(false);
  const { fechar: fecharFolhaMeuPlano } = useFolhaNoHistorico(folhaMeuPlanoAberta, () => setFolhaMeuPlanoAberta(false));

  // V9b, item 3: "Pular" some do bloco na hora, sem esperar o `router.refresh()` do fim da acao.
  const [planoDeHoje, setPlanoDeHoje] = useState(planoDeHojeInicial);
  const [pulandoId, setPulandoId] = useState<number | null>(null);

  /**
   * `useState(planoDeHojeInicial)` acima só lê a prop na primeira montagem: sem este efeito, o
   * plano recém colado (`FolhaColarAgenda`, `router.refresh()` sem navegação) nunca aparecia,
   * porque o Hoje não desmonta nesse refresh (achado do e2e desta etapa, `plano.spec.ts`). Este
   * efeito resincroniza sempre que o servidor manda uma lista nova.
   */
  useEffect(() => {
    setPlanoDeHoje(planoDeHojeInicial);
  }, [planoDeHojeInicial]);

  function abrirGravarAgoraDoPlano(item: ItemPlano) {
    setItemPlanoParaFolha(item);
    setFolhaMomentoAberta(true);
  }

  async function pularItemDoPlano(item: ItemPlano) {
    if (pulandoId !== null) return;
    setPulandoId(item.id);
    try {
      await pularPlanoAction(item.id);
      setPlanoDeHoje((atual) => atual.filter((i) => i.id !== item.id));
    } catch {
      // A falha fica só visual (o item continua no bloco); tentar de novo e uma frase dedicada
      // ficam para a próxima rodada de acabamento, mesmo espírito das outras acoes desta tela.
    } finally {
      setPulandoId(null);
    }
  }

  const diasGravados = semana.filter((dia) => dia.gravou).length;
  const { trocando, marcaAlvo } = useTrocaMarca();
  const { semConexao, avisarFalhaDeRede } = useConexao();
  // Toque que só navega (ou atualiza) espera a resposta do servidor sem mostrar nada; com sinal fraco parecia travado
  // e o segundo toque só descartava o primeiro (V7, item 4 do PROXIMO.md). `acao` diz qual toque está em andamento.
  const [ocupado, iniciarTransicao] = useTransition();
  const [acao, setAcao] = useState<string | null>(null);
  const emAndamento = (chave: string) => ocupado && acao === chave;
  const atualizando = emAndamento("atualizar");

  function ir(chave: string, destino: string) {
    if (ocupado) return;
    setAcao(chave);
    iniciarTransicao(() => router.push(destino));
  }

  function atualizar() {
    if (ocupado) return;
    // Sem rede o pedido cai e o Next sai da tela inteira para a página de erro do navegador; avisa em vez de tentar.
    if (!navigator.onLine) {
      avisarFalhaDeRede();
      return;
    }
    setAcao("atualizar");
    iniciarTransicao(() => router.refresh());
  }

  return (
    <div className={styles.pagina}>
      <BarraTopo
        titulo={textosHoje.titulo}
        direita={
          <>
            <SeletorMarcaCelular marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={nomePessoa} />
            <button
              type="button"
              className={styles.botaoBarra}
              aria-label={textosHoje.atualizar}
              aria-busy={atualizando || undefined}
              disabled={ocupado}
              onClick={atualizar}
            >
              <RefreshCw
                size={18}
                strokeWidth={1.75}
                aria-hidden="true"
                className={atualizando ? styles.girando : undefined}
              />
              {marcas.length <= 1 ? <span>{textosHoje.atualizar}</span> : null}
            </button>
          </>
        }
      />

      {trocando ? (
        <div className={styles.miolo}>
          <HojeCabecalho
            constancia={constancia}
            estado="trocando"
            mensagemTrocando={textosNav.abrindoMarca(marcaAlvo ?? "")}
          />
          <HojeEsqueleto mensagemEsperando={textosNav.abrindoMarca(marcaAlvo ?? "")} />
        </div>
      ) : (
        <div className={styles.miolo}>
          <HojeCabecalho
            constancia={constancia}
            diasGravados={diasGravados}
            avisoVideoSubindo={avisoVideoSubindo}
            estado="normal"
          />

          {avisoLinhaEditorial ? <p className={styles.aviso}>{avisoLinhaEditorial}</p> : null}

          {/* V9b, item 3: "o seu plano de hoje", acima dos três temas (e do roteiro do dia, se já existir). */}
          {planoDeHoje.length > 0 ? (
            <section className={styles.planoHoje}>
              <div className={styles.planoHojeCabecalho}>
                <h4>{textosPlano.tituloBlocoHoje}</h4>
                <button type="button" className={styles.trocar} onClick={() => setFolhaMeuPlanoAberta(true)}>
                  {textosPlano.botaoMeuPlano}
                </button>
              </div>
              <div className={styles.listaOutros}>
                {planoDeHoje.map((item) => (
                  <div key={item.id} className={styles.linhaOutro}>
                    <span className={styles.blocoOutro}>
                      <span className={styles.rotuloOutro}>
                        {item.lugar.trim() || textosPlano.semLugar} · {ROTULO_TEMA_CARTAO[item.objetivo]}
                      </span>
                      <span className={styles.temaOutro}>{item.situacao}</span>
                    </span>
                    <span className={styles.acaoOutro}>
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

          {plano === "sem_limite" ? (
            <div className={styles.duasColunas}>
              <div className={styles.colunaPrincipal}>
                {roteirosDeHoje.length > 0 ? (
                  <>
                    <span className={styles.marcaRecomendado}>
                      <Check size={14} strokeWidth={1.75} aria-hidden="true" />
                      {textosHoje.seusRoteirosDeHoje(roteirosDeHoje.length)}
                    </span>
                    {roteirosDeHoje.map((roteiro, indice) => (
                      <article key={roteiro.id} className={styles.cartaoRoteiro}>
                        <div className={styles.tituloArea}>
                          <span className={styles.rotulo}>
                            {ROTULO_TEMA_CARTAO[roteiro.objetivo]}
                            {roteiro.origem === "momento" ? ` · ${textosHistorico.origemMomento}` : ""}
                          </span>
                          <h3 className={styles.temaTitulo}>{roteiro.corpo.titulo}</h3>
                        </div>
                        <p className={styles.porque}>
                          {textosHoje.roteiroGeradoDescricao(roteiro.corpo.duracaoS)}
                        </p>
                        {evidenciasRoteirosDeHoje[indice] ? (
                          <div className={styles.evidencia}>
                            {evidenciasRoteirosDeHoje[indice]!.conta ? (
                              <span className={styles.evidenciaLinha}>
                                <span className={styles.conta}>{evidenciasRoteirosDeHoje[indice]!.conta}</span>
                              </span>
                            ) : null}
                            <span className={styles.evidenciaLinha}>
                              <b>{evidenciasRoteirosDeHoje[indice]!.multiplo}</b>{" "}
                              {textosHoje.evidenciaMultiplo(
                                evidenciasRoteirosDeHoje[indice]!.rotulo,
                                evidenciasRoteirosDeHoje[indice]!.views,
                                evidenciasRoteirosDeHoje[indice]!.quando,
                              )}
                            </span>
                          </div>
                        ) : null}
                        <div className={styles.acoes}>
                          <Link href={`/roteiros/${roteiro.id}/gravar`} className={styles.botaoPrimario}>
                            <Video size={20} strokeWidth={1.75} aria-hidden="true" />
                            {textosHoje.modoGravacao}
                          </Link>
                          <Link href={`/roteiros/${roteiro.id}`} className={styles.botaoSecundario}>
                            {textosHoje.abrirRoteiro}
                          </Link>
                        </div>
                      </article>
                    ))}
                  </>
                ) : null}

                {/* V9b-0: os tres temas sempre visiveis neste plano, nunca escondidos atras de "ver outros" (`PROXIMO.md`). */}
                <div className={styles.temasTres}>
                  {temas.map((tema, indice) => (
                    <TemaCartao
                      key={`${tema.titulo}-${indice}`}
                      rotulo={ROTULO_TEMA_CARTAO[tema.puxaPara]}
                      tema={tema.titulo}
                      porque={tema.porQue}
                      evidencia={evidenciasTemas[indice] ?? null}
                      primario={indice === 0}
                      rotuloBotao={textosMomento.escreverRoteiro}
                      abrindo={emAndamento(`tema-${indice}`)}
                      desabilitado={ocupado}
                      precisaDeRede
                      onEscolher={() => ir(`tema-${indice}`, `/hoje/objetivo?tema=${indice}`)}
                    />
                  ))}
                </div>

                <div className={styles.proprio}>
                  <h4>{textosHoje.preferAssuntoSeu}</h4>
                  <p>{textosHoje.preferAssuntoSeuTexto}</p>
                  <button
                    type="button"
                    className={styles.botaoSecundario}
                    disabled={ocupado || semConexao}
                    aria-busy={emAndamento("proprio") || undefined}
                    aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
                    onClick={() => ir("proprio", "/hoje/tema-livre")}
                  >
                    {emAndamento("proprio") ? textosHoje.abrindo : textosHoje.escreverMeuAssunto}
                  </button>
                  <MotivoSemRede />
                </div>

                <div className={styles.proprio}>
                  <h4>{textosMomento.tituloFolha}</h4>
                  <p>{textosMomento.instrucaoAudio}</p>
                  <button
                    type="button"
                    className={styles.botaoSecundario}
                    disabled={semConexao}
                    aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
                    onClick={() => setFolhaMomentoAberta(true)}
                  >
                    {textosMomento.botaoAbrirHoje}
                  </button>
                  <button
                    type="button"
                    className={styles.botaoSecundario}
                    disabled={semConexao}
                    aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
                    onClick={() => setFolhaAgendaAberta(true)}
                  >
                    {textosPlano.botaoColarAgenda}
                  </button>
                  <MotivoSemRede />
                </div>
              </div>

              <AparteSemanaCurva semana={semana} ultimoVideo={ultimoVideo} />
            </div>
          ) : roteiroHoje ? (
            <div className={styles.duasColunas}>
              <div className={styles.colunaPrincipal}>
                <article className={styles.cartaoRoteiro}>
                  <span className={styles.marcaRecomendado}>
                    <Check size={14} strokeWidth={1.75} aria-hidden="true" />
                    {textosHoje.roteiroDeHojePronto}
                  </span>
                  <div className={styles.tituloArea}>
                    <span className={styles.rotulo}>
                      {ROTULO_TEMA_CARTAO[roteiroHoje.objetivo]}
                    </span>
                    <h3 className={styles.temaTitulo}>{roteiroHoje.corpo.titulo}</h3>
                  </div>
                  <p className={styles.porque}>
                    {textosHoje.roteiroGeradoDescricao(roteiroHoje.corpo.duracaoS)}
                  </p>
                  {evidenciaRoteiroHoje ? (
                    <div className={styles.evidencia}>
                      {evidenciaRoteiroHoje.conta ? (
                        <span className={styles.evidenciaLinha}>
                          <span className={styles.conta}>{evidenciaRoteiroHoje.conta}</span>
                        </span>
                      ) : null}
                      <span className={styles.evidenciaLinha}>
                        <b>{evidenciaRoteiroHoje.multiplo}</b>{" "}
                        {textosHoje.evidenciaMultiplo(
                          evidenciaRoteiroHoje.rotulo,
                          evidenciaRoteiroHoje.views,
                          evidenciaRoteiroHoje.quando,
                        )}
                      </span>
                    </div>
                  ) : null}
                  <div className={styles.acoes}>
                    <Link
                      href={`/roteiros/${roteiroHoje.id}/gravar`}
                      className={styles.botaoPrimario}
                    >
                      <Video size={20} strokeWidth={1.75} aria-hidden="true" />
                      {textosHoje.modoGravacao}
                    </Link>
                    <Link href={`/roteiros/${roteiroHoje.id}`} className={styles.botaoSecundario}>
                      {textosHoje.abrirRoteiro}
                    </Link>
                  </div>
                </article>

                {temas.length > 0 ? (
                  <div className={styles.recolhidos}>
                    <button
                      type="button"
                      aria-expanded={outrosAbertos}
                      className={styles.abrirTemas}
                      onClick={() => setOutrosAbertos((a) => !a)}
                    >
                      <span>
                        {outrosAbertos ? textosHoje.esconderOutros : textosHoje.verOutros}
                      </span>
                      <span className={styles.contaTemas}>
                        {textosHoje.contagemTemas(temas.length)}
                      </span>
                    </button>
                    <p className={styles.avisoTrocarTema}>{textosHoje.trocarTemaAviso}</p>

                    {outrosAbertos ? (
                      <div className={styles.listaOutros}>
                        {temas.map((tema, indice) => (
                          <div key={`${tema.titulo}-${indice}`} className={styles.linhaOutro}>
                            <span className={styles.blocoOutro}>
                              <span className={styles.rotuloOutro}>
                                {ROTULO_TEMA_CARTAO[tema.puxaPara]}
                              </span>
                              <span className={styles.temaOutro}>{tema.titulo}</span>
                            </span>
                            <span className={styles.acaoOutro}>
                              <button
                                type="button"
                                className={styles.trocar}
                                disabled={ocupado || semConexao}
                                aria-busy={emAndamento(`trocar-${indice}`) || undefined}
                                aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
                                onClick={() => ir(`trocar-${indice}`, `/hoje/objetivo?tema=${indice}`)}
                              >
                                {emAndamento(`trocar-${indice}`) ? textosHoje.abrindo : textosHoje.trocar}
                              </button>
                              <MotivoSemRede />
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* V9a, item 3: "Gravar agora" tambem quando ja existe roteiro de hoje (achado do e2e: um momento pode acontecer depois do roteiro sugerido do dia). */}
                <div className={styles.proprio}>
                  <h4>{textosMomento.tituloFolha}</h4>
                  <p>{textosMomento.instrucaoAudio}</p>
                  <button
                    type="button"
                    className={styles.botaoSecundario}
                    disabled={semConexao}
                    aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
                    onClick={() => setFolhaMomentoAberta(true)}
                  >
                    {textosMomento.botaoAbrirHoje}
                  </button>
                  {/* V9b, item 3: "ao lado de Gravar agora" (`PROXIMO.md`). */}
                  <button
                    type="button"
                    className={styles.botaoSecundario}
                    disabled={semConexao}
                    aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
                    onClick={() => setFolhaAgendaAberta(true)}
                  >
                    {textosPlano.botaoColarAgenda}
                  </button>
                  <MotivoSemRede />
                </div>
              </div>

              <AparteSemanaCurva semana={semana} ultimoVideo={ultimoVideo} />
            </div>
          ) : (
            <div className={styles.duasColunas}>
              <div className={styles.colunaPrincipal}>
                <div className={styles.temasTres}>
                  {temas.map((tema, indice) => (
                    <TemaCartao
                      key={`${tema.titulo}-${indice}`}
                      rotulo={ROTULO_TEMA_CARTAO[tema.puxaPara]}
                      tema={tema.titulo}
                      porque={tema.porQue}
                      evidencia={evidenciasTemas[indice] ?? null}
                      primario={indice === 0}
                      rotuloBotao={textosHoje.queroEsse}
                      abrindo={emAndamento(`tema-${indice}`)}
                      desabilitado={ocupado}
                      precisaDeRede
                      onEscolher={() => ir(`tema-${indice}`, `/hoje/objetivo?tema=${indice}`)}
                    />
                  ))}
                </div>

                <div className={styles.proprio}>
                  <h4>{textosHoje.preferAssuntoSeu}</h4>
                  <p>{textosHoje.preferAssuntoSeuTexto}</p>
                  <button
                    type="button"
                    className={styles.botaoSecundario}
                    disabled={ocupado || semConexao}
                    aria-busy={emAndamento("proprio") || undefined}
                    aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
                    onClick={() => ir("proprio", "/hoje/tema-livre")}
                  >
                    {emAndamento("proprio") ? textosHoje.abrindo : textosHoje.escreverMeuAssunto}
                  </button>
                  <MotivoSemRede />
                </div>

                {/* V9a, item 3: "Gravar agora", abaixo dos três temas (`PROXIMO.md`). */}
                <div className={styles.proprio}>
                  <h4>{textosMomento.tituloFolha}</h4>
                  <p>{textosMomento.instrucaoAudio}</p>
                  <button
                    type="button"
                    className={styles.botaoSecundario}
                    disabled={semConexao}
                    aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
                    onClick={() => setFolhaMomentoAberta(true)}
                  >
                    {textosMomento.botaoAbrirHoje}
                  </button>
                  {/* V9b, item 3: "ao lado de Gravar agora" (`PROXIMO.md`). */}
                  <button
                    type="button"
                    className={styles.botaoSecundario}
                    disabled={semConexao}
                    aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
                    onClick={() => setFolhaAgendaAberta(true)}
                  >
                    {textosPlano.botaoColarAgenda}
                  </button>
                  <MotivoSemRede />
                </div>
              </div>

              <AparteSemanaCurva semana={semana} ultimoVideo={ultimoVideo} />
            </div>
          )}
        </div>
      )}

      {folhaMomentoAberta ? (
        <FolhaGravarAgora
          aoFechar={fecharFolhaMomento}
          fecharEDepois={fecharFolhaMomentoEDepois}
          objetivoRecomendado={objetivoRecomendado}
          marcas={outrasMarcas}
          planoItemId={itemPlanoParaFolha?.id}
          valoresIniciais={
            itemPlanoParaFolha
              ? ({
                  onde: itemPlanoParaFolha.lugar,
                  oQueEstaAcontecendo: itemPlanoParaFolha.situacao,
                  oQueDaParaMostrar: itemPlanoParaFolha.oQueMostrar,
                  objetivo: itemPlanoParaFolha.objetivo,
                  marcaId: itemPlanoParaFolha.marcaId,
                } satisfies ValoresIniciaisMomento)
              : undefined
          }
        />
      ) : null}

      {folhaAgendaAberta ? <FolhaColarAgenda aoFechar={fecharFolhaAgenda} /> : null}

      {folhaMeuPlanoAberta ? <FolhaMeuPlano aoFechar={fecharFolhaMeuPlano} itens={planoQueVem} /> : null}
    </div>
  );
}
