"use client";

import {
  ArrowLeft,
  Check,
  CircleAlert,
  Copy,
  Download,
  ImagePlus,
  Pencil,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  TAMANHOS_DO_CARROSSEL,
  TETO_DA_FOTO_BYTES,
  TIPOS_COM_FOTO,
  MAXIMO_DE_FOTOS,
} from "@/config/carrossel";
import { textosCarrossel as t } from "@/textos/carrossel";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { Botao } from "@/ui/componentes/Botao";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import estilos from "./CarrosselTela.module.css";
import { FolhaTrocarFoto } from "./FolhaTrocarFoto";
import { FolhaTrocarTexto } from "./FolhaTrocarTexto";
import {
  ErroDaRota,
  pedir,
  reduzirFoto,
  type CarrosselDaTela,
  type CarrosselRecente,
  type DadosDoCarrossel,
  type PreviaDoSlide,
} from "./tipos";

type Fase = "escolher" | "gerando" | "abrindo" | "pronto" | "erro" | "limite";

type Props = {
  temasDeHoje: string[];
  corMarca: string | null;
  arroba: string;
  ramoSaude: boolean;
  /** O `?id=` do endereço: abre esse carrossel em vez da escolha. */
  idInicial: number | null;
};

const COR_INICIAL = "#0e5a6a";
/** O recado que sobrevive a recarregar a página enquanto o servidor escreve (a tela volta ao "gerando" e espera o carrossel aparecer na lista). */
const CHAVE_GERANDO = "carrossel-gerando";
const ESPERA_MAXIMA_MS = 5 * 60_000;

/** O endereço da tela com o carrossel aberto (`?id=`), sem recarregar a página; sem id, o endereço limpo. */
function marcarEndereco(id: number | null) {
  try {
    window.history.replaceState(window.history.state, "", id ? `?id=${id}` : window.location.pathname);
  } catch {
    // sem history: a tela segue funcionando
  }
}

function lerGerando(): { inicio: number; quantidade: number } | null {
  try {
    const bruto = window.sessionStorage.getItem(CHAVE_GERANDO);
    const lido = bruto ? (JSON.parse(bruto) as { inicio?: number; quantidade?: number }) : null;
    if (!lido || typeof lido.inicio !== "number" || Date.now() - lido.inicio > ESPERA_MAXIMA_MS) return null;
    return { inicio: lido.inicio, quantidade: typeof lido.quantidade === "number" ? lido.quantidade : 7 };
  } catch {
    return null;
  }
}

function guardarGerando(valor: { inicio: number; quantidade: number } | null) {
  try {
    if (valor) window.sessionStorage.setItem(CHAVE_GERANDO, JSON.stringify(valor));
    else window.sessionStorage.removeItem(CHAVE_GERANDO);
  } catch {
    // sem sessionStorage: só não reabre sozinha depois de recarregar
  }
}

/** A etapa em que a espera está: avança sozinha enquanto o servidor escreve, e a última só acaba quando tudo chega. */
function useEtapa(ativa: boolean): number {
  const [etapa, setEtapa] = useState(0);
  useEffect(() => {
    if (!ativa) return;
    setEtapa(0);
    const a = setTimeout(() => setEtapa(1), 15_000);
    const b = setTimeout(() => setEtapa(2), 35_000);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [ativa]);
  return etapa;
}

/**
 * A tela "Criar carrossel" (E65 PR 2; desenho `entregaveis/design-v2/entrega/carrossel/CriarCarrossel.dc.html`, sete estados: escolher, gerando, pronto, trocarTexto, trocarFoto, erro, limite). Fala com as rotas
 * `/api/carrossel`: criar, ler, a prévia dos slides (o mesmo render do PNG final), trocar texto, foto e cor, e baixar. O tema chega escolhido ou se escolhe aqui.
 */
export function CarrosselTela({ temasDeHoje, corMarca, arroba, ramoSaude, idInicial }: Props) {
  const router = useRouter();
  const [fase, setFase] = useState<Fase>(idInicial ? "abrindo" : "escolher");
  const [recentes, setRecentes] = useState<CarrosselRecente[]>([]);
  const [falhaAoAbrir, setFalhaAoAbrir] = useState<string | null>(null);
  const [esperandoDepoisDeRecarregar, setEsperandoDepoisDeRecarregar] = useState(false);
  const [tema, setTema] = useState<string | null>(null);
  const [temaLivre, setTemaLivre] = useState("");
  const [quantidade, setQuantidade] = useState<number>(7);
  const [fotos, setFotos] = useState<{ arquivo: File; url: string }[]>([]);
  const [avisoDeFoto, setAvisoDeFoto] = useState<string | null>(null);
  const [autorizado, setAutorizado] = useState(false);
  const [cor, setCor] = useState(corMarca ?? "");
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [dados, setDados] = useState<DadosDoCarrossel | null>(null);
  const [previas, setPrevias] = useState<Record<number, PreviaDoSlide>>({});
  const [montandoPrevia, setMontandoPrevia] = useState(false);
  const [falhaDaPrevia, setFalhaDaPrevia] = useState(false);
  const [escolhido, setEscolhido] = useState(0);
  const [folhaTexto, setFolhaTexto] = useState(false);
  const [folhaFoto, setFolhaFoto] = useState(false);
  const [copiada, setCopiada] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [erroDoBaixar, setErroDoBaixar] = useState<string | null>(null);
  const [arquivosParaCompartilhar, setArquivosParaCompartilhar] = useState<File[] | null>(null);
  const [corNova, setCorNova] = useState<string | null>(null);
  const entradaDeFoto = useRef<HTMLInputElement>(null);
  const etapa = useEtapa(fase === "gerando");

  const { fechar: fecharTexto } = useFolhaNoHistorico(folhaTexto, () => setFolhaTexto(false));
  const { fechar: fecharFoto } = useFolhaNoHistorico(folhaFoto, () => setFolhaFoto(false));

  // As fotos escolhidas viram miniaturas locais; soltar o endereço quando elas saem ou a tela fecha.
  const urlsAbertas = useRef<string[]>([]);
  useEffect(() => {
    urlsAbertas.current = fotos.map((f) => f.url);
  }, [fotos]);
  useEffect(() => () => urlsAbertas.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const temaEscolhido = tema?.trim() ? tema.trim() : null;
  const corValida = /^#[0-9a-fA-F]{6}$/.test(cor);
  const precisaDeCor = !corMarca;

  async function adicionarFotos(lista: FileList | null) {
    setAvisoDeFoto(null);
    const novas: { arquivo: File; url: string }[] = [];
    for (const original of Array.from(lista ?? [])) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(original.type)) {
        setAvisoDeFoto(t.fotoNaoValida);
        continue;
      }
      // Foto grande de celular: reduzida aqui (2160 px, JPEG 0,85) antes de o teto de 6 MB do servidor olhar.
      const arquivo = await reduzirFoto(original, TETO_DA_FOTO_BYTES);
      if (arquivo.size > TETO_DA_FOTO_BYTES) {
        setAvisoDeFoto(t.fotoGrandeDemais);
        continue;
      }
      novas.push({ arquivo, url: URL.createObjectURL(arquivo) });
    }
    setFotos((atual) => {
      const cabem = novas.slice(0, Math.max(0, MAXIMO_DE_FOTOS - atual.length));
      novas.slice(cabem.length).forEach((n) => URL.revokeObjectURL(n.url));
      return [...atual, ...cabem];
    });
  }

  function tirarFoto(indice: number) {
    setFotos((atual) => {
      URL.revokeObjectURL(atual[indice]?.url ?? "");
      return atual.filter((_, i) => i !== indice);
    });
  }

  const carregarDados = useCallback(async (id: number): Promise<DadosDoCarrossel> => {
    const novos = await pedir<DadosDoCarrossel>(`/api/carrossel/${id}`);
    setDados(novos);
    return novos;
  }, []);

  /** A prévia de todos os slides, ou só do `n` (depois de trocar um texto ou uma foto). */
  const carregarPrevias = useCallback(async (id: number, n?: number) => {
    setMontandoPrevia(true);
    setFalhaDaPrevia(false);
    try {
      const { slides } = await pedir<{ slides: PreviaDoSlide[] }>(
        `/api/carrossel/${id}/previa${n ? `?n=${n}` : ""}`,
        undefined,
        t.previaFalhou,
      );
      setPrevias((atual) => ({
        ...(n ? atual : {}),
        ...Object.fromEntries(slides.map((s) => [s.n, s])),
      }));
    } catch {
      setFalhaDaPrevia(true);
    } finally {
      setMontandoPrevia(false);
    }
  }, []);

  function mostrarFalha(e: unknown) {
    // A frase do servidor só vai para a pessoa quando é um recado para ela (pedido recusado, já tem um sendo escrito, teste no fim); uma falha de máquina vira o texto padrão da tela.
    const doServidor = e instanceof ErroDaRota && [400, 402, 403, 409].includes(e.status);
    setMensagem(doServidor ? e.message : null);
    setFase(e instanceof ErroDaRota && e.status === 402 ? "limite" : "erro");
  }

  async function criar() {
    if (!temaEscolhido) return;
    setMensagem(null);
    setAviso(null);
    setFase("gerando");
    setDados(null);
    setPrevias({});
    setArquivosParaCompartilhar(null);
    setFalhaAoAbrir(null);
    setEsperandoDepoisDeRecarregar(false);
    guardarGerando({ inicio: Date.now(), quantidade });
    try {
      const { id } = await pedir<{ id: number }>(
        "/api/carrossel",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quantidade,
            cor: corValida ? cor : undefined,
            fotos: fotos.length,
            de: temasDeHoje.includes(temaEscolhido)
              ? { origem: "tema", titulo: temaEscolhido }
              : { origem: "tema", texto: temaEscolhido },
          }),
        },
        t.erroAjuda,
      );
      // O carrossel já existe e já contou no teto: o endereço guarda o id, e recarregar a página abre este mesmo carrossel.
      marcarEndereco(id);
      guardarGerando(null);
      for (const foto of fotos) {
        const corpo = new FormData();
        corpo.append("foto", foto.arquivo);
        if (ramoSaude) corpo.append("autorizacaoDoPaciente", "true");
        try {
          const { aviso: avisoDaFoto } = await pedir<{ aviso?: string | null }>(
            `/api/carrossel/${id}/fotos`,
            { method: "POST", body: corpo },
            t.fotoNaoValida,
          );
          if (avisoDaFoto) setAviso(avisoDaFoto);
        } catch (e) {
          setAviso(e instanceof ErroDaRota ? e.message : t.fotoNaoValida);
        }
      }
      await carregarDados(id);
      setEscolhido(0);
      setFase("pronto");
      void carregarPrevias(id);
    } catch (e) {
      guardarGerando(null);
      mostrarFalha(e);
    }
  }

  /** Abre um carrossel que já existe (o `?id=` do endereço ou um da lista): lê os dados e monta as prévias. */
  const abrir = useCallback(
    async (id: number) => {
      setFalhaAoAbrir(null);
      setEsperandoDepoisDeRecarregar(false);
      setFase("abrindo");
      setPrevias({});
      setArquivosParaCompartilhar(null);
      try {
        await carregarDados(id);
        marcarEndereco(id);
        setEscolhido(0);
        setFase("pronto");
        void carregarPrevias(id);
      } catch (e) {
        marcarEndereco(null);
        setFalhaAoAbrir(e instanceof ErroDaRota && e.status === 404 ? t.naoAchouEste : t.abrirFalhou);
        setFase("escolher");
      }
    },
    [carregarDados, carregarPrevias],
  );

  const carregarRecentes = useCallback(async () => {
    try {
      const { carrosseis } = await pedir<{ carrosseis: CarrosselRecente[] }>("/api/carrossel");
      setRecentes(carrosseis.slice(0, 5));
      return carrosseis;
    } catch {
      return [];
    }
  }, []);

  // Ao abrir a tela: o carrossel do endereço, ou (se a página foi recarregada no meio da escrita) a espera por ele, ou a escolha com a lista dos recentes.
  const jaAbriu = useRef(false);
  useEffect(() => {
    if (jaAbriu.current) return;
    jaAbriu.current = true;
    if (idInicial) {
      void abrir(idInicial);
      return;
    }
    const gerando = lerGerando();
    if (gerando) {
      setQuantidade(gerando.quantidade);
      setEsperandoDepoisDeRecarregar(true);
      setFase("gerando");
      return;
    }
    void carregarRecentes();
  }, [idInicial, abrir, carregarRecentes]);

  // Recarregou a página enquanto o servidor escrevia: ele termina sozinho e o carrossel aparece na lista; a tela espera e abre.
  useEffect(() => {
    if (fase !== "gerando" || !esperandoDepoisDeRecarregar) return;
    const pergunta = setInterval(async () => {
      const gerando = lerGerando();
      if (!gerando) {
        setEsperandoDepoisDeRecarregar(false);
        setFase("escolher");
        void carregarRecentes();
        return;
      }
      const lista = await carregarRecentes();
      const achado = lista.find((c) => Date.parse(c.criadoEm) >= gerando.inicio - 5000);
      if (achado) {
        guardarGerando(null);
        void abrir(achado.id);
      }
    }, 5000);
    return () => clearInterval(pergunta);
  }, [fase, esperandoDepoisDeRecarregar, carregarRecentes, abrir]);

  const carrossel = dados?.carrossel ?? null;
  const total = carrossel?.slides.length ?? 0;
  const slideAtual = carrossel?.slides[escolhido];
  const quantosPrecisamEncurtar = useMemo(
    () => Object.values(previas).filter((p) => p.precisaEncurtar).length,
    [previas],
  );

  async function depoisDeTrocar(novo: CarrosselDaTela, n: number, folha: "texto" | "foto") {
    if (folha === "texto") fecharTexto();
    else fecharFoto();
    setArquivosParaCompartilhar(null);
    await carregarDados(novo.id);
    // Foto nova pode mudar a foto de outros slides (a distribuição segue a ordem); texto só muda o slide dele.
    await carregarPrevias(novo.id, folha === "foto" ? undefined : n);
  }

  async function trocarCor() {
    if (!carrossel || !corNova) return;
    try {
      await pedir<{ carrossel: CarrosselDaTela }>(
        `/api/carrossel/${carrossel.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cor: corNova }),
        },
        t.falhouAoSalvar,
      );
      setCorNova(null);
      setArquivosParaCompartilhar(null);
      await carregarDados(carrossel.id);
      await carregarPrevias(carrossel.id);
    } catch (e) {
      setAviso(e instanceof ErroDaRota ? e.message : t.falhouAoSalvar);
    }
  }

  async function copiarLegenda() {
    if (!carrossel) return;
    try {
      await navigator.clipboard.writeText(
        `${carrossel.legenda}\n\n${carrossel.hashtags.join(" ")}`,
      );
      setCopiada(true);
      setTimeout(() => setCopiada(false), 3000);
    } catch {
      setAviso(t.falhouAoSalvar);
    }
  }

  /** No celular, as imagens vão pelo compartilhar do aparelho (galeria); onde ele não aceita arquivos, e no computador, o zip. O compartilhar pede um toque logo antes: por isso são dois toques, um para preparar e outro para enviar. */
  const compartilhaArquivos =
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches;

  /** O zip vem por `fetch` e vira download na mesma página: se falhar, a frase de erro aparece aqui e o carrossel continua na tela (trocar a página pelo JSON do erro o perderia). */
  async function baixarZip(id: number) {
    setBaixando(true);
    try {
      const resposta = await fetch(`/api/carrossel/${id}/zip`);
      if (!resposta.ok) throw new Error("falhou");
      const endereco = URL.createObjectURL(await resposta.blob());
      const ancora = document.createElement("a");
      ancora.href = endereco;
      ancora.download = `carrossel-${id}.zip`;
      document.body.appendChild(ancora);
      ancora.click();
      ancora.remove();
      setTimeout(() => URL.revokeObjectURL(endereco), 10_000);
    } catch {
      setErroDoBaixar(t.baixarFalhou);
    } finally {
      setBaixando(false);
    }
  }

  async function baixar() {
    if (!carrossel) return;
    setErroDoBaixar(null);
    if (arquivosParaCompartilhar) {
      try {
        await navigator.share({ files: arquivosParaCompartilhar });
      } catch (e) {
        // A pessoa fechar o compartilhar não é erro; qualquer outra falha cai no zip, em vez de o botão ficar mudo.
        if (!(e instanceof DOMException && e.name === "AbortError")) await baixarZip(carrossel.id);
      }
      return;
    }
    if (compartilhaArquivos) {
      setBaixando(true);
      try {
        const arquivos: File[] = [];
        for (let n = 1; n <= total; n += 1) {
          const resposta = await fetch(`/api/carrossel/${carrossel.id}/slide/${n}`);
          if (!resposta.ok) throw new Error("falhou");
          arquivos.push(
            new File([await resposta.blob()], `slide-${String(n).padStart(2, "0")}.png`, {
              type: "image/png",
            }),
          );
        }
        if (navigator.canShare({ files: arquivos })) {
          setArquivosParaCompartilhar(arquivos);
          return;
        }
      } catch {
        setErroDoBaixar(t.baixarFalhou);
        return;
      } finally {
        setBaixando(false);
      }
    }
    await baixarZip(carrossel.id);
  }

  function fazerOutro() {
    setFase("escolher");
    setDados(null);
    setPrevias({});
    setAviso(null);
    setArquivosParaCompartilhar(null);
    marcarEndereco(null);
    void carregarRecentes();
  }

  const voltar = (
    <button
      type="button"
      className={estilos.botaoBarra}
      aria-label={t.voltar}
      onClick={() => router.push("/criar")}
    >
      <ArrowLeft size={22} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );

  return (
    <div className={estilos.pagina}>
      <BarraTopo titulo={t.tituloCompacto} esquerda={voltar} />

      {fase === "escolher" || fase === "erro" ? (
        <div className={estilos.miolo} data-fase={fase}>
          <div className={estilos.cabecalho}>
            <span className={estilos.data}>
              {fase === "erro" ? t.gerandoData(quantidade) : t.data}
            </span>
            <h1>{t.titulo}</h1>
            <p>{t.subtitulo}</p>
          </div>

          {fase === "erro" ? (
            <div className={estilos.erroCartao} role="alert">
              <p className={estilos.aviso}>
                <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
                {t.erroRotulo}
              </p>
              <h3>{t.erroTitulo}</h3>
              <p>
                {mensagem ? `${mensagem} ` : ""}
                {ramoSaude ? t.erroAjudaSaude : t.erroAjuda}
              </p>
              <Botao type="button" onClick={() => void criar()}>
                {t.tentarDeNovo}
              </Botao>
              <button
                type="button"
                className={estilos.textoBotao}
                onClick={() => router.push("/criar")}
              >
                {t.voltar}
              </button>
            </div>
          ) : null}

          {fase === "escolher" ? (
            <>
              {falhaAoAbrir ? (
                <p className={estilos.alerta} role="alert">
                  {falhaAoAbrir}
                </p>
              ) : null}
              {recentes.length > 0 ? (
                <section className={estilos.bloco} aria-labelledby="t-recentes">
                  <h2 id="t-recentes">{t.recentesTitulo}</h2>
                  <p className={estilos.ajuda}>{t.recentesAjuda}</p>
                  <ul className={estilos.recentes}>
                    {recentes.map((c) => (
                      <li key={c.id}>
                        <button type="button" className={estilos.recente} onClick={() => void abrir(c.id)}>
                          <strong>{c.tema}</strong>
                          <span>
                            {t.recenteDetalhe(
                              c.quantidade,
                              new Date(c.criadoEm).toLocaleDateString("pt-BR", { day: "numeric", month: "short" }),
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {/* O tema */}
              {temaEscolhido ? (
                <article className={`${estilos.cartao} ${estilos.recuado} ${estilos.tema}`}>
                  <span className={estilos.rotulo}>{t.temaRotulo}</span>
                  <h3>{temaEscolhido}</h3>
                  <p>{t.temaAjuda}</p>
                  <button
                    type="button"
                    className={estilos.textoBotao}
                    onClick={() => setTema(null)}
                  >
                    {t.trocarTema}
                  </button>
                </article>
              ) : (
                <section className={estilos.bloco} aria-labelledby="t-tema">
                  <h2 id="t-tema">{t.escolherTema}</h2>
                  {temasDeHoje.length > 0 ? (
                    <div className={estilos.temasDoDia} role="group" aria-label={t.temasDeHoje}>
                      {temasDeHoje.map((titulo) => (
                        <button
                          key={titulo}
                          type="button"
                          className={estilos.opcaoTema}
                          onClick={() => setTema(titulo)}
                        >
                          {titulo}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className={estilos.campoLinha}>
                    <label htmlFor="tema-livre">{t.escreverTema}</label>
                    <textarea
                      id="tema-livre"
                      value={temaLivre}
                      maxLength={300}
                      placeholder={t.placeholderTema}
                      onChange={(e) => setTemaLivre(e.target.value)}
                    />
                  </div>
                  <Botao
                    type="button"
                    variante="secundario"
                    disabled={!temaLivre.trim()}
                    onClick={() => setTema(temaLivre.trim())}
                    style={{ justifySelf: "start" }}
                  >
                    {t.usarEsteTema}
                  </Botao>
                </section>
              )}

              <section className={estilos.bloco} aria-labelledby="t-quantos">
                <h2 id="t-quantos">{t.quantos}</h2>
                <div className={estilos.segmentado} role="radiogroup" aria-labelledby="t-quantos">
                  {TAMANHOS_DO_CARROSSEL.map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={n === quantidade}
                      className={estilos.segmento}
                      onClick={() => setQuantidade(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className={estilos.ajuda}>{t.quantosAjuda}</p>
              </section>

              <section className={estilos.bloco} aria-labelledby="t-fotos">
                <h2 id="t-fotos">{t.fotosTitulo}</h2>
                <p className={estilos.ajuda}>{t.fotosAjuda}</p>
                {ramoSaude ? (
                  <div className={estilos.bloco}>
                    <h3 className={estilos.subtitulo}>{t.pacienteTitulo}</h3>
                    <p className={estilos.ajuda}>{t.pacienteAjuda}</p>
                    <label className={estilos.autorizacao}>
                      <input
                        type="checkbox"
                        checked={autorizado}
                        onChange={(e) => setAutorizado(e.target.checked)}
                      />
                      <span>
                        <strong>{t.autorizacaoPaciente}</strong>
                        <span>{t.autorizacaoPacienteAjuda}</span>
                      </span>
                    </label>
                  </div>
                ) : null}
                <div className={estilos.fotos}>
                  {fotos.map((f, i) => (
                    <div key={f.url} className={estilos.fotoMini}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.url} alt={t.fotoN(i + 1)} />
                      <button
                        type="button"
                        className={estilos.tirar}
                        aria-label={t.tirarFoto(i + 1)}
                        onClick={() => tirarFoto(i)}
                      >
                        <span>
                          <X size={16} strokeWidth={2} aria-hidden="true" />
                        </span>
                      </button>
                    </div>
                  ))}
                  {fotos.length < MAXIMO_DE_FOTOS ? (
                    <button
                      type="button"
                      className={estilos.adicionar}
                      disabled={ramoSaude && !autorizado}
                      onClick={() => entradaDeFoto.current?.click()}
                    >
                      <Plus size={22} strokeWidth={1.75} aria-hidden="true" />
                      {t.mandarFotos}
                    </button>
                  ) : null}
                </div>
                <input
                  ref={entradaDeFoto}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  className={estilos.escondido}
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => {
                    void adicionarFotos(e.target.files);
                    e.target.value = "";
                  }}
                />
                {ramoSaude && !autorizado ? (
                  <p className={estilos.miudo}>{t.autorizacaoPrecisa}</p>
                ) : null}
                {ramoSaude ? <p className={estilos.miudo}>{t.linhaFixaNoSlide}</p> : null}
                {avisoDeFoto ? (
                  <p className={estilos.erroCampo} role="alert">
                    <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
                    {avisoDeFoto}
                  </p>
                ) : null}
                <p className={estilos.linhaAviso}>
                  <ImagePlus size={16} strokeWidth={1.5} aria-hidden="true" />
                  {t.fotosAviso}
                </p>
              </section>

              <section className={estilos.bloco} aria-labelledby="t-como">
                <h2 id="t-como">{t.comoSai}</h2>
                <div className={`${estilos.cartao} ${estilos.comoSai}`}>
                  <input
                    type="color"
                    className={estilos.amostra}
                    value={corValida ? cor : COR_INICIAL}
                    aria-label={t.corDaMarca}
                    onChange={(e) => setCor(e.target.value)}
                  />
                  <div>
                    <strong>{arroba || t.semArroba}</strong>
                    <span>{precisaDeCor && !corValida ? t.corDaMarcaAjuda : t.comoSaiAjuda}</span>
                  </div>
                  <button
                    type="button"
                    className={estilos.textoBotao}
                    onClick={() => router.push("/conta")}
                  >
                    {t.mudarCorOuArroba}
                  </button>
                </div>
              </section>

              <div className={estilos.enviar}>
                <Botao
                  type="button"
                  onClick={() => void criar()}
                  disabled={
                    !temaEscolhido ||
                    (precisaDeCor && !corValida) ||
                    (ramoSaude && fotos.length > 0 && !autorizado)
                  }
                >
                  {t.criar}
                </Botao>
                <p className={estilos.miudo}>{t.criarAjuda}</p>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {fase === "abrindo" ? (
        <div className={estilos.miolo} data-fase="abrindo">
          <div className={estilos.cabecalho}>
            <h1>{t.abrindoTitulo}</h1>
            <p role="status">{t.abrindoAjuda}</p>
          </div>
        </div>
      ) : null}

      {fase === "gerando" ? (
        <div className={`${estilos.miolo} ${estilos.larga}`} data-fase="gerando">
          <div className={estilos.cabecalho}>
            <span className={estilos.data}>{t.gerandoData(quantidade)}</span>
            <h1>{t.gerandoTitulo}</h1>
            <p>{esperandoDepoisDeRecarregar ? t.aindaGerandoAjuda : t.gerandoAjuda}</p>
          </div>
          <ol className={estilos.etapas} aria-live="polite">
            {[
              t.etapaTexto(quantidade),
              ramoSaude ? t.etapaConferindoSaude : t.etapaConferindo,
              ramoSaude ? t.etapaFotosSaude : t.etapaFotos(fotos.length),
            ].map((texto, i) => (
              <li
                key={texto}
                className={`${estilos.etapa} ${i < etapa ? estilos.feita : i === etapa ? estilos.agora : ""}`}
              >
                <span className={estilos.marcaEtapa} aria-hidden={i >= etapa || undefined}>
                  {i < etapa ? <Check size={16} strokeWidth={2.5} aria-hidden="true" /> : null}
                </span>
                <span>
                  {texto}
                  {i < etapa ? <span className={estilos.escondido}>{t.feito}</span> : null}
                  {i === 1 && etapa === 1 ? (
                    <small>{ramoSaude ? t.etapaConferindoSaudeDica : t.etapaConferindoDica}</small>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
          <div className={estilos.faixa} aria-hidden="true">
            {Array.from({ length: quantidade }, (_, i) => (
              <span key={i} className={estilos.esqueleto} />
            ))}
          </div>
        </div>
      ) : null}

      {fase === "pronto" && carrossel && slideAtual ? (
        <div className={`${estilos.miolo} ${estilos.larga}`} data-fase="pronto">
          <div className={estilos.cabecalho}>
            <span className={estilos.data}>{t.prontoData(total)}</span>
            <h1>{t.prontoTitulo}</h1>
            <p>{t.prontoAjuda}</p>
          </div>

          {(carrossel.avisos ?? []).map((a) => (
            <p key={a} className={estilos.alerta}>
              {a}
            </p>
          ))}
          {aviso ? (
            <p className={estilos.alerta} role="alert">
              {aviso}
            </p>
          ) : null}
          {quantosPrecisamEncurtar > 0 ? (
            <p className={estilos.alerta} role="alert">
              {t.precisaEncurtarAviso(quantosPrecisamEncurtar)}
            </p>
          ) : null}

          <div className={estilos.faixa} role="group" aria-label={t.faixaAria(total)}>
            {carrossel.slides.map((s, i) => {
              const previa = previas[i + 1];
              return (
                <div key={i} className={estilos.miniItem}>
                  {previa ? (
                    <button
                      type="button"
                      className={estilos.mini}
                      aria-pressed={i === escolhido}
                      aria-label={t.slideAria(i + 1, total)}
                      onClick={() => setEscolhido(i)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={previa.imagem} alt="" />
                      {previa.precisaEncurtar ? (
                        <span className={estilos.marcaDeAviso}>{t.precisaEncurtarCurto}</span>
                      ) : previa.semFoto ? (
                        <span className={estilos.marcaDeAviso}>{t.precisaDeFotoCurto}</span>
                      ) : null}
                    </button>
                  ) : (
                    <span
                      className={estilos.esqueleto}
                      aria-label={montandoPrevia ? t.montandoPrevia : undefined}
                    />
                  )}
                  <span className={estilos.miniLegenda}>
                    <b>{i + 1}</b>
                    {t.nomeCurtoDoTipo[s.tipo] ?? s.tipo}
                  </span>
                </div>
              );
            })}
          </div>
          {falhaDaPrevia ? (
            <p className={estilos.alerta} role="alert">
              {t.previaFalhou}{" "}
              <button
                type="button"
                className={estilos.textoBotao}
                onClick={() => void carregarPrevias(carrossel.id)}
              >
                {t.tentarDeNovo}
              </button>
            </p>
          ) : null}

          <div className={estilos.depois}>
            <div className={estilos.escolhido}>
              <p>
                <b>{t.slideDe(escolhido + 1, total)}</b> ·{" "}
                {t.nomeDoTipo[slideAtual.tipo] ?? slideAtual.tipo}
              </p>
              {previas[escolhido + 1]?.precisaEncurtar ? (
                <p className={estilos.alerta}>{t.precisaEncurtar}</p>
              ) : null}
              {previas[escolhido + 1]?.semFoto ? (
                <p className={estilos.alerta}>{t.precisaDeFoto}</p>
              ) : null}
              {slideAtual.rodape ? <p className={estilos.ajuda}>{t.linhaFixaNaoEdita}</p> : null}
              {t.metodo.dicasDeFoto[slideAtual.tipo] && !(ramoSaude && slideAtual.tipo === "passo") ? <p className={estilos.ajuda}>{t.metodo.dicasDeFoto[slideAtual.tipo]}</p> : null}
              <div className={estilos.acoesSlide}>
                <Botao type="button" variante="secundario" onClick={() => setFolhaTexto(true)}>
                  <Pencil
                    className={estilos.icone}
                    size={18}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  {t.trocarTexto}
                </Botao>
                {TIPOS_COM_FOTO.has(slideAtual.tipo) && slideAtual.tipo !== "noticia" ? (
                  <Botao type="button" variante="secundario" onClick={() => setFolhaFoto(true)}>
                    <RefreshCw
                      className={estilos.icone}
                      size={18}
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    {dados?.fotosDosSlides[escolhido]?.foto
                      ? slideAtual.tipo === "antes-depois"
                        ? t.trocarFotos
                        : t.trocarFoto
                      : t.porFoto}
                  </Botao>
                ) : null}
              </div>
            </div>

            <section className={`${estilos.cartao} ${estilos.legenda}`} aria-labelledby="t-legenda">
              <span className={estilos.rotulo} id="t-legenda">
                {t.legendaRotulo}
              </span>
              <p className={estilos.legendaTexto}>
                {carrossel.legenda}
                {"\n\n"}
                {carrossel.hashtags.join(" ")}
              </p>
              <Botao
                type="button"
                variante="secundario"
                onClick={() => void copiarLegenda()}
                style={{ justifySelf: "start" }}
              >
                <Copy className={estilos.icone} size={18} strokeWidth={1.75} aria-hidden="true" />
                {copiada ? t.legendaCopiada : t.copiarLegenda}
              </Botao>
            </section>

            <section className={`${estilos.cartao} ${estilos.baixar}`} aria-labelledby="t-baixar">
              <span className={estilos.rotulo} id="t-baixar">
                {t.paraPostar}
              </span>
              <Botao
                type="button"
                className={estilos.botaoCheio}
                onClick={() => void baixar()}
                carregando={baixando}
                disabled={baixando}
              >
                <Download
                  className={estilos.icone}
                  size={18}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                {baixando
                  ? t.baixando
                  : arquivosParaCompartilhar
                    ? t.salvarNoCelular(total)
                    : compartilhaArquivos
                      ? t.prepararParaCelular
                      : t.baixar(total)}
              </Botao>
              <p className={estilos.miudo}>{t.baixarAjuda(total)}</p>
              {erroDoBaixar ? (
                <p className={estilos.erroCampo} role="alert">
                  <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
                  {erroDoBaixar}
                </p>
              ) : null}
              <div className={estilos.corMarca}>
                <label>
                  <input
                    type="color"
                    className={estilos.amostra}
                    value={
                      corNova ??
                      (/^#[0-9a-fA-F]{6}$/.test(carrossel.cor) ? carrossel.cor : COR_INICIAL)
                    }
                    aria-label={t.corDaMarca}
                    onChange={(e) => setCorNova(e.target.value)}
                  />
                  {t.corDaMarca}
                </label>
                {corNova ? (
                  <Botao type="button" variante="secundario" onClick={() => void trocarCor()}>
                    {t.trocarCor}
                  </Botao>
                ) : null}
              </div>
              <button type="button" className={estilos.textoBotao} onClick={fazerOutro}>
                {t.fazerOutro}
              </button>
            </section>
          </div>
        </div>
      ) : null}

      {fase === "limite" ? (
        <div className={estilos.miolo} data-fase="limite">
          <div className={estilos.cabecalho}>
            <span className={estilos.data}>{t.data}</span>
            <h1>{t.limiteTitulo}</h1>
            <p>{mensagem}</p>
          </div>
          <div className={estilos.cartao}>
            <p className={estilos.ajuda}>{t.limiteAjuda}</p>
            <Botao type="button" onClick={() => router.push("/assinar")}>
              {t.verOpcoes}
            </Botao>
            <button
              type="button"
              className={estilos.textoBotao}
              onClick={() => router.push("/criar")}
            >
              {t.agoraNao}
            </button>
          </div>
        </div>
      ) : null}

      {folhaTexto && carrossel && slideAtual ? (
        <FolhaTrocarTexto
          aoFechar={fecharTexto}
          carrosselId={carrossel.id}
          indice={escolhido}
          slide={slideAtual}
          comFoto={Boolean(dados?.slidesComFoto[escolhido])}
          ramoSaude={ramoSaude}
          aoSalvar={(novo) => void depoisDeTrocar(novo, escolhido + 1, "texto")}
        />
      ) : null}

      {folhaFoto && carrossel && slideAtual && dados ? (
        <FolhaTrocarFoto
          aoFechar={fecharFoto}
          carrosselId={carrossel.id}
          indice={escolhido}
          slide={slideAtual}
          fotos={dados.fotos}
          atual={dados.fotosDosSlides[escolhido] ?? { foto: null, fotoDepois: null }}
          ramoSaude={ramoSaude}
          aoMandar={async () => void (await carregarDados(carrossel.id))}
          aoSalvar={(novo) => void depoisDeTrocar(novo, escolhido + 1, "foto")}
        />
      ) : null}
    </div>
  );
}
