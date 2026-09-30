"use client";

import { CircleCheck, Clock, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { BotaoSair } from "@/app/(painel)/(completo)/conta/BotaoSair";
import { PerguntaCampo, type ResultadoAcaoBriefing } from "@/app/(painel)/_briefing/PerguntaCampo";
import { SeletorMarcaCelular, type MarcaResumo } from "@/app/(painel)/_casca/SeletorMarcaCelular";
import { SeletorMarcaDesktop } from "@/app/(painel)/_casca/SeletorMarcaDesktop";
import { perguntasDoBriefing, perguntaPorId, perguntasDoBloco, TOTAL_BLOCOS } from "@/config/briefing";
import type { AvaliacaoResposta, TipoMarca } from "@/db/schema";
import { config } from "@/lib/config";
import { perguntaQueMaisAjuda, resumirMelhorar } from "@/servicos/briefing-regras";
import { textosBriefing } from "@/textos/briefing";
import { BarraAcao } from "@/ui/componentes/BarraAcao";
import { BarraNotaGeral } from "@/ui/componentes/BarraNotaGeral";
import { Botao } from "@/ui/componentes/Botao";
import { Progresso } from "@/ui/componentes/Progresso";
import { Toast } from "@/ui/componentes/Toast";
import { Simbolo } from "@/ui/Logo";

import { avaliarRespostaAction, salvarDadosFixosAction, salvarRascunhoAction } from "./acoes";
import styles from "./ComecarWizard.module.css";
import { DadosFixosForm, type DadosFixosIniciais } from "./DadosFixosForm";

type Props = {
  /** V12b, item 0: quem tem mais de uma marca troca daqui, sem ficar presa no briefing incompleto de uma so. */
  marcaAtiva: MarcaResumo;
  marcas: MarcaResumo[];
  nomePessoa: string;
  nichos: { id: number; nome: string }[];
  dadosFixosCompletos: boolean;
  dadosFixosIniciais: DadosFixosIniciais;
  respostasIniciais: Record<string, string>;
  avaliacoesIniciais: Record<string, AvaliacaoResposta>;
  notaGeralInicial: number;
  blocoInicial: number;
  meta: number;
  tipo: TipoMarca;
};

type Etapa = "intro" | "dadosFixos" | "blocos" | "liberado";

const ICONES_PROMESSA = [Clock, CircleCheck, Pencil];

/**
 * V12b, item 0: com uma marca só, o cabeçalho continua como sempre foi
 * (nada novo para a maioria); com mais de uma, ganha o mesmo seletor da
 * casca (`SeletorMarcaCelular`/`SeletorMarcaDesktop`, um escondido por vez
 * pela largura) e a linha "Briefing da <marca>", para a pessoa saber onde
 * está e trocar sem ficar presa no briefing de uma marca só.
 */
function CabecalhoSimples({ marcaAtiva, marcas, nomePessoa }: { marcaAtiva: MarcaResumo; marcas: MarcaResumo[]; nomePessoa: string }) {
  const variasMarcas = marcas.length > 1;
  return (
    <header className={styles.cabecalhoEnvoltorio}>
      <div className={styles.cabecalho}>
        <Simbolo altura={24} />
        <span className={styles.nomeProduto} data-app-name="">
          {config.appName}
        </span>
        <div className={styles.direita}>
          {variasMarcas ? (
            <>
              <span className={styles.seletorCelular}>
                <SeletorMarcaCelular marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={nomePessoa} />
              </span>
              <span className={styles.seletorDesktop}>
                <SeletorMarcaDesktop marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={nomePessoa} />
              </span>
            </>
          ) : null}
          <BotaoSair className={styles.botaoSair} />
        </div>
      </div>
      {variasMarcas ? (
        <p className={styles.deQualMarca}>{textosBriefing.comecar.deQualMarca(marcaAtiva.nome)}</p>
      ) : null}
    </header>
  );
}

/**
 * As sete estados de /comecar (design v2, `Comecar.dc.html`): introducao,
 * dados fixos, os cinco blocos do briefing (cada um com o estado de pergunta,
 * avaliando e erro, dentro de `PerguntaCampo`, mais a folha das doze notas,
 * dentro de `BarraNotaGeral`), e liberado. Sem a Nav principal do app
 * (proposital: isto acontece antes do painel abrir), por isso esta rota
 * mora fora do grupo (painel), sem a casca compartilhada.
 */
export function ComecarWizard({
  marcaAtiva,
  marcas,
  nomePessoa,
  nichos,
  dadosFixosCompletos,
  dadosFixosIniciais,
  respostasIniciais,
  avaliacoesIniciais,
  notaGeralInicial,
  blocoInicial,
  meta,
  tipo,
}: Props) {
  const router = useRouter();
  const [etapa, setEtapa] = useState<Etapa>(dadosFixosCompletos ? "blocos" : "intro");
  const [bloco, setBloco] = useState(blocoInicial);
  const [respostas, setRespostas] = useState(respostasIniciais);
  const [avaliacoes, setAvaliacoes] = useState(avaliacoesIniciais);
  const [notaGeral, setNotaGeral] = useState(notaGeralInicial);
  const [perguntaParaRolar, setPerguntaParaRolar] = useState<string | null>(null);
  /** As perguntas com avaliacao em curso, que falhou ou com rascunho que nao salvou (`onPendencia`). */
  const [pendentes, setPendentes] = useState<ReadonlySet<string>>(() => new Set());
  const [avisoDeSaida, setAvisoDeSaida] = useState(false);

  const aoMudarPendencia = useCallback((perguntaId: string, pendente: boolean) => {
    setPendentes((atual) => {
      if (atual.has(perguntaId) === pendente) return atual;
      const proximo = new Set(atual);
      if (pendente) proximo.add(perguntaId);
      else proximo.delete(perguntaId);
      return proximo;
    });
  }, []);
  const fecharAviso = useCallback(() => setAvisoDeSaida(false), []);

  /**
   * O que o servidor ja tem de cada resposta, para o campo voltar com o texto certo se a tela dele for
   * desmontada e montada de novo (voltar do bloco 1 para os dados do negocio): antes so a avaliacao
   * atualizava `respostas`, e o texto digitado e nao avaliado voltava vazio ou antigo (V7, item 4 do
   * PROXIMO.md). So depois de o servidor confirmar, para nunca mostrar como salvo o que nao foi.
   */
  const salvarRascunho = useCallback(async (perguntaId: string, texto: string, transcricaoBruta?: string) => {
    await salvarRascunhoAction(perguntaId, texto, transcricaoBruta);
    setRespostas((atual) => (atual[perguntaId] === texto ? atual : { ...atual, [perguntaId]: texto }));
  }, []);

  /**
   * Tocar numa linha da lista de notas rola ate a pergunta (brief-frontend.md
   * 6.2, "Ajuste de 06/09/2026"); se a pergunta e de outro bloco,
   * `aoSelecionarPergunta` troca o bloco. Os 12 campos ficam montados o
   * tempo todo (os de outros blocos escondidos com `hidden`, V7, item 4 do
   * PROXIMO.md), entao o elemento ja esta no DOM na primeira passada; o
   * `scrollIntoView` so funciona porque `aoSelecionarPergunta` troca `bloco`
   * e `perguntaParaRolar` no mesmo evento, na mesma renderizacao (num campo
   * ainda `hidden` ele nao faz nada).
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
        <CabecalhoSimples marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={nomePessoa} />
        <div className={styles.corpoIntro}>
          <div className={styles.cabecalhoTela}>
            <span className={styles.data}>{textosBriefing.comecar.passoUm}</span>
            <h1>{textosBriefing.comecar.titulo}</h1>
          </div>
          <p className={styles.introducao}>{textosBriefing.comecar.introducao(tipo)}</p>
          <div className={styles.promessas}>
            {textosBriefing.comecar.promessas.map((promessa, indice) => {
              const Icone = ICONES_PROMESSA[indice];
              return (
                <div key={promessa.titulo} className={styles.promessa}>
                  <Icone size={20} strokeWidth={1.5} aria-hidden="true" className={styles.iconePromessa} />
                  <strong>{promessa.titulo}</strong>
                  <p>{promessa.texto}</p>
                </div>
              );
            })}
          </div>
        </div>
        <BarraAcao
          presaAoFluxo
          primaria={{ rotulo: textosBriefing.comecar.botaoComecar, onClick: () => setEtapa("dadosFixos") }}
        />
      </div>
    );
  }

  if (etapa === "dadosFixos") {
    return (
      <div className={styles.pagina}>
        <CabecalhoSimples marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={nomePessoa} />
        <div className={styles.corpo}>
          <div className={styles.cabecalhoTela}>
            <span className={styles.data}>{textosBriefing.dadosFixos.passoUm}</span>
            <h1 className={styles.tituloSecao}>{textosBriefing.dadosFixos.titulo(tipo)}</h1>
            <p className={styles.introducao}>{textosBriefing.dadosFixos.introducao}</p>
          </div>
          <DadosFixosForm
            nichos={nichos}
            inicial={dadosFixosIniciais}
            onSalvar={aoSalvarDadosFixos}
            onVoltar={() => setEtapa("intro")}
            tipo={tipo}
          />
        </div>
      </div>
    );
  }

  if (etapa === "liberado") {
    return (
      <div className={styles.pagina}>
        <CabecalhoSimples marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={nomePessoa} />
        <div className={styles.corpoLiberado}>
          <span className={styles.selo} aria-hidden="true">
            <CircleCheck size={28} strokeWidth={1.5} />
          </span>
          <div className={styles.cabecalhoTela}>
            <span className={styles.data}>{`nota ${notaGeral.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}, meta ${meta}`}</span>
            <h1>{textosBriefing.liberacao.titulo}</h1>
          </div>
          <p className={styles.introducao}>{textosBriefing.liberacao.introducao}</p>
          <div className={styles.acoesLiberado}>
            <Botao onClick={() => router.push("/hoje")}>{textosBriefing.liberacao.botao}</Botao>
            <Botao variante="secundario" onClick={() => router.push("/briefing")}>
              {textosBriefing.liberacao.botaoRevisar}
            </Botao>
          </div>
        </div>
      </div>
    );
  }

  const perguntas = perguntasDoBloco(bloco, tipo);
  const dica = perguntaQueMaisAjuda(avaliacoes, tipo);

  /**
   * Os cinco blocos ficam montados o tempo todo, so escondidos (V7, item 4 do PROXIMO.md): com um bloco
   * por vez, "Proximo bloco" desmontava os campos e o texto que ainda nao tinha sido avaliado se perdia,
   * e o erro de uma avaliacao que falhasse caia num componente que ja nao existia. Assim o estado de cada
   * campo sobrevive. Sair de um bloco com uma resposta ainda pendente nao descarta nada, mas avisa.
   */
  function avisarSeHouverPendencia() {
    if (perguntasDoBloco(bloco, tipo).some((pergunta) => pendentes.has(pergunta.id))) setAvisoDeSaida(true);
  }

  function aoSelecionarPergunta(perguntaId: string) {
    const pergunta = perguntaPorId(perguntaId, tipo);
    if (!pergunta) return;
    if (pergunta.bloco !== bloco) {
      avisarSeHouverPendencia();
      setBloco(pergunta.bloco);
    }
    setPerguntaParaRolar(perguntaId);
  }

  return (
    <div className={styles.pagina}>
      <CabecalhoSimples marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={nomePessoa} />
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
          notas={perguntasDoBriefing(tipo).map((p) => ({
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
          <div className={styles.cabecalhoTela}>
            <span className={styles.data}>{textosBriefing.progresso.bloco(bloco, TOTAL_BLOCOS)}</span>
            <h1 className={styles.tituloSecao}>{perguntas[0]?.blocoNome}</h1>
            <Progresso
              rotulo={textosBriefing.progresso.respondidas(Object.keys(avaliacoes).length, perguntasDoBriefing(tipo).length)}
              atual={Object.keys(avaliacoes).length}
              total={perguntasDoBriefing(tipo).length}
            />
          </div>
          {/* `hidden` num div sem classe: uma classe com `display` valeria mais que o atributo. */}
          {perguntasDoBriefing(tipo).map((pergunta) => (
            <div key={pergunta.id} id={`pergunta-${pergunta.id}`} hidden={pergunta.bloco !== bloco}>
              <PerguntaCampo
                pergunta={pergunta}
                resposta={respostas[pergunta.id] ?? ""}
                avaliacao={avaliacoes[pergunta.id] ?? null}
                onSalvarRascunho={salvarRascunho}
                onAvaliar={avaliarRespostaAction}
                onAtualizado={aoAtualizarPergunta}
                onPendencia={aoMudarPendencia}
                meta={meta}
              />
            </div>
          ))}
          <BarraAcao
            presaAoFluxo
            secundaria={{
              rotulo: textosBriefing.navegacaoBlocos.botaoVoltar,
              onClick: () => {
                if (bloco > 1) {
                  avisarSeHouverPendencia();
                  setBloco((atual) => atual - 1);
                } else {
                  // Os campos desmontam aqui: o rascunho pendente vai antes (`PerguntaCampo`) e volta com o
                  // texto salvo (`salvarRascunho`). O aviso ficaria preso e apareceria na volta.
                  setAvisoDeSaida(false);
                  setEtapa("dadosFixos");
                }
              },
            }}
            primaria={
              bloco < TOTAL_BLOCOS
                ? {
                    rotulo: textosBriefing.navegacaoBlocos.botaoProximoBloco,
                    onClick: () => {
                      avisarSeHouverPendencia();
                      setBloco((atual) => atual + 1);
                    },
                  }
                : undefined
            }
          />
        </div>
      </div>
      <Toast
        texto={textosBriefing.navegacaoBlocos.avisoRespostaPendente}
        aberto={avisoDeSaida}
        onFechar={fecharAviso}
        variante="erro"
      />
    </div>
  );
}
