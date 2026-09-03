"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { PERGUNTAS_BRIEFING, perguntasDoBloco, TOTAL_BLOCOS } from "@/config/briefing";
import type { AvaliacaoResposta } from "@/db/schema";
import { perguntaQueMaisAjuda } from "@/servicos/briefing-regras";
import { textosBriefing } from "@/textos/briefing";
import { BarraNotaGeral } from "@/ui/componentes/BarraNotaGeral";
import { Botao } from "@/ui/componentes/Botao";
import { Progresso } from "@/ui/componentes/Progresso";

import { PerguntaCampo, type ResultadoAcaoBriefing } from "../_briefing/PerguntaCampo";

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

type Etapa = "dadosFixos" | "blocos" | "liberado";

/** As duas partes de /comecar (brief-frontend.md, 6.2): dados fixos, depois os cinco blocos. */
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
  const [etapa, setEtapa] = useState<Etapa>(dadosFixosCompletos ? "blocos" : "dadosFixos");
  const [bloco, setBloco] = useState(blocoInicial);
  const [respostas, setRespostas] = useState(respostasIniciais);
  const [avaliacoes, setAvaliacoes] = useState(avaliacoesIniciais);
  const [notaGeral, setNotaGeral] = useState(notaGeralInicial);

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

  if (etapa === "dadosFixos") {
    return (
      <div className={styles.pagina}>
        <h1>{textosBriefing.comecar.titulo}</h1>
        <p className={styles.introducao}>{textosBriefing.comecar.introducao}</p>
        <div className={styles.corpo}>
          <h2>{textosBriefing.dadosFixos.titulo}</h2>
          <p className={styles.introducao}>{textosBriefing.dadosFixos.introducao}</p>
          <DadosFixosForm nichos={nichos} inicial={dadosFixosIniciais} onSalvar={aoSalvarDadosFixos} />
        </div>
      </div>
    );
  }

  if (etapa === "liberado") {
    return (
      <div className={styles.liberacao}>
        <h1>{textosBriefing.liberacao.titulo}</h1>
        <Botao tamanho="lg" onClick={() => router.push("/hoje")}>
          {textosBriefing.liberacao.botao}
        </Botao>
      </div>
    );
  }

  const perguntas = perguntasDoBloco(bloco);
  const dica = perguntaQueMaisAjuda(avaliacoes);

  return (
    <div className={styles.pagina}>
      <BarraNotaGeral
        notaAtual={notaGeral}
        meta={meta}
        rotuloNotaAtual={textosBriefing.barraNotaGeral.rotuloNotaAtual}
        rotuloMeta={textosBriefing.barraNotaGeral.rotuloMeta(meta)}
        dica={notaGeral < meta && dica ? textosBriefing.barraNotaGeral.dica(dica.id) : undefined}
        semNota={textosBriefing.barraNotaGeral.semNota}
        tituloFolha={textosBriefing.barraNotaGeral.tituloFolha}
        notas={PERGUNTAS_BRIEFING.map((p) => ({
          rotulo: textosBriefing.barraNotaGeral.rotuloPergunta(p.id),
          nota: avaliacoes[p.id]?.nota ?? null,
        }))}
      />
      <div className={styles.corpo}>
        <h1>{textosBriefing.comecar.titulo}</h1>
        <Progresso
          rotulo={textosBriefing.progresso.bloco(bloco, TOTAL_BLOCOS)}
          atual={bloco}
          total={TOTAL_BLOCOS}
        />
        {perguntas.map((pergunta) => (
          <PerguntaCampo
            key={pergunta.id}
            pergunta={pergunta}
            resposta={respostas[pergunta.id] ?? ""}
            avaliacao={avaliacoes[pergunta.id] ?? null}
            onSalvarRascunho={salvarRascunhoAction}
            onAvaliar={avaliarRespostaAction}
            onAtualizado={aoAtualizarPergunta}
          />
        ))}
        <div className={styles.navegacao}>
          {bloco > 1 ? (
            <Botao variante="secundario" onClick={() => setBloco((atual) => atual - 1)}>
              {textosBriefing.navegacaoBlocos.botaoVoltar}
            </Botao>
          ) : (
            <span />
          )}
          {bloco < TOTAL_BLOCOS ? (
            <Botao onClick={() => setBloco((atual) => atual + 1)}>
              {textosBriefing.navegacaoBlocos.botaoProximoBloco}
            </Botao>
          ) : null}
        </div>
      </div>
    </div>
  );
}
