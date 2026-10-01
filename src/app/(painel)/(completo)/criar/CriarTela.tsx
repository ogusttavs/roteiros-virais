"use client";

import { CalendarDays, ChevronRight, Mic, Pencil, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { Objetivo, QuemGrava, TipoMarca } from "@/db/schema";
import { ROTULO_TEMA_CARTAO } from "@/ia/enums";
import type { ItemPlano } from "@/servicos/plano";
import { textosCriar } from "@/textos/criar";
import { textosNav } from "@/textos/nav";
import { textosPlano } from "@/textos/plano";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { MotivoSemRede } from "@/ui/componentes/MotivoSemRede";
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
}: Props) {
  const router = useRouter();
  const { trocando, marcaAlvo } = useTrocaMarca();
  const { semConexao } = useConexao();
  const [ocupado, iniciarTransicao] = useTransition();
  const [acao, setAcao] = useState<string | null>(null);

  const [planoDeHoje, setPlanoDeHoje] = useState(planoDeHojeInicial);
  const [pulandoId, setPulandoId] = useState<number | null>(null);

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
                        {item.lugar.trim() || textosPlano.semLugar} · {ROTULO_TEMA_CARTAO[item.objetivo]}
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
              className={styles.porta}
              disabled={ocupado}
              aria-busy={acao === "temas" || undefined}
              onClick={() => ir("temas", "/criar/temas")}
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
              className={styles.porta}
              disabled={ocupado}
              aria-busy={acao === "tema-livre" || undefined}
              onClick={() => ir("tema-livre", "/criar/tema-livre")}
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
              className={styles.porta}
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
              className={styles.porta}
              disabled={semConexao}
              aria-describedby={semConexao ? ID_FAIXA_SEM_CONEXAO : undefined}
              onClick={() => setFolhaPlanejarAberta(true)}
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
              : undefined
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
