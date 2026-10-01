"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { dadosFixosDoBriefing } from "@/config/briefing";
import type { EstiloRoteiro, FormatoRoteiro, MomentoDoDia, Objetivo, QuemGrava, TipoMarca } from "@/db/schema";
import {
  AJUDA_OBJETIVO,
  DESCRICAO_ESTILO_ROTEIRO,
  ESTILOS_ROTEIRO_EM_ORDEM,
  FORMATOS_ROTEIRO_EM_ORDEM,
  NOME_OBJETIVO,
  OBJETIVOS_EM_ORDEM,
  ROTULO_ESTILO_ROTEIRO,
  ROTULO_FORMATO_ROTEIRO,
  sugerirFormatoPeloObjetivo,
} from "@/ia/enums";
import { hojeISO } from "@/lib/config";
import { ehFalhaDeRede } from "@/lib/offline";
import type { OrigemRoteiro } from "@/servicos/roteiro";
import { textosComuns } from "@/textos/comuns";
import { textosConexao } from "@/textos/conexao";
import { textosObjetivo } from "@/textos/objetivo";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { BarraAcao } from "@/ui/componentes/BarraAcao";
import { OpcaoObjetivo } from "@/ui/componentes/OpcaoObjetivo";
import { PerguntaMomentoDoDia, PerguntaParaQuando } from "@/ui/componentes/PerguntaAgendamento";
import { TelaEscrevendo } from "@/ui/componentes/TelaEscrevendo";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";

import { roteiroRecenteDesdeAction } from "../../hoje/acoes";

import { gerarRoteiroAction, sugerirEstiloAction } from "./acoes";
import styles from "./ObjetivoTela.module.css";

function primeiraMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

type Props = {
  origem: OrigemRoteiro;
  temaEscolhidoTexto: string;
  objetivoRecomendado: Objetivo | null;
  tipo: TipoMarca;
  /** V12c, item 3, a E37b: o `quemGrava` do briefing, para o controle já nascer marcado nele. */
  quemGravaPadrao: QuemGrava | null;
  /** Decisão pendente 5, revisão do Fable no PR #90: veio de "Criar roteiro" num dia vazio que não
   * é hoje; "para quando é" já nasce marcado naquele dia, em vez de hoje. */
  dataInicial?: string;
};

/** `/criar/objetivo` (etapa 11, brief-frontend.md 6.3; `ObjetivoFluxo.dc.html`). */
export function ObjetivoTela({
  origem,
  temaEscolhidoTexto,
  objetivoRecomendado,
  tipo,
  quemGravaPadrao,
  dataInicial,
}: Props) {
  // V12c, item 3: pessoa tem "quem aparece" fixo (config/briefing.ts); o controle nem aparece.
  const opcoesQuemAparece = dadosFixosDoBriefing(tipo).quemGrava;
  const router = useRouter();
  const [escolhido, setEscolhido] = useState<Objetivo | null>(null);
  // V9c, item 1: enquanto a pessoa nao mexe no controle, o formato segue o objetivo escolhido
  // (`sugerirFormatoPeloObjetivo`); depois do primeiro toque, a escolha dela e que manda.
  const [formato, setFormato] = useState<FormatoRoteiro>("reels");
  const [formatoTocado, setFormatoTocado] = useState(false);
  /**
   * M4, item 2: o segundo controle segmentado, Falando/Sem fala. Ao contrário do formato (decidido
   * pelo objetivo, por código, sem round-trip), o estilo nasce da evidência do tema, então a
   * sugestão chega por uma Server Action (`sugerirEstiloAction`) assim que a tela monta.
   */
  const [estilo, setEstilo] = useState<EstiloRoteiro>("falado");
  const [estiloTocado, setEstiloTocado] = useState(false);
  /** E40, item 2: "o que este vídeo precisa comunicar?", opcional, até 200 caracteres. */
  const [objetivoDoVideo, setObjetivoDoVideo] = useState("");
  /** V12c, item 3: nasce no padrão do cliente; a pessoa troca só para este vídeo. */
  const [quemAparece, setQuemAparece] = useState<QuemGrava | "">(quemGravaPadrao ?? "");
  /** E39a: "para quando é?" (dúvida 10: nos temas de hoje e no assunto seu, depois do tema escolhido). */
  const [data, setData] = useState(() => dataInicial ?? hojeISO());
  const [momentoDoDia, setMomentoDoDia] = useState<MomentoDoDia | null>(null);
  // A sugestão que chega depois de a pessoa já ter tocado no controle nunca sobrescreve a escolha dela.
  const estiloTocadoRef = useRef(false);
  // A frase que a tela de erro mostra (ou null, sem erro): falha do servidor e queda de rede dizem coisas diferentes.
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciarTransicao] = useTransition();
  const tratarFalha = useTratarFalha();
  const { avisarRedeOk } = useConexao();
  /**
   * Revisão do PR #62, item 2: "Voltar depois" navegava para o Hoje, mas a transição continuava
   * rodando, e quando `gerarRoteiroAction` terminava, o `router.push` para o roteiro disparava de
   * onde a pessoa estivesse (achado do Fable). Mesma ref que `FolhaGravarAgora` já usa: marcada no
   * clique, o sucesso (ou o erro) depois dela não navega nem escreve na tela mais.
   */
  const saiuRef = useRef(false);

  useEffect(() => {
    if (formatoTocado || !escolhido) return;
    setFormato(sugerirFormatoPeloObjetivo(escolhido));
  }, [escolhido, formatoTocado]);

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
    if (!escolhido) return;
    setErro(null);
    const desdeMs = Date.now();
    iniciarTransicao(async () => {
      try {
        const resultado = await gerarRoteiroAction(
          origem,
          escolhido,
          formato,
          estilo,
          objetivoDoVideo.trim() || undefined,
          quemAparece || undefined,
          data,
          formato === "story" ? (momentoDoDia ?? undefined) : undefined,
        );
        if (saiuRef.current) return;
        if (!resultado.ok) {
          setErro(resultado.erro);
          return;
        }
        avisarRedeOk();
        router.push(`/roteiros/${resultado.dado.id}`);
      } catch (falha) {
        if (saiuRef.current) return;
        /**
         * R1, item 0c: a geração não depende da aba continuar aberta (o servidor termina mesmo
         * sem ninguém esperando). Uma falha que parece de rede pode ser só a resposta que não
         * voltou, não a geração que não aconteceu: antes de assumir que precisa repetir, confere
         * se já existe um roteiro novo desta marca criado desde que a espera começou.
         */
        if (ehFalhaDeRede(falha)) {
          try {
            const recuperado = await roteiroRecenteDesdeAction(desdeMs);
            if (saiuRef.current) return;
            if (recuperado) {
              avisarRedeOk();
              router.push(`/roteiros/${recuperado.id}`);
              return;
            }
          } catch {
            // Sem resposta nem na recuperação: segue para a frase de rede de sempre, abaixo.
          }
        }
        if (saiuRef.current) return;
        // Gerar demora e o servidor pode ter terminado antes de a conexão cair: repetir cria outro roteiro,
        // então a frase de rede manda olhar o Histórico primeiro (V7, item 4 do PROXIMO.md).
        setErro(tratarFalha(falha, textosObjetivo.erro, textosConexao.conexaoCaiuNoMeio));
      }
    });
  }

  function voltarDepois() {
    saiuRef.current = true;
    // E39a: não /criar; o roteiro, pronto, aparece na Agenda do dia para que ele foi marcado.
    router.push("/hoje");
  }

  if (pendente) {
    return <TelaEscrevendo aberto fraseDemorando={textosObjetivo.demorando} aoVoltarDepois={voltarDepois} />;
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
          </div>
          {escolhido ? (
            <div className={styles.temaEscolhido}>
              <span className={styles.rotulo}>{textosObjetivo.objetivoEscolhido}</span>
              <span className={styles.tema}>{primeiraMaiuscula(NOME_OBJETIVO[escolhido])}</span>
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
      </div>
      <div className={styles.colunaPrincipal}>
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

      <PerguntaParaQuando data={data} onChange={setData} />
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

      <AreaTexto
        rotulo={`${textosObjetivo.objetivoDoVideo} ${textosObjetivo.objetivoDoVideoOpcional}`}
        ajuda={textosObjetivo.objetivoDoVideoAjuda}
        value={objetivoDoVideo}
        onChange={(evento) => setObjetivoDoVideo(evento.target.value)}
        placeholder={textosObjetivo.objetivoDoVideoPlaceholder}
        maxLength={200}
        linhasMin={2}
      />

      <BarraAcao
        secundaria={{ rotulo: textosComuns.voltar, onClick: () => router.back() }}
        primaria={{ rotulo: textosObjetivo.escrever, onClick: escrever, disabled: !escolhido, precisaDeRede: true }}
      />
      </div>
    </div>
  );
}
