"use client";

import { Check, RefreshCw, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ConteudoRoteiro, Objetivo, TemaDoDia } from "@/db/schema";
import { ROTULO_TEMA_CARTAO } from "@/ia/enums";
import type { Constancia } from "@/servicos/temas";
import { textosHoje } from "@/textos/hoje";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { TemaCartao, type EvidenciaTema } from "@/ui/componentes/TemaCartao";

import { HojeCabecalho } from "./HojeCabecalho";
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
};

function AparteSemanaCurva({ semana, ultimoVideo }: { semana: SemanaDia[]; ultimoVideo: UltimoVideoAparte | null }) {
  return (
    <aside className={styles.aparte}>
      <div>
        <h4>{textosHoje.suaSemana}</h4>
        <div className={styles.semana}>
          {semana.map((dia, indice) => (
            <span
              key={indice}
              className={[styles.dia, dia.gravou ? styles.diaGravou : "", dia.hoje ? styles.diaHoje : ""]
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
            <span className={styles.curvaLegenda}>{textosHoje.visualizacoesEmHoras(ultimoVideo.views, ultimoVideo.horas)}</span>
            {ultimoVideo.acimaDoNormal ? (
              <span className={styles.curvaAcima}>
                <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                {textosHoje.acimaDoSeuNormal(ultimoVideo.multiplo)}
              </span>
            ) : (
              <span className={styles.curvaLegenda}>{textosHoje.doNormalDaSuaConta(ultimoVideo.multiplo)}</span>
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
}: Props) {
  const router = useRouter();
  const [outrosAbertos, setOutrosAbertos] = useState(false);

  return (
    <div className={styles.pagina}>
      <BarraTopo
        titulo={textosHoje.titulo}
        direita={
          <button type="button" className={styles.botaoBarra} onClick={() => router.refresh()}>
            <RefreshCw size={18} strokeWidth={1.75} aria-hidden="true" />
            <span>{textosHoje.atualizar}</span>
          </button>
        }
      />

      <div className={styles.conteudo}>
        <HojeCabecalho constancia={constancia} avisoVideoSubindo={avisoVideoSubindo} estado="normal" />

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
                  <span className={styles.rotulo}>{ROTULO_TEMA_CARTAO[roteiroHoje.objetivo]}</span>
                  <h3 className={styles.temaTitulo}>{roteiroHoje.corpo.titulo}</h3>
                </div>
                <p className={styles.porque}>{textosHoje.roteiroGeradoDescricao(roteiroHoje.corpo.duracaoS)}</p>
                {evidenciaRoteiroHoje ? (
                  <div className={styles.evidencia}>
                    {evidenciaRoteiroHoje.conta ? (
                      <span className={styles.evidenciaLinha}>
                        <span className={styles.conta}>{evidenciaRoteiroHoje.conta}</span>
                      </span>
                    ) : null}
                    <span className={styles.evidenciaLinha}>
                      <b>{evidenciaRoteiroHoje.multiplo}</b>{" "}
                      {textosHoje.evidenciaMultiplo(evidenciaRoteiroHoje.views, evidenciaRoteiroHoje.dias)}
                    </span>
                  </div>
                ) : null}
                <div className={styles.acoes}>
                  <Link href={`/roteiros/${roteiroHoje.id}/gravar`} className={styles.botaoPrimario}>
                    <Video size={20} strokeWidth={1.75} aria-hidden="true" />
                    {textosHoje.modoGravacao}
                  </Link>
                  <Link href={`/roteiros/${roteiroHoje.id}`} className={styles.botaoSecundario}>
                    {textosHoje.abrirRoteiro}
                  </Link>
                </div>
              </article>

              <div className={styles.recolhidos}>
                <button
                  type="button"
                  aria-expanded={outrosAbertos}
                  className={styles.abrirTemas}
                  onClick={() => setOutrosAbertos((a) => !a)}
                >
                  <span>{outrosAbertos ? textosHoje.esconderOutros : textosHoje.verOutros}</span>
                  <span className={styles.contaTemas}>{textosHoje.contagemTemas(temas.length)}</span>
                </button>
                <p className={styles.avisoTrocarTema}>{textosHoje.trocarTemaAviso}</p>

                {outrosAbertos ? (
                  <div className={styles.listaOutros}>
                    {temas.map((tema, indice) => (
                      <div key={`${tema.titulo}-${indice}`} className={styles.linhaOutro}>
                        <span className={styles.blocoOutro}>
                          <span className={styles.rotuloOutro}>{ROTULO_TEMA_CARTAO[tema.puxaPara]}</span>
                          <span className={styles.temaOutro}>{tema.titulo}</span>
                        </span>
                        <button
                          type="button"
                          className={styles.trocar}
                          onClick={() => router.push(`/hoje/objetivo?tema=${indice}`)}
                        >
                          {textosHoje.trocar}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
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
                    onEscolher={() => router.push(`/hoje/objetivo?tema=${indice}`)}
                  />
                ))}
              </div>

              <div className={styles.proprio}>
                <h4>{textosHoje.preferAssuntoSeu}</h4>
                <p>{textosHoje.preferAssuntoSeuTexto}</p>
                <button type="button" className={styles.botaoSecundario} onClick={() => router.push("/hoje/tema-livre")}>
                  {textosHoje.escreverMeuAssunto}
                </button>
              </div>
            </div>

            <AparteSemanaCurva semana={semana} ultimoVideo={ultimoVideo} />
          </div>
        )}
      </div>
    </div>
  );
}
