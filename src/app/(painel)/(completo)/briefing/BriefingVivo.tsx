"use client";

import { useState } from "react";

import { PERGUNTAS_BRIEFING, perguntasDoBloco, TOTAL_BLOCOS } from "@/config/briefing";
import type { AvaliacaoResposta, PerfilCompilado } from "@/db/schema";
import { perguntaQueMaisAjuda, resumirMelhorar } from "@/servicos/briefing-regras";
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

/**
 * Os itens do perfil compilado que o cartao "como o sistema te entende"
 * mostra (design v2, `Briefing.dc.html`, ".perfil"), so quando o campo tem
 * dado de fato (item 3 do PROXIMO.md: "campo sem dado não aparece").
 */
function itensDoPerfil(perfil: PerfilCompilado) {
  return [
    { titulo: textosBriefing.briefing.perfilOQueVende, texto: perfil.fatos.oQueVende },
    { titulo: textosBriefing.briefing.perfilClienteIdeal, texto: perfil.fatos.clienteIdeal },
    { titulo: textosBriefing.briefing.perfilMedos, texto: perfil.fatos.medos.join(" ") },
    { titulo: textosBriefing.briefing.perfilProibicoes, texto: perfil.fatos.proibicoes.join(", ") },
    { titulo: textosBriefing.briefing.perfilCenas, texto: perfil.fatos.cenasFilmaveis.join(", ") },
  ].filter((item) => item.texto.trim().length > 0);
}

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
  const itensPerfil = perfil ? itensDoPerfil(perfil) : [];

  function aoSelecionarPergunta(perguntaId: string) {
    document.getElementById(`pergunta-${perguntaId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className={styles.pagina}>
      <div className={styles.corpoComNota}>
        <BarraNotaGeral
          notaAtual={notaGeral}
          meta={meta}
          rotuloNotaAtual={textosBriefing.barraNotaGeral.rotuloNotaAtual}
          rotuloMeta={textosBriefing.barraNotaGeral.rotuloMeta(meta)}
          dica={notaGeral < meta && dica ? textosBriefing.notaCaiu(notaGeral, dica.id) : undefined}
          semNota={textosBriefing.barraNotaGeral.semNota}
          tituloFolha={textosBriefing.barraNotaGeral.tituloFolha}
          aoTocarItem={aoSelecionarPergunta}
          notas={PERGUNTAS_BRIEFING.map((p) => ({
            id: p.id,
            rotulo: textosBriefing.barraNotaGeral.rotuloPergunta(p.id, p.rotuloCurto),
            nota: avaliacoes[p.id]?.nota ?? null,
            /** Na meta, a lista mostra a palavra, nao o resumo (design v2, "Briefing.dc.html", ".lista-notas"; item 0 do PROXIMO.md). */
            melhorarResumo: !avaliacoes[p.id]
              ? null
              : avaliacoes[p.id].nota >= meta
                ? `${textosBriefing.faixaMeta.naMeta}.`
                : resumirMelhorar(avaliacoes[p.id].melhorar),
          }))}
        />
        <div className={styles.corpo}>
          <h1>{textosBriefing.briefing.titulo}</h1>
          <p className={styles.introducao}>{textosBriefing.briefing.introducao}</p>

          {itensPerfil.length > 0 ? (
            <Cartao variante="recuado" className={styles.cartaoPerfil}>
              <h2 className={styles.perfilTitulo}>{textosBriefing.briefing.perfilTitulo}</h2>
              <dl className={styles.perfilFatos}>
                {itensPerfil.map((item) => (
                  <div key={item.titulo}>
                    <dt>{item.titulo}</dt>
                    <dd>{item.texto}</dd>
                  </div>
                ))}
              </dl>
              <p className={styles.perfilRodape}>{textosBriefing.briefing.perfilRodape}</p>
            </Cartao>
          ) : null}

          {BLOCOS.map((bloco) => {
            const perguntas = perguntasDoBloco(bloco);
            return (
              <section key={bloco} className={styles.bloco}>
                <h2 className={styles.blocoTitulo}>{perguntas[0]?.blocoNome}</h2>
                {perguntas.map((pergunta) => (
                  <div key={pergunta.id} id={`pergunta-${pergunta.id}`}>
                    <PerguntaCampo
                      pergunta={pergunta}
                      resposta={respostas[pergunta.id] ?? ""}
                      avaliacao={avaliacoes[pergunta.id] ?? null}
                      onSalvarRascunho={salvarRascunhoAction}
                      onAvaliar={avaliarRespostaAction}
                      onAtualizado={aoAtualizarPergunta}
                      meta={meta}
                      variante="vivo"
                    />
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
