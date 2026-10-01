"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { Plataforma, TemaDoDia } from "@/db/schema";
import { ROTULO_TEMA_CARTAO } from "@/ia/enums";
import { textosCriar } from "@/textos/criar";
import { textosHoje } from "@/textos/hoje";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { Chips } from "@/ui/componentes/Chips";
import { TemaCartao, type EvidenciaTema } from "@/ui/componentes/TemaCartao";

import { salvarRedePrincipalAction } from "../../hoje/acoes";

import type { AvisoSemTema } from "./aviso-sem-tema";
import styles from "./TemasTela.module.css";

/** V12, item 3a: a ordem dos chips é sempre a mesma, na marca e na primeira vez. */
const REDES_PRINCIPAIS: { valor: Plataforma; rotulo: string }[] = [
  { valor: "instagram", rotulo: "Instagram" },
  { valor: "tiktok", rotulo: "TikTok" },
  { valor: "youtube", rotulo: "YouTube" },
];

type Props = {
  temas: TemaDoDia[];
  evidenciasTemas: (EvidenciaTema | null)[];
  avisoLinhaEditorial: string | null;
  aviso: AvisoSemTema | null;
  redePrincipal: Plataforma | null;
  /** Decisão pendente 5, revisão do Fable no PR #90: veio de "Criar roteiro" num dia vazio. */
  dataInicial?: string;
};

/**
 * `/criar/temas` (E39a): a porta "Os temas de hoje", migrada da antiga porta Reels de `/hoje`
 * (V12, item 3a: a pergunta "onde você posta mais"; H3, item 1: o aviso sem tema). As outras
 * portas de Criar (assunto seu, contar o momento, planejar) viraram rotas à parte: esta tela cuida
 * só de escolher um tema.
 */
export function TemasTela({ temas, evidenciasTemas, avisoLinhaEditorial, aviso, redePrincipal, dataInicial }: Props) {
  const router = useRouter();
  const [redeAtual, setRedeAtual] = useState(redePrincipal);
  const [destino, setDestino] = useState<string | null>(null);
  const [abrindo, iniciarTransicao] = useTransition();

  const comData = (url: string) => (dataInicial ? `${url}${url.includes("?") ? "&" : "?"}data=${dataInicial}` : url);

  const redeSelecionadaIndice = redeAtual ? REDES_PRINCIPAIS.findIndex((r) => r.valor === redeAtual) : null;

  function escolherRede(rede: Plataforma) {
    setRedeAtual(rede);
    void salvarRedePrincipalAction(rede);
  }

  function abrir(chave: string, url: string) {
    if (abrindo) return;
    setDestino(chave);
    iniciarTransicao(() => router.push(url));
  }

  return (
    <div className={styles.pagina}>
      <BarraTopo
        titulo={textosCriar.caminhoTemas.titulo}
        esquerda={
          <button
            type="button"
            aria-label={textosCriar.titulo}
            className={styles.botaoVoltar}
            onClick={() => abrir("voltar", comData("/criar"))}
          >
            <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        }
      />

      <div className={styles.miolo}>
        {avisoLinhaEditorial ? <p className={styles.aviso}>{avisoLinhaEditorial}</p> : null}

        <div className={styles.grupoRede}>
          {!redeAtual ? <span className={styles.perguntaRede}>{textosHoje.ondeVocePostaMais}</span> : null}
          <Chips
            rotuloGrupo={textosHoje.ondeVocePostaMais}
            opcoes={REDES_PRINCIPAIS.map((r) => r.rotulo)}
            selecionado={redeSelecionadaIndice}
            onChange={(indice) => escolherRede(REDES_PRINCIPAIS[indice].valor)}
          />
          <p className={styles.dicaRede}>{textosHoje.dicaRedePrincipal}</p>
        </div>

        {aviso ? (
          <div className={styles.estadoVazio}>
            <h2>{aviso.titulo}</h2>
            <p>{aviso.texto}</p>
            <button
              type="button"
              className={styles.botaoSecundario}
              disabled={abrindo}
              aria-busy={destino === "tema-livre" || undefined}
              onClick={() => abrir("tema-livre", comData("/criar/tema-livre"))}
            >
              {destino === "tema-livre" && abrindo ? textosHoje.abrindo : textosHoje.escreverMeuAssunto}
            </button>
          </div>
        ) : (
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
                abrindo={destino === `tema-${indice}` && abrindo}
                desabilitado={abrindo}
                precisaDeRede
                onEscolher={() => abrir(`tema-${indice}`, comData(`/criar/objetivo?tema=${indice}`))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
