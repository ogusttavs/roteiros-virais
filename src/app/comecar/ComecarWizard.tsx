"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PerguntaCampo, type ResultadoAcaoBriefing } from "@/app/(painel)/_briefing/PerguntaCampo";
import { PERGUNTAS_BRIEFING, perguntaPorId, perguntasDoBloco, TOTAL_BLOCOS } from "@/config/briefing";
import type { AvaliacaoResposta } from "@/db/schema";
import { config } from "@/lib/config";
import { perguntaQueMaisAjuda, resumirMelhorar } from "@/servicos/briefing-regras";
import { textosBriefing } from "@/textos/briefing";
import { BarraAcao } from "@/ui/componentes/BarraAcao";
import { BarraNotaGeral } from "@/ui/componentes/BarraNotaGeral";
import { Progresso } from "@/ui/componentes/Progresso";
import { Logo } from "@/ui/Logo";

import { avaliarRespostaAction, salvarDadosFixosAction, salvarRascunhoAction } from "./acoes";
import styles from "./ComecarWizard.module.css";
import { DadosFixosForm, type DadosFixosIniciais } from "./DadosFixosForm";

type Props = {
  nichos: { id: number; nome: string }[];
  dadosFixosCompletos: boolean;
  dadosFixosIniciais: DadosFixosIniciais;
  respostasIniciais: Record<string, string>;
  avaliacoesIniciais: Record<string, AvaliacaoResposta>;
  notaGeralInicial: number;
  blocoInicial: number;
  meta: number;
};

type Etapa = "intro" | "dadosFixos" | "blocos" | "liberado";

function CabecalhoSimples() {
  return (
    <div className={styles.cabecalho}>
      <Logo tamanho={24} />
      <span className={styles.nomeProduto}>{config.appName}</span>
    </div>
  );
}

/**
 * As tres partes de /comecar (BriefingTela.dc.html): introducao, dados
 * fixos, depois os cinco blocos do briefing. Sem a Nav principal do app
 * (proposital: isto acontece antes do painel abrir), por isso esta rota
 * mora fora do grupo (painel), sem a casca compartilhada.
 */
export function ComecarWizard({
  nichos,
  dadosFixosCompletos,
  dadosFixosIniciais,
  respostasIniciais,
  avaliacoesIniciais,
  notaGeralInicial,
  blocoInicial,
  meta,
}: Props) {
  const router = useRouter();
  const [etapa, setEtapa] = useState<Etapa>(dadosFixosCompletos ? "blocos" : "intro");
  const [bloco, setBloco] = useState(blocoInicial);
  const [respostas, setRespostas] = useState(respostasIniciais);
  const [avaliacoes, setAvaliacoes] = useState(avaliacoesIniciais);
  const [notaGeral, setNotaGeral] = useState(notaGeralInicial);
  const [perguntaParaRolar, setPerguntaParaRolar] = useState<string | null>(null);

  /**
   * Tocar numa linha da lista de notas rola ate a pergunta (brief-frontend.md
   * 6.2, "Ajuste de 06/09/2026"); se a pergunta e de outro bloco,
   * `aoSelecionarPergunta` troca o bloco primeiro. O efeito reroda quando
   * `bloco` muda, entao a segunda vez ja acha o elemento no DOM.
   */
  useEffect(() => {
    if (!perguntaParaRolar) return;
    const elemento = document.getElementById(`pergunta-${perguntaParaRolar}`);
    if (elemento) {
      elemento.scrollIntoView({ behavior: "smooth", block: "center" });
      setPerguntaParaRolar(null);
    }
  }, [perguntaParaRolar, bloco]);

  function aoAtualizarPergunta(perguntaId: string, resposta: string, resultado: ResultadoAcaoBriefing) {
    setRespostas((atual) => ({ ...atual, [perguntaId]: resposta }));
    setAvaliacoes((atual) => ({ ...atual, [perguntaId]: resultado.avaliacao }));
    setNotaGeral(resultado.notaGeral);
    if (resultado.completo) {
      setEtapa("liberado");
    }
  }

  async function aoSalvarDadosFixos(dados: unknown) {
    await salvarDadosFixosAction(dados);
    setEtapa("blocos");
  }

  if (etapa === "intro") {
    return (
      <div className={styles.pagina}>
        <CabecalhoSimples />
        <div className={styles.corpoIntro}>
          <h1>{textosBriefing.comecar.titulo}</h1>
          <p className={styles.introducao}>{textosBriefing.comecar.introducao}</p>
          <p className={styles.introducaoSecundaria}>{textosBriefing.comecar.introNota}</p>
        </div>
        <BarraAcao primaria={{ rotulo: textosBriefing.comecar.botaoComecar, onClick: () => setEtapa("dadosFixos") }} />
      </div>
    );
  }

  if (etapa === "dadosFixos") {
    return (
      <div className={styles.pagina}>
        <CabecalhoSimples />
        <div className={styles.corpo}>
          <h1 className={styles.tituloSecao}>{textosBriefing.dadosFixos.titulo}</h1>
          <p className={styles.introducao}>{textosBriefing.dadosFixos.introducao}</p>
          <DadosFixosForm
            nichos={nichos}
            inicial={dadosFixosIniciais}
            onSalvar={aoSalvarDadosFixos}
            onVoltar={() => setEtapa("intro")}
          />
        </div>
      </div>
    );
  }

  if (etapa === "liberado") {
    return (
      <div className={styles.pagina}>
        <CabecalhoSimples />
        <div className={styles.corpoLiberado}>
          <h1>{textosBriefing.liberacao.titulo}</h1>
        </div>
        <BarraAcao
          primaria={{ rotulo: textosBriefing.liberacao.botao, onClick: () => router.push("/hoje") }}
        />
      </div>
    );
  }

  const perguntas = perguntasDoBloco(bloco);
  const dica = perguntaQueMaisAjuda(avaliacoes);

  function aoSelecionarPergunta(perguntaId: string) {
    const pergunta = perguntaPorId(perguntaId);
    if (!pergunta) return;
    if (pergunta.bloco !== bloco) setBloco(pergunta.bloco);
    setPerguntaParaRolar(perguntaId);
  }

  return (
    <div className={styles.pagina}>
      <div className={styles.corpoComNota}>
        <BarraNotaGeral
          notaAtual={notaGeral}
          meta={meta}
          rotuloNotaAtual={textosBriefing.barraNotaGeral.rotuloNotaAtual}
          rotuloMeta={textosBriefing.barraNotaGeral.rotuloMeta(meta)}
          dica={notaGeral < meta && dica ? textosBriefing.barraNotaGeral.dica(dica.id) : undefined}
          semNota={textosBriefing.barraNotaGeral.semNota}
          tituloFolha={textosBriefing.barraNotaGeral.tituloFolha}
          aoTocarItem={aoSelecionarPergunta}
          notas={PERGUNTAS_BRIEFING.map((p) => ({
            id: p.id,
            rotulo: textosBriefing.barraNotaGeral.rotuloPergunta(p.id, p.rotuloCurto),
            nota: avaliacoes[p.id]?.nota ?? null,
            melhorarResumo: avaliacoes[p.id] ? resumirMelhorar(avaliacoes[p.id].melhorar) : null,
          }))}
        />
        <div className={styles.corpo}>
          <Progresso
            rotulo={textosBriefing.progresso.bloco(bloco, TOTAL_BLOCOS)}
            atual={bloco}
            total={TOTAL_BLOCOS}
          />
          <h1 className={styles.tituloSecao}>{perguntas[0]?.blocoNome}</h1>
          {perguntas.map((pergunta) => (
            <div key={pergunta.id} id={`pergunta-${pergunta.id}`}>
              <PerguntaCampo
                pergunta={pergunta}
                resposta={respostas[pergunta.id] ?? ""}
                avaliacao={avaliacoes[pergunta.id] ?? null}
                onSalvarRascunho={salvarRascunhoAction}
                onAvaliar={avaliarRespostaAction}
                onAtualizado={aoAtualizarPergunta}
              />
            </div>
          ))}
          <BarraAcao
            secundaria={{
              rotulo: textosBriefing.navegacaoBlocos.botaoVoltar,
              onClick: () => (bloco > 1 ? setBloco((atual) => atual - 1) : setEtapa("dadosFixos")),
            }}
            primaria={
              bloco < TOTAL_BLOCOS
                ? {
                    rotulo: textosBriefing.navegacaoBlocos.botaoProximoBloco,
                    onClick: () => setBloco((atual) => atual + 1),
                  }
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
