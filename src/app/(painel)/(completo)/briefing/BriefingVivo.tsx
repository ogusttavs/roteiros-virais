"use client";

import { useState } from "react";

import { PERGUNTAS_BRIEFING, perguntasDoBloco, TOTAL_BLOCOS } from "@/config/briefing";
import type { AvaliacaoResposta, PerfilCompilado } from "@/db/schema";
import { perguntaQueMaisAjuda } from "@/servicos/briefing-regras";
import { textosBriefing } from "@/textos/briefing";
import { BarraNotaGeral } from "@/ui/componentes/BarraNotaGeral";
import { Cartao } from "@/ui/componentes/Cartao";

import { PerguntaCampo, type ResultadoAcaoBriefing } from "../../_briefing/PerguntaCampo";

import { avaliarRespostaAction, salvarRascunhoAction } from "./acoes";
import styles from "./BriefingVivo.module.css";

type Props = {
  respostasIniciais: Record<string, string>;
  avaliacoesIniciais: Record<string, AvaliacaoResposta>;
  notaGeralInicial: number;
  perfil: PerfilCompilado | null;
  meta: number;
};

const BLOCOS = Array.from({ length: TOTAL_BLOCOS }, (_, i) => i + 1);

/** O briefing vivo (brief-frontend.md, 6.8): as doze respostas com nota, editaveis, e o perfil compilado. */
export function BriefingVivo({
  respostasIniciais,
  avaliacoesIniciais,
  notaGeralInicial,
  perfil,
  meta,
}: Props) {
  const [respostas, setRespostas] = useState(respostasIniciais);
  const [avaliacoes, setAvaliacoes] = useState(avaliacoesIniciais);
  const [notaGeral, setNotaGeral] = useState(notaGeralInicial);

  function aoAtualizarPergunta(perguntaId: string, resposta: string, resultado: ResultadoAcaoBriefing) {
    setRespostas((atual) => ({ ...atual, [perguntaId]: resposta }));
    setAvaliacoes((atual) => ({ ...atual, [perguntaId]: resultado.avaliacao }));
    setNotaGeral(resultado.notaGeral);
  }

  const dica = perguntaQueMaisAjuda(avaliacoes);

  return (
    <div className={styles.pagina}>
      <BarraNotaGeral
        notaAtual={notaGeral}
        meta={meta}
        rotuloNotaAtual={textosBriefing.barraNotaGeral.rotuloNotaAtual}
        rotuloMeta={textosBriefing.barraNotaGeral.rotuloMeta(meta)}
        dica={notaGeral < meta && dica ? textosBriefing.notaCaiu(notaGeral, dica.id) : undefined}
        semNota={textosBriefing.barraNotaGeral.semNota}
        tituloFolha={textosBriefing.barraNotaGeral.tituloFolha}
        notas={PERGUNTAS_BRIEFING.map((p) => ({
          rotulo: textosBriefing.barraNotaGeral.rotuloPergunta(p.id),
          nota: avaliacoes[p.id]?.nota ?? null,
        }))}
      />
      <div className={styles.corpo}>
        <h1>{textosBriefing.briefing.titulo}</h1>
        <p className={styles.introducao}>{textosBriefing.briefing.introducao}</p>

        {perfil ? (
          <Cartao variante="recuado" className={styles.cartaoPerfil}>
            <h2 className={styles.perfilTitulo}>{textosBriefing.briefing.perfilTitulo}</h2>
            <dl className={styles.perfilFatos}>
              <div>
                <dt>{textosBriefing.briefing.perfilOQueVende}</dt>
                <dd>{perfil.fatos.oQueVende}</dd>
              </div>
              <div>
                <dt>{textosBriefing.briefing.perfilClienteIdeal}</dt>
                <dd>{perfil.fatos.clienteIdeal}</dd>
              </div>
              {perfil.fatos.proibicoes.length > 0 ? (
                <div>
                  <dt>{textosBriefing.briefing.perfilProibicoes}</dt>
                  <dd>{perfil.fatos.proibicoes.join(", ")}</dd>
                </div>
              ) : null}
            </dl>
            <p className={styles.perfilRodape}>{textosBriefing.briefing.perfilSeErrado}</p>
          </Cartao>
        ) : null}

        {BLOCOS.map((bloco) => {
          const perguntas = perguntasDoBloco(bloco);
          return (
            <section key={bloco} className={styles.bloco}>
              <h2 className={styles.blocoTitulo}>{perguntas[0]?.blocoNome}</h2>
              {perguntas.map((pergunta) => (
                <PerguntaCampo
                  key={pergunta.id}
                  pergunta={pergunta}
                  resposta={respostas[pergunta.id] ?? ""}
                  avaliacao={avaliacoes[pergunta.id] ?? null}
                  onSalvarRascunho={salvarRascunhoAction}
                  onAvaliar={avaliarRespostaAction}
                  onAtualizado={aoAtualizarPergunta}
                  variante="vivo"
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
