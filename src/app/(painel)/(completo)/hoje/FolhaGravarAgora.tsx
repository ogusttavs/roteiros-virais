"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { dadosFixosDoBriefing } from "@/config/briefing";
import { FICHAS_EM_ORDEM, NOME_DA_FICHA, fichaPadraoDoObjetivo, objetivoDaFicha } from "@/config/fichas";
import type { EstiloRoteiro, Ficha, FormatoRoteiro, MomentoDoDia, Objetivo, QuemGrava, TipoMarca } from "@/db/schema";
import {
  DESCRICAO_ESTILO_ROTEIRO,
  ESTILOS_ROTEIRO_EM_ORDEM,
  FORMATOS_ROTEIRO_EM_ORDEM,
  ROTULO_ESTILO_ROTEIRO,
  ROTULO_FORMATO_ROTEIRO,
} from "@/ia/enums";
import { hojeISO } from "@/lib/config";
import { ehFalhaDeRede } from "@/lib/offline";
import { textosMomento } from "@/textos/momento";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { Botao } from "@/ui/componentes/Botao";
import { CampoComFala } from "@/ui/componentes/CampoComFala";
import { Chips } from "@/ui/componentes/Chips";
import { Folha } from "@/ui/componentes/Folha";
import { GravadorDeAudio } from "@/ui/componentes/GravadorDeAudio";
import { OpcaoObjetivo } from "@/ui/componentes/OpcaoObjetivo";
import { PerguntaMomentoDoDia, PerguntaParaQuando } from "@/ui/componentes/PerguntaAgendamento";
import { TelaEscrevendo } from "@/ui/componentes/TelaEscrevendo";
import { useGravadorDeAudio } from "@/ui/componentes/useGravadorDeAudio";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";

import { roteiroRecenteDesdeAction } from "./acoes";
import styles from "./FolhaGravarAgora.module.css";
import { gerarRoteiroMomentoAction, lerMomentoDeTextoAction } from "./momento/acoes";
import { aceitarPlanoAction } from "./plano/acoes";

type MarcaResumo = { id: number; nome: string };

/** V9b, item 3: o que um item do plano já sugeriu, para a folha abrir preenchida. */
export type ValoresIniciaisMomento = {
  onde: string;
  oQueEstaAcontecendo: string;
  oQueDaParaMostrar: string;
  objetivo: Objetivo;
  formato: FormatoRoteiro;
  marcaId: number | null;
  /** E40, item 2: "o que este vídeo precisa comunicar?", quando o dia do plano já trouxe um. */
  objetivoDoVideo?: string | null;
};

type Props = {
  /** Fecha a folha sem navegar (véu, Escape, "Cancelar", Voltar do aparelho). */
  aoFechar: () => void;
  /** Fecha a folha e só então abre o roteiro novo (`useFolhaNoHistorico`, o mesmo padrão de "abrir o roteiro reescrito"). */
  fecharENavegar: (navegar: () => void) => void;
  objetivoRecomendado: Objetivo | null;
  /** As outras marcas de que a pessoa é membro, sem a marca ativa (V9a, item 4, "Falar de"). */
  marcas: MarcaResumo[];
  /**
   * V9b, item 3: aberta a partir de um item do plano ("Escrever o roteiro"
   * no bloco "o seu plano de hoje"). Presente, "Escrever o roteiro" chama
   * `aceitarPlanoAction` em vez de `gerarRoteiroMomentoAction`, para ligar
   * o roteiro novo ao item; `valoresIniciais` pré-preenche os campos com o
   * que `planejarDia` sugeriu (a pessoa ainda pode editar antes de confirmar).
   */
  planoItemId?: number;
  valoresIniciais?: ValoresIniciaisMomento;
  /**
   * V12, itens 3d e 4a: a porta que abriu a folha já escolhe o formato (Reels
   * ou Story), contando como "tocado" (mesmo espírito de `valoresIniciais`,
   * que também já chega com o controle escolhido). Ignorado quando
   * `valoresIniciais` existe (o item do plano manda).
   */
  formatoInicial?: FormatoRoteiro;
  /** V12c, item 3, a E37b: pessoa tem "quem aparece" fixo (config/briefing.ts), o controle nem aparece. */
  tipo: TipoMarca;
  /** O `quemGrava` do briefing, para o controle já nascer marcado nele. */
  quemGravaPadrao: QuemGrava | null;
  /** Decisão pendente 5, revisão do Fable no PR #90: veio de "Criar roteiro" num dia vazio que não
   * é hoje; ignorado quando `planoItemId` existe (o dia do item do plano manda). */
  dataInicial?: string;
};

/**
 * "Gravar agora" (V9a, item 3): áudio ou texto, sem tela do Opus (regra 11
 * do CLAUDE.md, monta só com `Folha`, `AreaTexto`, `Botao`, `OpcaoObjetivo`
 * e `Chips`, as peças que o design v2 já entregou). Não existe ícone de
 * microfone no conjunto do design (lacuna registrada em `TODO.md`); usa
 * `Mic`/`Square` do `lucide-react`, como o resto do painel já faz para todo
 * ícone fora dos poucos que vêm da entrega (`HojeTela.tsx`, `RoteiroTela.tsx`).
 */
export function FolhaGravarAgora({
  aoFechar,
  fecharENavegar,
  objetivoRecomendado,
  marcas,
  planoItemId,
  valoresIniciais,
  formatoInicial,
  tipo,
  quemGravaPadrao,
  dataInicial,
}: Props) {
  const router = useRouter();
  const tratarFalha = useTratarFalha();
  const { avisarRedeOk } = useConexao();
  // V12c, item 3: pessoa tem "quem aparece" fixo; o controle nem aparece.
  const opcoesQuemAparece = dadosFixosDoBriefing(tipo).quemGrava;

  const [transcricao, setTranscricao] = useState<string | null>(null);

  const [onde, setOnde] = useState(valoresIniciais?.onde ?? "");
  const [oQueEstaAcontecendo, setOQueEstaAcontecendo] = useState(valoresIniciais?.oQueEstaAcontecendo ?? "");
  const [oQueDaParaMostrar, setOQueDaParaMostrar] = useState(valoresIniciais?.oQueDaParaMostrar ?? "");
  // E49 PR 1 (passo 18b): o formato vem ANTES da pergunta; no Reels, as cinco fichas em chips só pelo nome, a recomendada marcada; no Story, nenhuma pergunta.
  const objetivoInicial = valoresIniciais?.objetivo ?? objetivoRecomendado;
  const fichaRecomendada: Ficha | null = objetivoRecomendado ? fichaPadraoDoObjetivo(objetivoRecomendado) : null;
  const [ficha, setFicha] = useState<Ficha | null>(objetivoInicial ? fichaPadraoDoObjetivo(objetivoInicial) : null);
  // Vindo de um item do plano, o formato começa no que `planejarDia` já sugeriu; senão, o da porta que abriu a folha, ou Reels.
  const [formato, setFormato] = useState<FormatoRoteiro>(valoresIniciais?.formato ?? formatoInicial ?? "reels");
  // O Story não tem ficha: o objetivo gravado é o de falar com quem já segue.
  const objetivo: Objetivo | null = formato === "story" ? "engajamento" : ficha ? objetivoDaFicha(ficha) : null;
  /**
   * M4, item 2: o segundo controle segmentado da folha. Sem sugestão automática aqui (o momento
   * nunca busca evidência no banco, `gerarRoteiro` pula essa busca de propósito para esta origem);
   * começa em "falado" e a pessoa troca se quiser.
   */
  const [estilo, setEstilo] = useState<EstiloRoteiro>("falado");
  /** E40, item 2: "o que este vídeo precisa comunicar?", opcional, até 200 caracteres. */
  const [objetivoDoVideo, setObjetivoDoVideo] = useState(valoresIniciais?.objetivoDoVideo ?? "");
  /** V12c, item 3: nasce no padrão do cliente; a pessoa troca só para este vídeo. */
  const [quemAparece, setQuemAparece] = useState<QuemGrava | "">(quemGravaPadrao ?? "");
  /**
   * E39a: "para quando é?" só aparece vindo de "Contar o momento" (`planoItemId` ausente); vindo
   * de um item do plano o dia já é o do próprio item (dúvida 10, "cada dia já vem com a data").
   */
  const [data, setData] = useState(() => dataInicial ?? hojeISO());
  const [momentoDoDia, setMomentoDoDia] = useState<MomentoDoDia | null>(null);
  const [marcaIndice, setMarcaIndice] = useState<number | null>(() => {
    if (valoresIniciais?.marcaId == null) return marcas.length > 0 ? 0 : null;
    const indice = marcas.findIndex((marca) => marca.id === valoresIniciais.marcaId);
    return indice >= 0 ? indice + 1 : 0;
  });

  const [camposFaltando, setCamposFaltando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  /**
   * V11, item 4: "Voltar depois" fecha a folha na hora, mas `escrever()` continua rodando (o
   * servidor termina e grava o roteiro mesmo sem ninguém esperando,
   * `momento-continua-sem-espera.test.ts`); esta ref, e não um estado, porque o closure de
   * `escrever()` precisa ler o valor mais recente mesmo depois do componente sair da tela.
   */
  const saiuRef = useRef(false);

  const {
    fase: faseAudio,
    segundos,
    semMicrofone,
    erro: erroGravador,
    previa,
    previaPorReconhecimentoDoAparelho,
    avisoPreviaComoReserva,
    iniciarGravacao,
    pararGravacao,
  } = useGravadorDeAudio({
    nomeArquivo: "momento",
    async onTranscrito(texto) {
      // V9b, item 1: a rota só transcreve; separar em campos é uma chamada à parte (a mesma rota serve a agenda).
      const campos = await lerMomentoDeTextoAction(texto);
      setOnde(campos.onde);
      setOQueEstaAcontecendo(campos.oQueEstaAcontecendo);
      setOQueDaParaMostrar(campos.oQueDaParaMostrar);
      setTranscricao(texto);
    },
  });
  const erroAudio = erroGravador === "audioVazio" ? textosMomento.audioVazio : erroGravador === "falhaTranscricao" ? textosMomento.erroTranscricao : null;

  function validarCampos(): boolean {
    return onde.trim().length > 0 && oQueEstaAcontecendo.trim().length > 0 && oQueDaParaMostrar.trim().length > 0;
  }

  async function escrever() {
    if (!validarCampos() || !objetivo) {
      setCamposFaltando(true);
      return;
    }
    setCamposFaltando(false);
    setErroEnvio(null);
    setEnviando(true);
    const desdeMs = Date.now();
    try {
      const marcaId =
        marcaIndice !== null && marcaIndice > 0 ? marcas[marcaIndice - 1]?.id : undefined;
      const momentoDoDiaEscolhido = formato === "story" ? (momentoDoDia ?? undefined) : undefined;
      const resultado =
        planoItemId !== undefined
          ? await aceitarPlanoAction(planoItemId, {
              onde,
              oQueEstaAcontecendo,
              oQueDaParaMostrar,
              objetivo,
              ficha: formato === "reels" ? (ficha ?? undefined) : undefined,
              formato,
              estilo,
              marcaId,
              objetivoDoVideo: objetivoDoVideo.trim() || undefined,
              quemAparece: quemAparece || undefined,
              momentoDoDia: momentoDoDiaEscolhido,
            })
          : await gerarRoteiroMomentoAction({
              onde,
              oQueEstaAcontecendo,
              oQueDaParaMostrar,
              objetivo,
              ficha: formato === "reels" ? (ficha ?? undefined) : undefined,
              formato,
              estilo,
              marcaId,
              transcricao: transcricao ?? undefined,
              objetivoDoVideo: objetivoDoVideo.trim() || undefined,
              quemAparece: quemAparece || undefined,
              data,
              momentoDoDia: momentoDoDiaEscolhido,
            });
      // A pessoa pode ter tocado "Voltar depois" enquanto isto rodava: o roteiro já está gravado
      // (é por isso que o botão existe), mas ninguém está mais olhando esta folha para navegar.
      if (saiuRef.current) return;
      if (!resultado.ok) {
        setErroEnvio(resultado.erro);
        return;
      }
      fecharENavegar(() => router.replace(`/roteiros/${resultado.dado.id}`));
    } catch (falha) {
      if (saiuRef.current) return;
      /**
       * R1, item 0c: a geração não depende da aba continuar aberta. Uma falha que parece de rede
       * pode ser só a resposta que não voltou, não a geração que não aconteceu: confere se já
       * existe um roteiro novo desta marca criado desde que a espera começou antes de mostrar erro.
       */
      if (ehFalhaDeRede(falha)) {
        try {
          const recuperado = await roteiroRecenteDesdeAction(desdeMs);
          if (saiuRef.current) return;
          if (recuperado) {
            avisarRedeOk();
            fecharENavegar(() => router.replace(`/roteiros/${recuperado.id}`));
            return;
          }
        } catch {
          // Sem resposta nem na recuperação: segue para a frase de rede de sempre, abaixo.
        }
      }
      if (saiuRef.current) return;
      setErroEnvio(tratarFalha(falha, textosMomento.erroGerar));
    } finally {
      if (!saiuRef.current) setEnviando(false);
    }
  }

  function voltarDepois() {
    saiuRef.current = true;
    aoFechar();
  }

  const opcoesFalarDe = [textosMomento.falarDeNenhuma, ...marcas.map((marca) => marca.nome)];

  return (
    <>
      <Folha
        titulo={textosMomento.tituloFolha}
        aberto={!enviando}
        aoFechar={aoFechar}
        rodape={
          <Botao variante="primario" tamanho="lg" precisaDeRede carregando={enviando} onClick={escrever}>
            {enviando ? textosMomento.escrevendo : textosMomento.escreverRoteiro}
          </Botao>
        }
      >
        <p className={styles.instrucao}>{textosMomento.instrucaoAudio}</p>

        {semMicrofone ? (
          <p className={styles.avisoAudio}>{textosMomento.semMicrofone}</p>
        ) : (
          <>
            <GravadorDeAudio
              fase={faseAudio}
              segundos={segundos}
              onIniciar={() => void iniciarGravacao()}
              onParar={pararGravacao}
              rotuloGravar={textosMomento.botaoGravar}
              rotuloParar={textosMomento.botaoParar}
              rotuloTranscrevendo={textosMomento.transcrevendo}
              formatarGravando={textosMomento.gravando}
              previa={previa}
              previaPorReconhecimentoDoAparelho={previaPorReconhecimentoDoAparelho}
              avisoPreviaComoReserva={avisoPreviaComoReserva}
            />
            {erroAudio ? (
              <p className={styles.erro} role="alert">
                {erroAudio}
              </p>
            ) : null}
          </>
        )}

        {transcricao ? (
          <div className={styles.oQueDisse}>
            <span className={styles.oQueDisseRotulo}>{textosMomento.oQueVoceDisse}</span>
            <p className={styles.oQueDisseTexto}>{transcricao}</p>
          </div>
        ) : null}

        <div className={styles.divisor}>{textosMomento.ouEscreva}</div>

        <AreaTexto
          rotulo={textosMomento.rotuloOnde}
          value={onde}
          onChange={(evento) => setOnde(evento.target.value)}
          linhasMin={2}
        />
        <AreaTexto
          rotulo={textosMomento.rotuloOQueEstaAcontecendo}
          value={oQueEstaAcontecendo}
          onChange={(evento) => setOQueEstaAcontecendo(evento.target.value)}
          linhasMin={2}
        />
        <AreaTexto
          rotulo={textosMomento.rotuloOQueDaParaMostrar}
          value={oQueDaParaMostrar}
          onChange={(evento) => setOQueDaParaMostrar(evento.target.value)}
          linhasMin={2}
        />

        <div className={styles.grupoFormato}>
          <span className={styles.rotuloGrupo}>{textosMomento.formato}</span>
          <div role="tablist" aria-label={textosMomento.formato} className={styles.segmentado}>
            {FORMATOS_ROTEIRO_EM_ORDEM.map((opcao) => (
              <button
                key={opcao}
                type="button"
                role="tab"
                aria-selected={formato === opcao}
                className={[styles.segmentoBotao, formato === opcao ? styles.segmentoAtivo : ""]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setFormato(opcao)}
              >
                {ROTULO_FORMATO_ROTEIRO[opcao]}
              </button>
            ))}
          </div>
          <p className={styles.formatoAjuda}>{textosMomento.formatoAjuda[formato]}</p>
        </div>

        {formato === "reels" ? (
          <div className={styles.grupoObjetivo} data-fichas>
            <span className={styles.rotuloGrupo}>{textosMomento.objetivo}</span>
            <Chips
              rotuloGrupo={textosMomento.objetivo}
              opcoes={FICHAS_EM_ORDEM.map((f) => NOME_DA_FICHA[f])}
              selecionado={ficha ? FICHAS_EM_ORDEM.indexOf(ficha) : null}
              onChange={(indice) => setFicha(FICHAS_EM_ORDEM[indice])}
            />
            {fichaRecomendada ? <p className={styles.formatoAjuda}>{textosMomento.recomendado}: {NOME_DA_FICHA[fichaRecomendada]}</p> : null}
          </div>
        ) : null}

        {planoItemId === undefined ? <PerguntaParaQuando data={data} onChange={setData} /> : null}
        {formato === "story" ? <PerguntaMomentoDoDia valor={momentoDoDia} onChange={setMomentoDoDia} /> : null}

        {opcoesQuemAparece.fixoEmPropriaPessoa ? null : (
          <div className={styles.grupoFormato}>
            <span className={styles.rotuloGrupo}>{textosMomento.quemAparece}</span>
            <div role="radiogroup" aria-label={textosMomento.quemAparece} className={styles.opcoesObjetivo}>
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

        <div className={styles.grupoFormato}>
          <span className={styles.rotuloGrupo}>{textosMomento.estilo}</span>
          <div role="tablist" aria-label={textosMomento.estilo} className={styles.segmentado}>
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
                onClick={() => setEstilo(opcao)}
              >
                {ROTULO_ESTILO_ROTEIRO[opcao]}
              </button>
            ))}
          </div>
        </div>

        <CampoComFala
          rotulo={`${textosMomento.objetivoDoVideo} ${textosMomento.objetivoDoVideoOpcional}`}
          ajuda={textosMomento.objetivoDoVideoAjuda}
          value={objetivoDoVideo}
          onChange={setObjetivoDoVideo}
          placeholder={textosMomento.objetivoDoVideoPlaceholder}
          maxLength={200}
          linhasMin={2}
          nomeArquivo="objetivo-do-video"
        />

        {marcas.length > 0 ? (
          <div className={styles.grupoFalarDe}>
            <Chips
              rotuloGrupo={textosMomento.falarDe}
              rotuloVisivel={textosMomento.falarDe}
              opcoes={opcoesFalarDe}
              selecionado={marcaIndice}
              onChange={setMarcaIndice}
            />
            <p className={styles.falarDeAjuda}>{textosMomento.falarDeAjuda}</p>
          </div>
        ) : null}

        {camposFaltando ? (
          <p className={styles.erro} role="alert">
            {textosMomento.campoVazio}
          </p>
        ) : null}
        {erroEnvio ? (
          <p className={styles.erro} role="alert">
            {erroEnvio}
          </p>
        ) : null}
      </Folha>
      <TelaEscrevendo
        aberto={enviando}
        fraseDemorando={textosMomento.demorando}
        aoVoltarDepois={voltarDepois}
      />
    </>
  );
}
