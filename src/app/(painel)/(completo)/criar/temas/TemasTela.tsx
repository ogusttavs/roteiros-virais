"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { DataMarcada, DataProxima } from "@/config/datas";
import type { Plataforma, TemaDoDia } from "@/db/schema";
import { ROTULO_TEMA_CARTAO } from "@/ia/enums";
import type { CartaoEmAlta as DadosEmAlta } from "@/servicos/em-alta";
import type { PerguntasDaTela } from "@/servicos/vozes-do-publico";
import { textosCriar } from "@/textos/criar";
import { textosHoje } from "@/textos/hoje";
import { textosVozes } from "@/textos/vozes-do-publico";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { CartaoDeData } from "@/ui/componentes/CartaoDeData";
import { CartaoEmAlta, destinoDoCartao } from "@/ui/componentes/CartaoEmAlta";
import { Chips } from "@/ui/componentes/Chips";
import { ClaqueteAnimada } from "@/ui/componentes/ClaqueteAnimada";
import { BlocoDePerguntas } from "@/ui/componentes/PerguntasDoPublico";
import { TemaCartao, type EvidenciaTema, type FonteNoticiaTema } from "@/ui/componentes/TemaCartao";

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
  /** Hotfix de 23/10/2026: de qual notícia nasceu cada tema que nenhum vídeo sustenta (na ordem de `temas`); nulo nos demais. */
  fontesNoticias?: (FonteNoticiaTema | null)[];
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
  /** E60: a data de hoje ou a que chega nos próximos 7 dias, como sugestão de tema (a fonte é a data); vazia sem data que valha para a marca. */
  datas?: { hoje: DataMarcada[]; proximas: DataProxima[] } | null;
};

/**
 * `/criar/temas` (E39a): a porta "Os temas de hoje", migrada da antiga porta Reels de `/hoje`
 * (V12, item 3a: a pergunta "onde você posta mais"; H3, item 1: o aviso sem tema). As outras
 * portas de Criar (assunto seu, contar o momento, planejar) viraram rotas à parte: esta tela cuida
 * só de escolher um tema.
 */
/** Quantos temas o dia fecha (os "três temas" do produto). */
const TEMAS_POR_DIA = 3;

export function TemasTela({ temas, evidenciasTemas, fontesNoticias = [], avisoLinhaEditorial, aviso, gerando = false, redePrincipal, dataInicial, emAlta = null, perguntas = null, datas = null }: Props) {
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

  // Os temas que a pessoa vê: os da lista comum e o cartão do assunto em alta (ele sai da lista e vem à parte).
  const temasVisiveis = temas.filter((tema) => !tema.doMomento).length + (emAlta ? 1 : 0);

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

        {datas ? <CartaoDeData hoje={datas.hoje} proximas={datas.proximas} variante="sugestao" /> : null}

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
                    porque={tema.doSetor ? `${textosHoje.temaDoSetor} ${tema.porQue}` : tema.porQue}
                    evidencia={evidenciasTemas[indice] ?? null}
                    fonteNoticia={fontesNoticias[indice] ?? null}
                    primario={posicao === 0}
                    rotuloBotao={textosHoje.queroEsse}
                    abrindo={destino === `tema-${indice}` && abrindo}
                    desabilitado={abrindo}
                    precisaDeRede
                    onEscolher={() => abrir(`tema-${indice}`, comData(`/criar/objetivo?tema=${indice}&titulo=${encodeURIComponent(tema.titulo)}`))}
                  />
                ))}
            </div>
            {/* Hotfix de 23/10/2026: o último recurso (nem vídeo de prova, nem notícia, nem assunto em alta deram três temas): a frase calma e o caminho do assunto próprio. */}
            {temasVisiveis < TEMAS_POR_DIA ? (
              <div className={styles.poucosTemas} data-poucos-temas>
                <p className={styles.aviso}>{textosHoje.poucosTemas(temasVisiveis)}</p>
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
            ) : null}
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
