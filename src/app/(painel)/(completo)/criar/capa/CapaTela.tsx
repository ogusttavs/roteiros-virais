"use client";

import { ArrowLeft, Check, CircleAlert, Copy, Download, Pencil, Plus, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { slidesComColchete, temColchete } from "@/carrossel/colchetes";
import { CAMPOS_DO_TIPO, TETO_DA_FOTO_BYTES } from "@/config/carrossel";
import { textosCapa as t } from "@/textos/capa-noticia";
import { textosCarrossel as tc } from "@/textos/carrossel";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { Botao } from "@/ui/componentes/Botao";

import estilos from "../carrossel/CarrosselTela.module.css";
import { TextoComColchetes } from "../carrossel/TextoComColchetes";
import { ErroDaRota, pedir, type DadosDoCarrossel, type PreviaDoSlide } from "../carrossel/tipos";

type Fase = "abrindo" | "erroAoAbrir" | "titulos" | "escolher" | "montando" | "pronto" | "erro" | "limite";

type Props = {
  noticia: { id: number; titulo: string; veiculo: string; data: string };
  corMarca: string | null;
  arroba: string;
  ramoSaude: boolean;
  /** A capa pronta aberta pelo endereço (`?id=`): a tela abre direto no pronto, carregando por este id. */
  capaInicialId?: number;
};

type Titulos = { titulos: string[]; veiculo: string; data: string };

const COR_INICIAL = "#0e5a6a";
const LIMITE = CAMPOS_DO_TIPO.noticia.titulo!;
const palavras = (texto: string) => (texto.trim() === "" ? 0 : texto.trim().split(/\s+/).length);

/** A etapa em que a espera dos títulos está: avança sozinha enquanto o servidor escreve. */
function useEtapa(ativa: boolean): number {
  const [etapa, setEtapa] = useState(0);
  useEffect(() => {
    if (!ativa) return;
    setEtapa(0);
    const a = setTimeout(() => setEtapa(1), 4_000);
    const b = setTimeout(() => setEtapa(2), 14_000);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [ativa]);
  return etapa;
}

/**
 * A tela da capa de notícia (E66). O desenho não tem uma tela própria: monta com as peças da tela do carrossel (mesmas classes, mesmos estados: escolher, montando, pronto, erro, limite). Fala com
 * `/api/carrossel/capa/titulos` (os títulos), `/api/carrossel/capa` (cria a capa, um carrossel de um slide) e as rotas de sempre do carrossel (foto, prévia, baixar, trocar o título).
 */
export function CapaTela({ noticia, corMarca, arroba, ramoSaude, capaInicialId }: Props) {
  const router = useRouter();
  const [fase, setFase] = useState<Fase>(capaInicialId ? "abrindo" : "titulos");
  const [sugeridos, setSugeridos] = useState<Titulos | null>(null);
  const [falhaDosTitulos, setFalhaDosTitulos] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const [foto, setFoto] = useState<{ arquivo: File; url: string } | null>(null);
  const [avisoDeFoto, setAvisoDeFoto] = useState<string | null>(null);
  const [autorizado, setAutorizado] = useState(false);
  const [cor, setCor] = useState(corMarca ?? "");
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [dados, setDados] = useState<DadosDoCarrossel | null>(null);
  const [previa, setPrevia] = useState<PreviaDoSlide | null>(null);
  const [falhaDaPrevia, setFalhaDaPrevia] = useState(false);
  const [editando, setEditando] = useState(false);
  const [tituloNovo, setTituloNovo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [copiada, setCopiada] = useState(false);
  /** O espaço para completar (trecho entre colchetes) ainda está na legenda ou na imagem: antes de copiar ou baixar, a tela pergunta. */
  const [confirmando, setConfirmando] = useState<"copiar" | "baixar" | null>(null);
  const [baixando, setBaixando] = useState(false);
  const [arquivoParaCompartilhar, setArquivoParaCompartilhar] = useState<File | null>(null);
  const entradaDeFoto = useRef<HTMLInputElement>(null);
  const entradaDeFotoDepois = useRef<HTMLInputElement>(null);
  const jaPediu = useRef(false);
  const etapa = useEtapa(fase === "titulos");

  const corValida = /^#[0-9a-fA-F]{6}$/.test(cor);
  const precisaDeCor = !corMarca;

  // A foto escolhida vira miniatura local; solta o endereço quando sai ou a tela fecha.
  const urlAberta = useRef<string | null>(null);
  useEffect(() => {
    urlAberta.current = foto?.url ?? null;
  }, [foto]);
  useEffect(() => () => void (urlAberta.current && URL.revokeObjectURL(urlAberta.current)), []);

  async function buscarTitulos() {
    setFase("titulos");
    setFalhaDosTitulos(null);
    try {
      const novos = await pedir<Titulos>(
        "/api/carrossel/capa/titulos",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ noticiaId: noticia.id }) },
        t.semTitulosAgora,
      );
      setSugeridos(novos);
      setTitulo((atual) => (atual.trim() ? atual : (novos.titulos[0] ?? "")));
      setFase("escolher");
    } catch (e) {
      if (e instanceof ErroDaRota && e.status === 402) {
        setMensagem(e.message);
        setFase("limite");
        return;
      }
      setFalhaDosTitulos(e instanceof ErroDaRota && [400, 403, 409].includes(e.status) ? e.message : t.semTitulosAgora);
      setFase("escolher");
    }
  }

  // Os títulos vêm ao abrir a tela (uma vez só, mesmo com o React rodando o efeito duas vezes em desenvolvimento).
  useEffect(() => {
    if (jaPediu.current) return;
    jaPediu.current = true;
    if (capaInicialId) {
      void abrirCapaPronta(capaInicialId);
      return;
    }
    void buscarTitulos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** O endereço da tela guarda o id da capa pronta (recarregar a página volta para ela) e o tira quando a pessoa começa outra. */
  function guardarIdNaUrl(id: number | null) {
    const endereco = id ? `/criar/capa?noticia=${noticia.id}&id=${id}` : `/criar/capa?noticia=${noticia.id}`;
    window.history.replaceState(window.history.state, "", endereco);
  }

  async function abrirCapaPronta(id: number) {
    setFase("abrindo");
    try {
      setDados(await pedir<DadosDoCarrossel>(`/api/carrossel/${id}`, undefined, t.abrirFalhouAjuda));
      setFase("pronto");
      void carregarPrevia(id);
    } catch (e) {
      setMensagem(e instanceof ErroDaRota && [400, 402, 403, 409].includes(e.status) ? e.message : null);
      setFase(e instanceof ErroDaRota && e.status === 402 ? "limite" : "erroAoAbrir");
    }
  }

  function escolherFoto(arquivo: File | undefined) {
    setAvisoDeFoto(null);
    if (!arquivo) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(arquivo.type)) return setAvisoDeFoto(tc.fotoNaoValida);
    if (arquivo.size > TETO_DA_FOTO_BYTES) return setAvisoDeFoto(tc.fotoGrandeDemais);
    setFoto((atual) => {
      if (atual) URL.revokeObjectURL(atual.url);
      return { arquivo, url: URL.createObjectURL(arquivo) };
    });
  }

  function tirarFoto() {
    setFoto((atual) => {
      if (atual) URL.revokeObjectURL(atual.url);
      return null;
    });
  }

  async function carregarPrevia(id: number) {
    setFalhaDaPrevia(false);
    try {
      const { slides } = await pedir<{ slides: PreviaDoSlide[] }>(`/api/carrossel/${id}/previa`, undefined, t.previaFalhou);
      setPrevia(slides[0] ?? null);
    } catch {
      setFalhaDaPrevia(true);
    }
  }

  async function mandarFoto(id: number, arquivo: File): Promise<number | null> {
    const corpo = new FormData();
    corpo.append("foto", arquivo);
    if (ramoSaude) corpo.append("autorizacaoDoPaciente", "true");
    try {
      const { foto: enviada } = await pedir<{ foto: { id: number } }>(`/api/carrossel/${id}/fotos`, { method: "POST", body: corpo }, tc.fotoNaoValida);
      return enviada.id;
    } catch (e) {
      setAviso(e instanceof ErroDaRota ? e.message : tc.fotoNaoValida);
      return null;
    }
  }

  async function criar() {
    const escolhido = titulo.trim();
    if (!escolhido) return;
    setMensagem(null);
    setAviso(null);
    setFase("montando");
    setDados(null);
    setPrevia(null);
    setArquivoParaCompartilhar(null);
    try {
      const { id } = await pedir<{ id: number }>(
        "/api/carrossel/capa",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ noticiaId: noticia.id, titulo: escolhido, cor: corValida ? cor : undefined }) },
        t.erroAjuda,
      );
      if (foto) await mandarFoto(id, foto.arquivo);
      setDados(await pedir<DadosDoCarrossel>(`/api/carrossel/${id}`));
      guardarIdNaUrl(id);
      setFase("pronto");
      void carregarPrevia(id);
    } catch (e) {
      const doServidor = e instanceof ErroDaRota && [400, 402, 403, 409].includes(e.status);
      setMensagem(doServidor ? (e as ErroDaRota).message : null);
      setFase(e instanceof ErroDaRota && e.status === 402 ? "limite" : "erro");
    }
  }

  const capa = dados?.carrossel ?? null;

  async function depoisDeMudar(id: number) {
    setArquivoParaCompartilhar(null);
    setDados(await pedir<DadosDoCarrossel>(`/api/carrossel/${id}`));
    await carregarPrevia(id);
  }

  async function salvarTitulo() {
    if (!capa) return;
    setSalvando(true);
    setAviso(null);
    try {
      await pedir(
        `/api/carrossel/${capa.id}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ indice: 0, campos: { titulo: tituloNovo.trim() } }) },
        t.falhouAoSalvar,
      );
      setEditando(false);
      await depoisDeMudar(capa.id);
    } catch (e) {
      setAviso(e instanceof ErroDaRota ? e.message : t.falhouAoSalvar);
    } finally {
      setSalvando(false);
    }
  }

  async function trocarFotoDaCapa(arquivo: File | undefined) {
    if (!capa || !arquivo) return;
    setAviso(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(arquivo.type)) return setAviso(tc.fotoNaoValida);
    if (arquivo.size > TETO_DA_FOTO_BYTES) return setAviso(tc.fotoGrandeDemais);
    const fotoId = await mandarFoto(capa.id, arquivo);
    if (fotoId === null) return;
    try {
      await pedir(`/api/carrossel/${capa.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ indice: 0, fotoId }) }, t.falhouAoSalvar);
      await depoisDeMudar(capa.id);
    } catch (e) {
      setAviso(e instanceof ErroDaRota ? e.message : t.falhouAoSalvar);
    }
  }

  const imagemParaCompletar = capa ? slidesComColchete(capa.slides).length > 0 : false;
  const legendaParaCompletar = capa ? temColchete(capa.legenda) : false;

  function pedirCopiarLegenda() {
    if (legendaParaCompletar) setConfirmando("copiar");
    else void copiarLegenda();
  }

  function pedirBaixar() {
    if (imagemParaCompletar && !arquivoParaCompartilhar) setConfirmando("baixar");
    else void baixar();
  }

  async function copiarLegenda() {
    if (!capa) return;
    setConfirmando(null);
    try {
      await navigator.clipboard.writeText(capa.legenda);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 3000);
    } catch {
      setAviso(t.falhouAoSalvar);
    }
  }

  /** No celular a imagem vai pelo compartilhar do aparelho (galeria), em dois toques (preparar e enviar); no computador, ela baixa como arquivo. Sempre por fetch e blob: se falhar, a frase de erro fica na tela. */
  const compartilhaArquivos =
    typeof navigator !== "undefined" && typeof navigator.canShare === "function" && typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

  async function baixar() {
    if (!capa) return;
    setConfirmando(null);
    if (arquivoParaCompartilhar) {
      try {
        await navigator.share({ files: [arquivoParaCompartilhar] });
      } catch {
        // a pessoa fechou o compartilhar: nada a fazer
      }
      return;
    }
    setBaixando(true);
    setAviso(null);
    try {
      const resposta = await fetch(`/api/carrossel/${capa.id}/slide/1`);
      if (!resposta.ok) throw new Error("falhou");
      const blob = await resposta.blob();
      const arquivo = new File([blob], "capa-noticia.png", { type: "image/png" });
      if (compartilhaArquivos && navigator.canShare({ files: [arquivo] })) {
        setArquivoParaCompartilhar(arquivo);
      } else {
        const endereco = URL.createObjectURL(blob);
        const ancora = document.createElement("a");
        ancora.href = endereco;
        ancora.download = "capa-noticia.png";
        document.body.appendChild(ancora);
        ancora.click();
        ancora.remove();
        setTimeout(() => URL.revokeObjectURL(endereco), 10_000);
      }
    } catch {
      setAviso(t.baixarFalhou);
    } finally {
      setBaixando(false);
    }
  }

  function fazerOutra() {
    guardarIdNaUrl(null);
    if (!sugeridos) void buscarTitulos();
    else setFase("escolher");
    setDados(null);
    setPrevia(null);
    setAviso(null);
    setEditando(false);
    setArquivoParaCompartilhar(null);
  }

  const voltar = (
    <button type="button" className={estilos.botaoBarra} aria-label={t.voltar} onClick={() => router.push("/noticias")}>
      <ArrowLeft size={22} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );

  const palavrasDoTitulo = palavras(titulo);
  const passouPalavras = Math.max(0, palavrasDoTitulo - LIMITE.palavras);
  const passouCaracteres = Math.max(0, titulo.trim().length - LIMITE.caracteres);
  const tituloCabe = titulo.trim() !== "" && passouPalavras === 0 && passouCaracteres === 0;

  const caixaDeAutorizacao = ramoSaude ? (
    <div className={estilos.bloco}>
      <h3 className={estilos.subtitulo}>{tc.pacienteTitulo}</h3>
      <p className={estilos.ajuda}>{tc.pacienteAjuda}</p>
      <label className={estilos.autorizacao}>
        <input type="checkbox" checked={autorizado} onChange={(e) => setAutorizado(e.target.checked)} />
        <span>
          <strong>{tc.autorizacaoPaciente}</strong>
          <span>{tc.autorizacaoPacienteAjuda}</span>
        </span>
      </label>
    </div>
  ) : null;

  const entradasDeArquivo = (
    <>
      <input
        ref={entradaDeFoto}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className={estilos.escondido}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          escolherFoto(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={entradaDeFotoDepois}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className={estilos.escondido}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void trocarFotoDaCapa(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );

  return (
    <div className={estilos.pagina}>
      <BarraTopo titulo={t.tituloCompacto} esquerda={voltar} />

      {fase === "abrindo" ? (
        <div className={`${estilos.miolo} ${estilos.larga}`} data-fase="abrindo">
          <div className={estilos.cabecalho}>
            <span className={estilos.data}>{t.data}</span>
            <h1>{t.abrindoTitulo}</h1>
          </div>
        </div>
      ) : null}

      {fase === "erroAoAbrir" ? (
        <div className={estilos.miolo} data-fase="erroAoAbrir">
          <div className={estilos.erroCartao} role="alert">
            <p className={estilos.aviso}>
              <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
              {t.erroRotulo}
            </p>
            <h3>{t.abrirFalhouTitulo}</h3>
            <p>{mensagem ?? t.abrirFalhouAjuda}</p>
            <Botao type="button" onClick={() => void abrirCapaPronta(capaInicialId ?? 0)}>
              {t.tentarDeNovo}
            </Botao>
          </div>
        </div>
      ) : null}

      {fase === "titulos" ? (
        <div className={`${estilos.miolo} ${estilos.larga}`} data-fase="titulos">
          <div className={estilos.cabecalho}>
            <span className={estilos.data}>{t.data}</span>
            <h1>{t.buscandoTitulo}</h1>
            <p>{t.buscandoAjuda}</p>
          </div>
          <ol className={estilos.etapas} aria-live="polite">
            {[t.etapaLendo, t.etapaEscrevendo, t.etapaConferindo].map((texto, i) => (
              <li key={texto} className={`${estilos.etapa} ${i < etapa ? estilos.feita : i === etapa ? estilos.agora : ""}`}>
                <span className={estilos.marcaEtapa} aria-hidden={i >= etapa || undefined}>
                  {i < etapa ? <Check size={16} strokeWidth={2.5} aria-hidden="true" /> : null}
                </span>
                <span>{texto}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {fase === "escolher" || fase === "erro" ? (
        <div className={estilos.miolo} data-fase={fase}>
          <div className={estilos.cabecalho}>
            <span className={estilos.data}>{t.data}</span>
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
                {t.erroAjuda}
              </p>
              <Botao type="button" onClick={() => void criar()}>
                {t.tentarDeNovo}
              </Botao>
            </div>
          ) : null}

          <article className={`${estilos.cartao} ${estilos.recuado} ${estilos.tema}`}>
            <span className={estilos.rotulo}>{t.daNoticia}</span>
            <h3>{noticia.titulo}</h3>
            <p>{t.veiculoData(noticia.veiculo, noticia.data)}</p>
          </article>

          <section className={estilos.bloco} aria-labelledby="c-titulo">
            <h2 id="c-titulo">{t.escolherTitulo}</h2>
            {falhaDosTitulos ? (
              <p className={estilos.alerta} role="alert">
                {falhaDosTitulos}
              </p>
            ) : null}
            {sugeridos && sugeridos.titulos.length > 0 ? (
              <div className={estilos.temasDoDia} role="group" aria-label={t.tituloAria}>
                {sugeridos.titulos.map((s) => (
                  <button key={s} type="button" className={estilos.opcaoTema} aria-pressed={s === titulo} onClick={() => setTitulo(s)}>
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
            <div className={`${estilos.campoLinha} ${!tituloCabe && titulo.trim() ? estilos.comErro : ""}`}>
              <label htmlFor="titulo-da-capa">{t.escreverTitulo}</label>
              <textarea id="titulo-da-capa" value={titulo} aria-invalid={!tituloCabe && titulo.trim() !== ""} placeholder={t.tituloVazio} onChange={(e) => setTitulo(e.target.value)} />
              <span className={estilos.contagem}>
                {passouPalavras > 0 || passouCaracteres > 0 ? (
                  <span className={estilos.erroCampo} role="alert">
                    <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
                    {passouPalavras > 0 ? t.passouPalavras(passouPalavras) : t.passouCaracteres(passouCaracteres)}
                  </span>
                ) : (
                  <span />
                )}
                <b>{`${t.contagemPalavras(palavrasDoTitulo)} · ${t.contagemCaracteres(titulo.trim().length)}`}</b>
              </span>
              <p className={estilos.ajuda}>{t.escreverTituloAjuda}</p>
            </div>
            <Botao type="button" variante="secundario" onClick={() => void buscarTitulos()} style={{ justifySelf: "start" }}>
              <RefreshCw className={estilos.icone} size={18} strokeWidth={1.75} aria-hidden="true" />
              {t.novosTitulos}
            </Botao>
          </section>

          <section className={estilos.bloco} aria-labelledby="c-foto">
            <h2 id="c-foto">{t.fotoTitulo}</h2>
            <p className={estilos.ajuda}>{t.fotoAjuda}</p>
            {caixaDeAutorizacao}
            <div className={estilos.fotos}>
              {foto ? (
                <div className={estilos.fotoMini}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={foto.url} alt={t.fotoDaCapa} />
                  <button type="button" className={estilos.tirar} aria-label={t.tirarFoto} onClick={tirarFoto}>
                    <span>
                      <X size={16} strokeWidth={2} aria-hidden="true" />
                    </span>
                  </button>
                </div>
              ) : (
                <button type="button" className={estilos.adicionar} disabled={ramoSaude && !autorizado} onClick={() => entradaDeFoto.current?.click()}>
                  <Plus size={22} strokeWidth={1.75} aria-hidden="true" />
                  {t.mandarFoto}
                </button>
              )}
            </div>
            {entradasDeArquivo}
            {ramoSaude && !autorizado ? <p className={estilos.miudo}>{tc.autorizacaoPrecisa}</p> : null}
            {avisoDeFoto ? (
              <p className={estilos.erroCampo} role="alert">
                <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
                {avisoDeFoto}
              </p>
            ) : null}
            <p className={estilos.miudo}>{foto ? t.fotoSoUma : t.fotoSemFoto}</p>
          </section>

          <section className={estilos.bloco} aria-labelledby="c-como">
            <h2 id="c-como">{tc.comoSai}</h2>
            <div className={`${estilos.cartao} ${estilos.comoSai}`}>
              <input type="color" className={estilos.amostra} value={corValida ? cor : COR_INICIAL} aria-label={tc.corDaMarca} onChange={(e) => setCor(e.target.value)} />
              <div>
                <strong>{arroba || tc.semArroba}</strong>
                <span>{precisaDeCor && !corValida ? tc.corDaMarcaAjuda : tc.comoSaiAjuda}</span>
              </div>
              <button type="button" className={estilos.textoBotao} onClick={() => router.push("/conta")}>
                {tc.mudarCorOuArroba}
              </button>
            </div>
          </section>

          <div className={estilos.enviar}>
            <Botao type="button" onClick={() => void criar()} disabled={!tituloCabe || (precisaDeCor && !corValida) || (ramoSaude && Boolean(foto) && !autorizado)}>
              {t.criar}
            </Botao>
            <p className={estilos.miudo}>{t.criarAjuda}</p>
          </div>
        </div>
      ) : null}

      {fase === "montando" ? (
        <div className={`${estilos.miolo} ${estilos.larga}`} data-fase="montando">
          <div className={estilos.cabecalho}>
            <span className={estilos.data}>{t.data}</span>
            <h1>{t.montandoTitulo}</h1>
            <p>{t.montandoAjuda}</p>
          </div>
          <ol className={estilos.etapas} aria-live="polite">
            {[t.etapaMontando, t.etapaFoto(Boolean(foto))].map((texto, i) => (
              <li key={texto} className={`${estilos.etapa} ${i === 0 ? estilos.agora : ""}`}>
                <span className={estilos.marcaEtapa} aria-hidden="true" />
                <span>{texto}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {fase === "pronto" && capa ? (
        <div className={`${estilos.miolo} ${estilos.larga}`} data-fase="pronto">
          <div className={estilos.cabecalho}>
            <span className={estilos.data}>{t.prontoData}</span>
            <h1>{t.prontoTitulo}</h1>
            <p>{t.prontoAjuda}</p>
          </div>
          {(capa.avisos ?? []).map((a) => (
            <p key={a} className={estilos.alerta}>
              {a}
            </p>
          ))}
          {aviso ? (
            <p className={estilos.alerta} role="alert">
              {aviso}
            </p>
          ) : null}
          {imagemParaCompletar ? (
            <p className={estilos.avisoColchete} role="alert" data-testid="aviso-colchetes">
              <b>{t.completarImagem}</b>
              <span>
                {slidesComColchete(capa.slides).flatMap((x) => x.trechos).map((trecho, k) => (
                  <mark key={k} className={estilos.colchete}>
                    {trecho}
                  </mark>
                ))}
              </span>
            </p>
          ) : null}

          <div className={estilos.faixa} role="group" aria-label={t.capaAria}>
            <div className={estilos.miniItem}>
              {previa ? (
                <span className={estilos.mini} aria-label={t.capaAria}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previa.imagem} alt={t.capaAria} />
                  {previa.precisaEncurtar ? <span className={estilos.marcaDeAviso}>{tc.precisaEncurtarCurto}</span> : null}
                </span>
              ) : (
                <span className={estilos.esqueleto} aria-label={tc.montandoPrevia} />
              )}
            </div>
          </div>
          {previa?.precisaEncurtar ? <p className={estilos.alerta}>{tc.precisaEncurtar}</p> : null}
          {falhaDaPrevia ? (
            <p className={estilos.alerta} role="alert">
              {t.previaFalhou}{" "}
              <button type="button" className={estilos.textoBotao} onClick={() => void carregarPrevia(capa.id)}>
                {t.tentarDeNovo}
              </button>
            </p>
          ) : null}

          <div className={estilos.depois}>
            <div className={estilos.escolhido}>
              {editando ? (
                <div className={estilos.campoLinha}>
                  <label htmlFor="titulo-novo">{t.escreverTitulo}</label>
                  <textarea id="titulo-novo" value={tituloNovo} onChange={(e) => setTituloNovo(e.target.value)} />
                  <span className={estilos.contagem}>
                    <span />
                    <b>{`${t.contagemPalavras(palavras(tituloNovo))} · ${t.contagemCaracteres(tituloNovo.trim().length)}`}</b>
                  </span>
                  <div className={estilos.acoesSlide}>
                    <Botao
                      type="button"
                      onClick={() => void salvarTitulo()}
                      carregando={salvando}
                      disabled={salvando || palavras(tituloNovo) === 0 || palavras(tituloNovo) > LIMITE.palavras || tituloNovo.trim().length > LIMITE.caracteres}
                    >
                      {salvando ? t.salvando : t.salvarTitulo}
                    </Botao>
                    <Botao type="button" variante="secundario" onClick={() => setEditando(false)}>
                      {tc.cancelar}
                    </Botao>
                  </div>
                </div>
              ) : (
                <div className={estilos.acoesSlide}>
                  <Botao
                    type="button"
                    variante="secundario"
                    onClick={() => {
                      setTituloNovo(capa.slides[0]?.titulo ?? "");
                      setEditando(true);
                    }}
                  >
                    <Pencil className={estilos.icone} size={18} strokeWidth={1.75} aria-hidden="true" />
                    {t.mudarTitulo}
                  </Botao>
                  <Botao type="button" variante="secundario" disabled={ramoSaude && !autorizado} onClick={() => entradaDeFotoDepois.current?.click()}>
                    <RefreshCw className={estilos.icone} size={18} strokeWidth={1.75} aria-hidden="true" />
                    {dados?.fotosDosSlides[0]?.foto ? t.trocarFoto : t.porFoto}
                  </Botao>
                </div>
              )}
              {caixaDeAutorizacao}
              {entradasDeArquivo}
            </div>

            <section className={`${estilos.cartao} ${estilos.legenda}`} aria-labelledby="c-legenda">
              <span className={estilos.rotulo} id="c-legenda">
                {t.legendaRotulo}
              </span>
              {legendaParaCompletar ? (
                <p className={estilos.avisoColchete} role="note" data-testid="colchetes-da-legenda">
                  <b>{t.completarLegenda}</b>
                </p>
              ) : null}
              <p className={estilos.legendaTexto}>
                <TextoComColchetes texto={capa.legenda} />
              </p>
              <p className={estilos.miudo}>{t.legendaAjuda}</p>
              <Botao type="button" variante="secundario" onClick={pedirCopiarLegenda} style={{ justifySelf: "start" }}>
                <Copy className={estilos.icone} size={18} strokeWidth={1.75} aria-hidden="true" />
                {copiada ? t.legendaCopiada : t.copiarLegenda}
              </Botao>
              {confirmando === "copiar" ? (
                <div className={estilos.confirmaColchete} role="alertdialog" aria-label={t.confirmarCopiar} data-testid="confirma-copiar">
                  <b>{t.confirmarCopiar}</b>
                  <div className={estilos.acoesSlide}>
                    <Botao type="button" onClick={() => void copiarLegenda()}>
                      {t.copiarAssimMesmo}
                    </Botao>
                    <Botao type="button" variante="secundario" onClick={() => setConfirmando(null)}>
                      {t.voltarECompletar}
                    </Botao>
                  </div>
                </div>
              ) : null}
            </section>

            <section className={`${estilos.cartao} ${estilos.baixar}`} aria-labelledby="c-baixar">
              <span className={estilos.rotulo} id="c-baixar">
                {tc.paraPostar}
              </span>
              <Botao type="button" className={estilos.botaoCheio} onClick={pedirBaixar} carregando={baixando} disabled={baixando}>
                <Download className={estilos.icone} size={18} strokeWidth={1.75} aria-hidden="true" />
                {baixando ? t.baixando : arquivoParaCompartilhar ? t.salvarNoCelular : compartilhaArquivos ? t.prepararParaCelular : t.baixar}
              </Botao>
              <p className={estilos.miudo}>{t.baixarAjuda}</p>
              {confirmando === "baixar" ? (
                <div className={estilos.confirmaColchete} role="alertdialog" aria-label={t.confirmarBaixar} data-testid="confirma-baixar">
                  <b>{t.confirmarBaixar}</b>
                  <div className={estilos.acoesSlide}>
                    <Botao type="button" onClick={() => void baixar()}>
                      {t.baixarAssimMesmo}
                    </Botao>
                    <Botao type="button" variante="secundario" onClick={() => setConfirmando(null)}>
                      {t.voltarECompletar}
                    </Botao>
                  </div>
                </div>
              ) : null}
              <button type="button" className={estilos.textoBotao} onClick={fazerOutra}>
                {t.fazerOutra}
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
            <button type="button" className={estilos.textoBotao} onClick={() => router.push("/noticias")}>
              {t.agoraNao}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
