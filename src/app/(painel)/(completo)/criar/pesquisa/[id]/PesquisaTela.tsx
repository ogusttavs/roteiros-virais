"use client";

import { ArrowLeft, Check, CircleAlert, ExternalLink, Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { hojeISO } from "@/lib/config";
import { ehFalhaDeRede } from "@/lib/offline";
import { enderecoDoObjetivo } from "@/lib/pesquisa-na-hora-rotas";
import { apagarRascunhoDoMomento, armazenamentoDaSessao, chaveDoRascunhoDoMomento } from "@/lib/rascunho-momento";
import type { AchadoDaTela, PesquisaDaTela } from "@/servicos/pesquisa-na-hora";
import { textosMomento } from "@/textos/momento";
import { textosPesquisa } from "@/textos/pesquisa";
import { BarraAcao } from "@/ui/componentes/BarraAcao";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { Botao } from "@/ui/componentes/Botao";
import { CampoComFala } from "@/ui/componentes/CampoComFala";
import { TelaEscrevendo } from "@/ui/componentes/TelaEscrevendo";
import { TelaPesquisando } from "@/ui/componentes/TelaPesquisando";
import { useTratarFalha } from "@/ui/ConexaoContext";

import { roteiroRecenteDesdeAction } from "../../../hoje/acoes";
import { gerarRoteiroMomentoAction } from "../../../hoje/momento/acoes";
import { confirmarPesquisaAction, lerPesquisaAction, pesquisarDeNovoAction } from "../acoes";

import styles from "./PesquisaTela.module.css";

const t = textosPesquisa.tela;
const INTERVALO_DA_LEITURA_MS = 3000;

type Passo = "dados" | "posicao";
type Decisao = "fontes" | "mudar" | "manter";

type Props = {
  inicial: PesquisaDaTela;
  /** Para onde "Voltar" e "Mudar o pedido" levam (o Tema livre com o texto, ou o Criar). */
  voltarPara: string;
  /** A marca ativa: de quem é o rascunho do momento que o roteiro escrito aqui deixa de precisar. */
  marcaAtivaId: number;
};

function marcadosDe(pesquisa: PesquisaDaTela): number[] {
  return pesquisa.achados.filter((a) => a.marcado).map((a) => a.id);
}

/** "do IBGE e do Diário Nacional": as fontes dos dados marcados, para a pergunta de posição dizer de onde vem o que ela marcou. */
function fontesDosMarcados(achados: AchadoDaTela[], marcados: number[]): string {
  const nomes = [...new Set(achados.filter((a) => marcados.includes(a.id)).map((a) => a.fonte))];
  if (nomes.length === 0) return "";
  const com = nomes.map((n) => `do ${n}`);
  return com.length === 1 ? com[0] : `${com.slice(0, -1).join(", ")} e ${com[com.length - 1]}`;
}

/**
 * `/criar/pesquisa/[id]` (E54, parte 3; `Pesquisa.dc.html`, estados `pesquisando`, `achados`, `premissa`, `premissaMantida`, `posicao`, `semAchados`, `erro`). A espera lê a pesquisa a
 * cada poucos segundos até ela terminar (ela vive na fila e no banco: "Voltar depois" não a interrompe). Os dados vêm com o trecho da própria fonte e o link; a pessoa marca o que entra
 * e responde à premissa e à posição antes do roteiro. "Escrever com estes N" guarda tudo no servidor e segue para onde a pessoa estava: o objetivo do vídeo (Tema livre) ou o roteiro do
 * momento, escrito aqui mesmo.
 */
export function PesquisaTela({ inicial, voltarPara, marcaAtivaId }: Props) {
  const router = useRouter();
  const tratarFalha = useTratarFalha();
  const [pesquisa, setPesquisa] = useState(inicial);
  const [marcados, setMarcados] = useState<number[]>(() => marcadosDe(inicial));
  const [decisao, setDecisao] = useState<Decisao>(inicial.decisao ?? "fontes");
  const [passo, setPasso] = useState<Passo>("dados");
  const [opcaoDaPosicao, setOpcaoDaPosicao] = useState<string | null>(null);
  const [textoDaPosicao, setTextoDaPosicao] = useState("");
  const [ocupado, setOcupado] = useState<"confirmar" | "novo" | "sem" | null>(null);
  const [escrevendo, setEscrevendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  /** O aviso é o teto do dia com saldo para a rápida: a tela oferece a rápida em vez de dizer que acabou. */
  const [soCabeRapida, setSoCabeRapida] = useState(false);
  const [erroEscrever, setErroEscrever] = useState<string | null>(null);
  const saiuRef = useRef(false);

  const destino = pesquisa.destino;

  // A espera: lê de novo até a pesquisa sair de "pesquisando". Uma leitura que falha (rede) só tenta na próxima.
  useEffect(() => {
    if (pesquisa.status !== "pesquisando") return;
    let cancelado = false;
    const id = setInterval(() => {
      void lerPesquisaAction(pesquisa.id)
        .then((atual) => {
          if (cancelado || !atual || atual.status === "pesquisando") return;
          setPesquisa(atual);
          setMarcados(marcadosDe(atual));
          setDecisao(atual.decisao ?? "fontes");
        })
        .catch(() => undefined);
    }, INTERVALO_DA_LEITURA_MS);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [pesquisa.id, pesquisa.status]);

  useEffect(() => {
    saiuRef.current = false;
    return () => {
      saiuRef.current = true;
    };
  }, []);

  function alternar(id: number) {
    setMarcados((atual) => (atual.includes(id) ? atual.filter((n) => n !== id) : [...atual, id]));
  }

  const posicaoEscolhida = textoDaPosicao.trim() !== "" ? textoDaPosicao.trim() : (opcaoDaPosicao ?? "");
  const precisaDePosicao = pesquisa.pergunta !== null;

  /** Escreve o roteiro do momento (com ou sem a pesquisa) aqui mesmo, com a espera da claquete; o roteiro novo abre sozinho. */
  async function escreverMomento(pesquisaId: number | undefined) {
    if (!destino || destino.tipo !== "momento") return;
    setErroEscrever(null);
    setEscrevendo(true);
    const desdeMs = Date.now();
    // A data que a pessoa escolheu pode ter passado enquanto a pesquisa esperava (pedida às 23:50, aberta depois da meia-noite): o roteiro sai para hoje, em vez de ficar preso numa pesquisa já paga.
    const dados = { ...destino.dados, pesquisaId };
    if (dados.data && dados.data < hojeISO()) delete dados.data;
    const apagarRascunho = () => apagarRascunhoDoMomento(armazenamentoDaSessao(), chaveDoRascunhoDoMomento(marcaAtivaId));
    try {
      const resultado = await gerarRoteiroMomentoAction(dados);
      if (saiuRef.current) return;
      if (!resultado.ok) {
        setErroEscrever(resultado.erro);
        return;
      }
      // O roteiro saiu: o que a pessoa tinha contado na folha cumpriu o que era (senão "Contar o momento" abriria com o texto já usado).
      apagarRascunho();
      router.replace(`/roteiros/${resultado.dado.id}`);
    } catch (falha) {
      if (saiuRef.current) return;
      // A geração não depende da aba continuar aberta: uma falha que parece de rede pode ser só a resposta que não voltou. Confere se já existe um roteiro novo antes de mostrar erro
      // (senão a pessoa toca de novo e paga um segundo roteiro), como a folha do momento faz.
      if (ehFalhaDeRede(falha)) {
        try {
          const recuperado = await roteiroRecenteDesdeAction(desdeMs);
          if (saiuRef.current) return;
          if (recuperado) {
            apagarRascunho();
            router.replace(`/roteiros/${recuperado.id}`);
            return;
          }
        } catch {
          // Sem resposta nem na recuperação: segue para a frase de sempre.
        }
      }
      if (saiuRef.current) return;
      setErroEscrever(tratarFalha(falha, t.erroEscrever));
    } finally {
      if (!saiuRef.current) setEscrevendo(false);
    }
  }

  async function confirmar() {
    if (ocupado || marcados.length === 0) return;
    setAviso(null);
    setErroEscrever(null);
    setOcupado("confirmar");
    try {
      const resultado = await confirmarPesquisaAction(pesquisa.id, {
        ids: marcados,
        decisao: pesquisa.premissa ? decisao : null,
        posicao: precisaDePosicao ? posicaoEscolhida : null,
      });
      if (saiuRef.current) return;
      if (!resultado.ok) {
        setAviso(resultado.erro);
        setOcupado(null);
        return;
      }
      const seguinte = resultado.dado.destino;
      if (seguinte?.tipo === "objetivo") {
        // O botão fica em "Abrindo" até a tela do objetivo chegar.
        router.push(enderecoDoObjetivo(seguinte, pesquisa.id));
        return;
      }
      setOcupado(null);
      if (seguinte?.tipo === "momento") {
        await escreverMomento(pesquisa.id);
        return;
      }
      router.push("/criar");
    } catch (falha) {
      if (saiuRef.current) return;
      setAviso(tratarFalha(falha, t.erroGenerico));
      setOcupado(null);
    }
  }

  /** "Escrever sem pesquisa": o caminho de sempre, sem os dados (o pedido guardado leva adiante). */
  async function escreverSemPesquisa() {
    if (ocupado) return;
    setAviso(null);
    if (destino?.tipo === "objetivo") {
      setOcupado("sem");
      router.push(enderecoDoObjetivo(destino));
      return;
    }
    if (destino?.tipo === "momento") {
      await escreverMomento(undefined);
      return;
    }
    router.push("/criar");
  }

  async function pesquisarDeNovo(tamanho?: "normal") {
    if (ocupado) return;
    setAviso(null);
    setSoCabeRapida(false);
    setOcupado("novo");
    try {
      const resultado = await pesquisarDeNovoAction(pesquisa.id, tamanho);
      if (saiuRef.current) return;
      if (!resultado.ok) {
        setAviso(resultado.erro);
        setSoCabeRapida(Boolean(resultado.soCabeRapida));
        setOcupado(null);
        return;
      }
      router.replace(`/criar/pesquisa/${resultado.dado.id}`);
    } catch (falha) {
      if (saiuRef.current) return;
      setAviso(tratarFalha(falha, t.erroGenerico));
      setOcupado(null);
    }
  }

  const pronta = pesquisa.status === "pronta";
  const comAchados = pronta && pesquisa.achados.length > 0;
  const titulo =
    pesquisa.status === "pesquisando"
      ? textosPesquisa.espera.titulo
      : pesquisa.status === "sem_achados"
        ? t.tituloSemAchados
        : pesquisa.status === "erro"
          ? t.tituloErro
          : passo === "posicao"
            ? t.tituloPosicao
            : t.titulo;

  return (
    <div className={styles.pagina}>
      <BarraTopo
        titulo={t.tituloCompacto}
        esquerda={
          <button type="button" aria-label={t.voltar} className={styles.botaoBarra} disabled={ocupado !== null} onClick={() => router.push(voltarPara)}>
            <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        }
      />

      <div className={styles.miolo}>
        <div className={styles.cabecalhoTela}>
          <span className={styles.etiqueta}>{t.etiquetaDaTela}</span>
          <h1 className={styles.titulo}>{titulo}</h1>
          {pesquisa.status === "pesquisando" ? null : <p className={styles.pedido}>{pesquisa.pedido}</p>}
          {comAchados && passo === "dados" ? <p className={styles.subtitulo}>{t.instrucao}</p> : null}
        </div>

        <div className={styles.colunaPrincipal}>
          {pesquisa.status === "sem_achados" ? (
            <section className={styles.cartao} data-estado="sem-achados">
              <p>
                {textosPesquisa.semAchados.texto} {textosPesquisa.semAchados.conta}
              </p>
              <div className={styles.duasAcoes}>
                <Botao variante="primario" tamanho="lg" disabled={ocupado !== null || escrevendo} carregando={ocupado === "sem"} onClick={() => void escreverSemPesquisa()}>
                  {textosPesquisa.semAchados.escreverSemPesquisa}
                </Botao>
                <Botao variante="secundario" tamanho="lg" disabled={ocupado !== null} onClick={() => router.push(voltarPara)}>
                  {textosPesquisa.semAchados.mudarOPedido}
                </Botao>
              </div>
            </section>
          ) : null}

          {pesquisa.status === "erro" ? (
            <section className={styles.cartao} data-estado="erro">
              <span className={styles.avisoErro}>
                <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
                {textosPesquisa.erro.texto}
              </span>
              <p>{pesquisa.motivo ?? ""}</p>
              <div className={styles.duasAcoes}>
                <Botao variante="primario" tamanho="lg" precisaDeRede disabled={ocupado !== null} carregando={ocupado === "novo"} onClick={() => void pesquisarDeNovo()}>
                  {textosPesquisa.erro.tentarDeNovo}
                </Botao>
                <Botao variante="secundario" tamanho="lg" disabled={ocupado !== null || escrevendo} onClick={() => void escreverSemPesquisa()}>
                  {textosPesquisa.erro.escreverSemPesquisa}
                </Botao>
              </div>
            </section>
          ) : null}

          {comAchados && passo === "dados" && pesquisa.premissa ? (
            <section className={[styles.cartao, styles.premissa].join(" ")} aria-labelledby="t-premissa" role="status" data-estado="premissa">
              <span className={styles.tituloPremissa} id="t-premissa">
                <CircleAlert size={20} strokeWidth={1.75} aria-hidden="true" />
                {textosPesquisa.premissa.titulo}
              </span>
              <p>{pesquisa.premissa.aviso.replace(textosPesquisa.premissa.prefixo, "")}</p>
              {pesquisa.premissa.anguloSugerido ? <p className={styles.angulo}>{pesquisa.premissa.anguloSugerido}</p> : null}
              <div className={styles.opcoes} role="radiogroup" aria-labelledby="t-premissa">
                {(
                  [
                    ["fontes", textosPesquisa.premissa.fontes],
                    ["mudar", textosPesquisa.premissa.mudar],
                    ["manter", textosPesquisa.premissa.manter],
                  ] as const
                ).map(([valor, rotulo]) => (
                  <button key={valor} type="button" role="radio" aria-checked={decisao === valor} className={styles.opcao} onClick={() => setDecisao(valor)}>
                    {decisao === valor ? <Check size={16} strokeWidth={2} aria-hidden="true" /> : null}
                    {rotulo}
                  </button>
                ))}
              </div>
              {decisao === "manter" ? (
                <p className={styles.mesmoAssim} data-estado="premissa-mantida">
                  <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span>{textosPesquisa.premissa.aviso}</span>
                </p>
              ) : null}
            </section>
          ) : null}

          {comAchados && passo === "dados" ? (
            <section className={styles.achados} aria-labelledby="t-achados" data-estado="achados">
              <div className={styles.cabecaAchados}>
                <h2 className={styles.etiqueta} id="t-achados">
                  {t.dadosEmFontes(pesquisa.achados.length, pesquisa.fontes)}
                </h2>
                <span className={styles.marcados} aria-live="polite">
                  {t.marcados(marcados.length)}
                </span>
              </div>
              <ol className={styles.lista}>
                {pesquisa.achados.map((a) => {
                  const marcado = marcados.includes(a.id);
                  return (
                    <li key={a.id} className={[styles.achado, marcado ? styles.achadoMarcado : ""].filter(Boolean).join(" ")} data-achado={a.id}>
                      <button type="button" role="checkbox" aria-checked={marcado} aria-label={`${t.usarEsteDado}: ${a.dado}`} className={styles.marcar} onClick={() => alternar(a.id)}>
                        <span className={styles.caixa}>{marcado ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : null}</span>
                      </button>
                      <div className={styles.corpoAchado}>
                        {a.outroLado || a.semNumero || a.antigo ? (
                          <div className={styles.etiquetas}>
                            {a.outroLado ? <span className={styles.etiquetaAchado}>{t.outroLado}</span> : null}
                            {a.semNumero ? <span className={styles.etiquetaAchado}>{t.semNumero}</span> : null}
                            {a.antigo ? <span className={[styles.etiquetaAchado, styles.etiquetaAntigo].join(" ")}>{t.antigo}</span> : null}
                          </div>
                        ) : null}
                        <p className={styles.dado}>{a.dado}</p>
                        <blockquote className={styles.trecho}>“{a.trecho}”</blockquote>
                        <p className={styles.fonte}>
                          <b>{a.fonte}</b>
                          <span>{t.tipo[a.tipo]}</span>
                          <span>{a.data ?? t.semData}</span>
                          {a.url ? (
                            <a href={a.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={styles.abrirFonte}>
                              <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
                              {t.abrirAFonte}
                            </a>
                          ) : null}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          {comAchados && passo === "posicao" && pesquisa.pergunta ? (
            <section className={[styles.cartao, styles.posicao].join(" ")} aria-labelledby="q-posicao" data-estado="posicao">
              <p className={styles.resumoMarcados}>{textosPesquisa.posicao.resumo(marcados.length, fontesDosMarcados(pesquisa.achados, marcados))}</p>
              <h2 className={styles.perguntaPosicao} id="q-posicao">
                {pesquisa.pergunta.pergunta}
              </h2>
              <p className={styles.porQue}>{textosPesquisa.posicao.porQue}</p>
              <div className={styles.opcoes} role="radiogroup" aria-labelledby="q-posicao">
                {pesquisa.pergunta.opcoes.map((opcao) => (
                  <button key={opcao} type="button" role="radio" aria-checked={opcaoDaPosicao === opcao} className={styles.opcao} onClick={() => setOpcaoDaPosicao(opcao)}>
                    {opcaoDaPosicao === opcao ? <Check size={16} strokeWidth={2} aria-hidden="true" /> : null}
                    {opcao}
                  </button>
                ))}
              </div>
              <CampoComFala
                rotulo={textosPesquisa.posicao.rotuloCampo}
                rotuloOculto
                value={textoDaPosicao}
                onChange={setTextoDaPosicao}
                placeholder={textosPesquisa.posicao.opcional}
                maxLength={300}
                linhasMin={2}
                nomeArquivo="pesquisa-posicao"
              />
            </section>
          ) : null}

          {aviso ? (
            <div className={styles.aviso} role="status" data-aviso-da-pesquisa>
              <Info size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>{aviso}</span>
              {soCabeRapida ? (
                <Botao variante="secundario" tamanho="md" precisaDeRede disabled={ocupado !== null} onClick={() => void pesquisarDeNovo("normal")} className={styles.avisoAcao}>
                  {t.pesquisarDeNovoNaRapida}
                </Botao>
              ) : null}
            </div>
          ) : null}
          {erroEscrever ? (
            <p className={styles.erro} role="alert">
              {erroEscrever}
            </p>
          ) : null}
        </div>

        {comAchados ? (
          <aside className={styles.lado}>
            <section className={[styles.cartao, styles.como].join(" ")} aria-labelledby="t-como">
              <h3 className={styles.etiqueta} id="t-como">
                {textosPesquisa.como.titulo}
              </h3>
              <ul>
                {textosPesquisa.como.itens.map((item) => (
                  <li key={item}>
                    <Check size={16} strokeWidth={2} aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className={styles.notaLimite}>
                {textosPesquisa.como.limite} {t.jaFezNoDia(pesquisa.usadasHoje, pesquisa.tetoPorDia)}
              </p>
            </section>
          </aside>
        ) : null}
      </div>

      {comAchados && passo === "dados" ? (
        <BarraAcao
          primaria={
            decisao === "mudar" && pesquisa.premissa
              ? { rotulo: textosPesquisa.premissa.voltarEMudar, onClick: () => router.push(voltarPara), disabled: ocupado !== null }
              : {
                  rotulo: ocupado === "confirmar" ? t.seguirParaOObjetivo : marcados.length === 0 ? t.escreverSemDado : t.escreverCom(marcados.length),
                  onClick: () => (precisaDePosicao ? setPasso("posicao") : void confirmar()),
                  disabled: marcados.length === 0 || ocupado !== null || escrevendo,
                  precisaDeRede: true,
                }
          }
          secundaria={{ rotulo: t.pesquisarDeNovo(pesquisa.profundidade === "aprofundada" ? 2 : 1), onClick: () => void pesquisarDeNovo(), disabled: ocupado !== null || escrevendo, precisaDeRede: true }}
        />
      ) : null}
      {comAchados && passo === "posicao" ? (
        <BarraAcao
          primaria={{
            rotulo: ocupado === "confirmar" ? t.seguirParaOObjetivo : t.escreverORoteiro,
            onClick: () => void confirmar(),
            disabled: posicaoEscolhida === "" || ocupado !== null || escrevendo,
            precisaDeRede: true,
          }}
          secundaria={{ rotulo: t.voltarAosDados, onClick: () => setPasso("dados"), disabled: ocupado !== null }}
        />
      ) : null}

      <TelaPesquisando aberto={pesquisa.status === "pesquisando"} pedido={pesquisa.pedido} aFundo={pesquisa.profundidade === "aprofundada"} aoVoltarDepois={() => router.push("/criar")} />
      <TelaEscrevendo aberto={escrevendo} fraseDemorando={textosMomento.demorando} aoVoltarDepois={() => router.push("/criar")} />
    </div>
  );
}
