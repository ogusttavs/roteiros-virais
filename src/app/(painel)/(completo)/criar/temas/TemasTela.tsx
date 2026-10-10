"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { Plataforma, TemaDoDia } from "@/db/schema";
import { ROTULO_TEMA_CARTAO } from "@/ia/enums";
import type { CartaoEmAlta as DadosEmAlta } from "@/servicos/em-alta";
import type { PerguntasDaTela } from "@/servicos/vozes-do-publico";
import { textosCriar } from "@/textos/criar";
import { textosHoje } from "@/textos/hoje";
import { textosVozes } from "@/textos/vozes-do-publico";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { CartaoEmAlta, destinoDoCartao } from "@/ui/componentes/CartaoEmAlta";
import { Chips } from "@/ui/componentes/Chips";
import { ClaqueteAnimada } from "@/ui/componentes/ClaqueteAnimada";
import { BlocoDePerguntas } from "@/ui/componentes/PerguntasDoPublico";
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
  /** O tema de hoje está sendo escolhido agora (o ramo não estava em uso de madrugada): mostra a espera e se atualiza sozinha. */
  gerando?: boolean;
  redePrincipal: Plataforma | null;
  /** Decisão pendente 5, revisão do Fable no PR #90: veio de "Criar roteiro" num dia vazio. */
  dataInicial?: string;
  /** E55 PR 2b: o assunto em alta hoje, no alto da lista, com "Quero esse"; nulo sem tema do momento, ou quando se escolhe o tema para outro dia. */
  emAlta?: DadosEmAlta | null;
  /** E28 (parte 3b): o que o público do setor perguntou nos comentários esta semana, depois dos três temas; nulo no setor sem leitura (o bloco nem aparece). */
  perguntas?: PerguntasDaTela | null;
};

/**
 * `/criar/temas` (E39a): a porta "Os temas de hoje", migrada da antiga porta Reels de `/hoje`
 * (V12, item 3a: a pergunta "onde você posta mais"; H3, item 1: o aviso sem tema). As outras
 * portas de Criar (assunto seu, contar o momento, planejar) viraram rotas à parte: esta tela cuida
 * só de escolher um tema.
 */
export function TemasTela({ temas, evidenciasTemas, avisoLinhaEditorial, aviso, gerando = false, redePrincipal, dataInicial, emAlta = null, perguntas = null }: Props) {
  const router = useRouter();

  // Enquanto o tema é escolhido, a página pergunta ao servidor de novo a cada poucos segundos; o servidor só devolve "gerando" enquanto há pedido em andamento, então isto para sozinho.
  useEffect(() => {
    if (!gerando) return;
    const intervalo = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(intervalo);
  }, [gerando, router]);
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

        {gerando ? (
          <div className={styles.estadoVazio} role="status" data-gerando-temas>
            <ClaqueteAnimada altura={72} />
            <h2>{textosHoje.gerandoTitulo}</h2>
            <p>{textosHoje.gerando}</p>
          </div>
        ) : aviso ? (
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
          <>
            {/* E55 PR 2b (passo 21, estado `reelsEmAlta`): o assunto do momento sai da lista comum (a posição dele nela, o `?tema=`, é a de antes) e vem aqui, com o prazo. Todos os botões do cartão são secundários. */}
            {emAlta ? (
              <CartaoEmAlta
                cartao={emAlta}
                destaque="secundario"
                rotuloDoBotao={emAlta.roteiro ? undefined : textosHoje.emAlta.queroEsse}
                ocupado={abrindo && destino === "em-alta"}
                desabilitado={abrindo}
                aoClicar={() => abrir("em-alta", destinoDoCartao(emAlta))}
              />
            ) : null}
            <div className={styles.temasTres}>
              {temas
                .map((tema, indice) => ({ tema, indice }))
                .filter(({ tema }) => !tema.doMomento)
                .map(({ tema, indice }, posicao) => (
                  <TemaCartao
                    key={`${tema.titulo}-${indice}`}
                    rotulo={ROTULO_TEMA_CARTAO[tema.puxaPara]}
                    tema={tema.titulo}
                    porque={tema.porQue}
                    evidencia={evidenciasTemas[indice] ?? null}
                    primario={posicao === 0}
                    rotuloBotao={textosHoje.queroEsse}
                    abrindo={destino === `tema-${indice}` && abrindo}
                    desabilitado={abrindo}
                    precisaDeRede
                    onEscolher={() => abrir(`tema-${indice}`, comData(`/criar/objetivo?tema=${indice}`))}
                  />
                ))}
            </div>
            {/* E28 (passo 25, estado `reels`): o que o público do setor pergunta nos comentários, depois dos três temas; cada pergunta leva ao Tema livre com ela presa. */}
            {perguntas ? (
              <BlocoDePerguntas
                id="t-perguntas-hoje"
                rotulo={textosVozes.rotulo}
                titulo={textosVozes.titulo}
                leitura={textosVozes.leitura(perguntas.videos, perguntas.plataformas, perguntas.lidasEm)}
                perguntas={perguntas.perguntas.map((p) => ({ chave: p.chave, texto: p.texto, vezesTexto: textosVozes.vezes(p.tipo, p.vezes) }))}
                rotuloDoBotao={textosVozes.responderEmVideo}
                nomeDoBotao={textosVozes.responderEmVideoDe}
                textoAbrindo={textosHoje.abrindo}
                abrindo={destino?.startsWith("pergunta-") && abrindo ? destino.slice("pergunta-".length) : null}
                desabilitado={abrindo}
                aoResponder={(chave) => abrir(`pergunta-${chave}`, `/criar/tema-livre?pergunta=${chave}${dataInicial ? `&data=${dataInicial}` : ""}`)}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
