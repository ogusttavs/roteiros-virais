"use client";

import { Check, RefreshCw, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { ConteudoRoteiro, Objetivo, TemaDoDia } from "@/db/schema";
import { ROTULO_TEMA_CARTAO } from "@/ia/enums";
import type { Constancia } from "@/servicos/temas";
import { textosHoje } from "@/textos/hoje";
import { textosNav } from "@/textos/nav";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { MotivoSemRede } from "@/ui/componentes/MotivoSemRede";
import { TemaCartao, type EvidenciaTema } from "@/ui/componentes/TemaCartao";
import { ID_FAIXA_SEM_CONEXAO, useConexao } from "@/ui/ConexaoContext";

import { SeletorMarcaCelular, type MarcaResumo } from "../../_casca/SeletorMarcaCelular";
import { useTrocaMarca } from "../../_casca/TrocaMarcaContext";

import { HojeCabecalho } from "./HojeCabecalho";
import { HojeEsqueleto } from "./HojeEsqueleto";
import styles from "./HojeTela.module.css";

type RoteiroDeHoje = { id: number; objetivo: Objetivo; criadoEm: Date; corpo: ConteudoRoteiro };

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
  semana,
  ultimoVideo,
  marcaAtiva,
  marcas,
  nomePessoa,
}: Props) {
  const router = useRouter();
  const [outrosAbertos, setOutrosAbertos] = useState(false);
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

          {roteiroHoje ? (
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
              </div>

              <AparteSemanaCurva semana={semana} ultimoVideo={ultimoVideo} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
