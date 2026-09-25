"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { FormatoRoteiro, Objetivo } from "@/db/schema";
import { AJUDA_OBJETIVO, FORMATOS_ROTEIRO_EM_ORDEM, NOME_OBJETIVO, OBJETIVOS_EM_ORDEM, ROTULO_FORMATO_ROTEIRO, sugerirFormatoPeloObjetivo } from "@/ia/enums";
import type { OrigemRoteiro } from "@/servicos/roteiro";
import { textosComuns } from "@/textos/comuns";
import { textosConexao } from "@/textos/conexao";
import { textosObjetivo } from "@/textos/objetivo";
import { BarraAcao } from "@/ui/componentes/BarraAcao";
import { OpcaoObjetivo } from "@/ui/componentes/OpcaoObjetivo";
import { Progresso } from "@/ui/componentes/Progresso";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";

import { gerarRoteiroAction } from "./acoes";
import styles from "./ObjetivoTela.module.css";

const LIMIAR_DEMORANDO_MS = 10000;

function primeiraMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

type Props = {
  origem: OrigemRoteiro;
  temaEscolhidoTexto: string;
  objetivoRecomendado: Objetivo | null;
};

/** `/hoje/objetivo` (etapa 11, brief-frontend.md 6.3; `ObjetivoFluxo.dc.html`). */
export function ObjetivoTela({ origem, temaEscolhidoTexto, objetivoRecomendado }: Props) {
  const router = useRouter();
  const [escolhido, setEscolhido] = useState<Objetivo | null>(null);
  // V9c, item 1: enquanto a pessoa nao mexe no controle, o formato segue o objetivo escolhido
  // (`sugerirFormatoPeloObjetivo`); depois do primeiro toque, a escolha dela e que manda.
  const [formato, setFormato] = useState<FormatoRoteiro>("reels");
  const [formatoTocado, setFormatoTocado] = useState(false);
  // A frase que a tela de erro mostra (ou null, sem erro): falha do servidor e queda de rede dizem coisas diferentes.
  const [erro, setErro] = useState<string | null>(null);
  const [demorando, setDemorando] = useState(false);
  const [pendente, iniciarTransicao] = useTransition();
  const tratarFalha = useTratarFalha();
  const { avisarRedeOk } = useConexao();

  useEffect(() => {
    if (!pendente) {
      setDemorando(false);
      return;
    }
    const id = setTimeout(() => setDemorando(true), LIMIAR_DEMORANDO_MS);
    return () => clearTimeout(id);
  }, [pendente]);

  useEffect(() => {
    if (formatoTocado || !escolhido) return;
    setFormato(sugerirFormatoPeloObjetivo(escolhido));
  }, [escolhido, formatoTocado]);

  function escrever() {
    if (!escolhido) return;
    setErro(null);
    iniciarTransicao(async () => {
      try {
        const { id } = await gerarRoteiroAction(origem, escolhido, formato);
        avisarRedeOk();
        router.push(`/roteiros/${id}`);
      } catch (falha) {
        // Gerar demora e o servidor pode ter terminado antes de a conexão cair: repetir cria outro roteiro,
        // então a frase de rede manda olhar o Histórico primeiro (V7, item 4 do PROXIMO.md).
        setErro(tratarFalha(falha, textosObjetivo.erro, textosConexao.conexaoCaiuNoMeio));
      }
    });
  }

  if (pendente) {
    return (
      <div className={styles.pagina}>
        <div className={styles.espera}>
          <Progresso frases={textosComuns.espera} />
          {demorando ? <p className={styles.demorando}>{textosObjetivo.demorando}</p> : null}
        </div>
      </div>
    );
  }

  if (erro !== null) {
    // O tema e o objetivo escolhidos continuam na tela: quem tenta de novo confere o que vai pedir (e o Voltar
    // leva de volta sem perder o tema).
    return (
      <div className={styles.pagina}>
        <div className={styles.espera}>
          <div className={styles.escolha}>
            <div className={styles.temaEscolhido}>
              <span className={styles.rotulo}>{textosObjetivo.temaEscolhido}</span>
              <span className={styles.tema}>{temaEscolhidoTexto}</span>
            </div>
            {escolhido ? (
              <div className={styles.temaEscolhido}>
                <span className={styles.rotulo}>{textosObjetivo.objetivoEscolhido}</span>
                <span className={styles.tema}>{primeiraMaiuscula(NOME_OBJETIVO[escolhido])}</span>
              </div>
            ) : null}
          </div>
          <p className={styles.fraseErro} role="alert">
            {erro}
          </p>
          <BarraAcao
            secundaria={{ rotulo: textosComuns.voltar, onClick: () => router.back() }}
            primaria={{ rotulo: textosComuns.tentarDeNovo, onClick: escrever, precisaDeRede: true }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pagina}>
      <div className={styles.temaEscolhido}>
        <span className={styles.rotulo}>{textosObjetivo.temaEscolhido}</span>
        <span className={styles.tema}>{temaEscolhidoTexto}</span>
      </div>

      <h1 className={styles.pergunta}>{textosObjetivo.pergunta}</h1>

      <div role="radiogroup" aria-label={textosObjetivo.pergunta} className={styles.opcoes}>
        {OBJETIVOS_EM_ORDEM.map((objetivo) => (
          <OpcaoObjetivo
            key={objetivo}
            titulo={primeiraMaiuscula(NOME_OBJETIVO[objetivo])}
            ajuda={AJUDA_OBJETIVO[objetivo]}
            marcada={escolhido === objetivo}
            recomendada={objetivoRecomendado === objetivo}
            rotuloRecomendado={textosObjetivo.recomendado}
            onEscolher={() => setEscolhido(objetivo)}
          />
        ))}
      </div>

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
              onClick={() => {
                setFormatoTocado(true);
                setFormato(opcao);
              }}
            >
              {ROTULO_FORMATO_ROTEIRO[opcao]}
            </button>
          ))}
        </div>
        {!formatoTocado ? <p className={styles.formatoAjuda}>{textosObjetivo.formatoAjuda[formato]}</p> : null}
      </div>

      <BarraAcao
        secundaria={{ rotulo: textosComuns.voltar, onClick: () => router.back() }}
        primaria={{ rotulo: textosObjetivo.escrever, onClick: escrever, disabled: !escolhido, precisaDeRede: true }}
      />
    </div>
  );
}
