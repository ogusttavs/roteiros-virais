"use client";

import { ArrowDown, ArrowUp, Check, CircleAlert, ExternalLink, ImagePlus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { LIMITES_DO_POST_PRONTO } from "@/config/post-pronto";
import { problemaDaLegenda } from "@/lib/legenda-do-instagram";
import { ehFalhaDeRede } from "@/lib/offline";
import type { VistaDoPost } from "@/servicos/post-pronto";
import { fraseDeRecusaDoPost, textosPostPronto } from "@/textos/post-pronto";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { Botao } from "@/ui/componentes/Botao";
import { Cartao } from "@/ui/componentes/Cartao";
import { useTratarFalha } from "@/ui/ConexaoContext";

import { cancelarPostAction, repetirPostAction } from "./acoes";
import styles from "./PublicarPostPronto.module.css";

const t = textosPostPronto.tela;
const ATUALIZA_A_CADA_MS = 20_000;

type Escolhida = { chave: string; arquivo: File; previa: string };
type Props = {
  situacao: { pode: true; conta: string } | { pode: false; frase: string; levaAConta: boolean };
  posts: VistaDoPost[];
  verComo: boolean;
  textoVerComo: string;
};

/**
 * "Publicar post pronto" (E56 PR 2): escolher de 1 a 10 imagens na ordem, colar a legenda, ver a prévia e publicar agora ou pôr na fila; e a lista da fila com o estado de cada post. Mesmas peças e tokens
 * da folha de publicar do E56 PR 1 (área de texto, botão, cartão, barra de erro e de sucesso). As imagens saem do navegador para o aplicativo em um formulário só (`POST /api/posts-prontos`).
 */
export function PublicarPostPronto({ situacao, posts, verComo, textoVerComo }: Props) {
  const tratarFalha = useTratarFalha();
  const roteador = useRouter();
  const idArquivos = useId();
  const [escolhidas, setEscolhidas] = useState<Escolhida[]>([]);
  const [legenda, setLegenda] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mexendo, setMexendo] = useState<number | null>(null);

  // A fila anda sozinha no servidor: enquanto houver post esperando ou saindo, a tela se atualiza.
  const haMovimento = posts.some((p) => p.estado === "na_fila" || p.estado === "publicando");
  useEffect(() => {
    if (!haMovimento) return;
    const intervalo = setInterval(() => roteador.refresh(), ATUALIZA_A_CADA_MS);
    return () => clearInterval(intervalo);
  }, [haMovimento, roteador]);

  useEffect(() => () => escolhidas.forEach((e) => URL.revokeObjectURL(e.previa)), [escolhidas]);

  function escolher(lista: FileList | null) {
    setErro(null);
    setAviso(null);
    if (!lista || lista.length === 0) return;
    const novas = [...lista].map((arquivo) => ({ chave: `${arquivo.name}-${arquivo.size}-${Math.random().toString(36).slice(2)}`, arquivo, previa: URL.createObjectURL(arquivo) }));
    const juntas = [...escolhidas, ...novas];
    if (juntas.length > LIMITES_DO_POST_PRONTO.imagensMax) {
      novas.forEach((n) => URL.revokeObjectURL(n.previa));
      setErro(fraseDeRecusaDoPost("imagens-demais"));
      return;
    }
    if (novas.some((n) => !/^image\/(jpeg|png)$/.test(n.arquivo.type) && !/\.(jpe?g|png)$/i.test(n.arquivo.name))) {
      novas.forEach((n) => URL.revokeObjectURL(n.previa));
      setErro(fraseDeRecusaDoPost("imagem-tipo"));
      return;
    }
    setEscolhidas(juntas);
  }

  function tirar(i: number) {
    URL.revokeObjectURL(escolhidas[i].previa);
    setEscolhidas(escolhidas.filter((_, j) => j !== i));
  }

  function mover(i: number, delta: -1 | 1) {
    const j = i + delta;
    if (j < 0 || j >= escolhidas.length) return;
    const copia = [...escolhidas];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    setEscolhidas(copia);
  }

  async function enviar(modo: "agora" | "fila") {
    if (enviando) return;
    if (escolhidas.length === 0) {
      setErro(fraseDeRecusaDoPost("sem-imagem"));
      return;
    }
    const problema = problemaDaLegenda(legenda);
    if (problema) {
      setErro(fraseDeRecusaDoPost(problema));
      return;
    }
    setErro(null);
    setAviso(null);
    setEnviando(true);
    try {
      const form = new FormData();
      for (const e of escolhidas) form.append("imagens", e.arquivo, e.arquivo.name);
      form.append("legenda", legenda);
      form.append("modo", modo);
      const resposta = await fetch("/api/posts-prontos", { method: "POST", body: form });
      if (!resposta.ok) {
        let frase = t.erroGenerico;
        try {
          const corpo = (await resposta.json()) as { erro?: unknown };
          if (typeof corpo.erro === "string" && corpo.erro) frase = corpo.erro;
        } catch {
          // A resposta não era a nossa: fica a frase geral.
        }
        setErro(frase);
        return;
      }
      setEscolhidas([]);
      setLegenda("");
      setAviso(modo === "agora" ? t.foiAgora : t.foi);
      roteador.refresh();
    } catch (falha) {
      setErro(ehFalhaDeRede(falha) ? t.semConexao : tratarFalha(falha, t.erroGenerico, t.semConexao));
    } finally {
      setEnviando(false);
    }
  }

  async function mexer(id: number, acao: (id: number) => ReturnType<typeof cancelarPostAction>) {
    if (mexendo !== null) return;
    setMexendo(id);
    setErro(null);
    try {
      const resultado = await acao(id);
      if (!resultado.ok) setErro(resultado.erro);
      else roteador.refresh();
    } catch (falha) {
      setErro(tratarFalha(falha, t.erroGenerico, t.semConexao));
    } finally {
      setMexendo(null);
    }
  }

  const contador = t.contador([...legenda].length);
  const podeMontar = situacao.pode && !verComo;
  return (
    <div className={styles.pagina}>
      <Link href="/conta" className={styles.voltar}>
        {t.voltar}
      </Link>
      <h1 className={styles.titulo}>{t.titulo}</h1>

      {verComo ? <p className={styles.explica}>{textoVerComo}</p> : null}
      {!situacao.pode ? (
        <section className={styles.corpo} data-parte="sem-condicao">
          <p className={styles.explica}>{situacao.frase}</p>
          {situacao.levaAConta ? (
            <Link href="/conta" className={styles.link}>
              {t.irParaConta}
            </Link>
          ) : null}
        </section>
      ) : null}

      {podeMontar && situacao.pode ? (
        <Cartao className={styles.cartao}>
          <section className={styles.corpo} data-parte="formulario">
            <p className={styles.explica}>{t.sai(situacao.conta)}</p>
            <div className={styles.arquivo}>
              <span className={styles.rotulo}>{t.imagensRotulo}</span>
              <span className={styles.nota}>{t.imagensAjuda}</span>
              <input id={idArquivos} className={styles.inputArquivo} type="file" multiple accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={(e) => { escolher(e.target.files); e.target.value = ""; }} />
              <label htmlFor={idArquivos} className={styles.botaoArquivo}>
                <ImagePlus size={18} strokeWidth={1.75} aria-hidden="true" />
                {escolhidas.length > 0 ? t.maisImagens : t.escolher}
              </label>
            </div>

            <div className={styles.previa} data-parte="previa">
              <span className={styles.rotulo}>{t.previa}</span>
              {escolhidas.length === 0 ? (
                <p className={styles.nota}>{t.previaVazia}</p>
              ) : (
                <>
                  <p className={styles.nota}>{escolhidas.length === 1 ? t.ehPost : t.ehCarrossel(escolhidas.length)}</p>
                  <ol className={styles.miniaturas}>
                    {escolhidas.map((e, i) => (
                      <li key={e.chave} className={styles.miniatura}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- prévia local (blob:) do arquivo que a pessoa acabou de escolher */}
                        <img src={e.previa} alt={t.imagemN(i + 1)} className={styles.imagem} />
                        <span className={styles.numero}>{i + 1}</span>
                        <div className={styles.controles}>
                          <button type="button" className={styles.controle} onClick={() => mover(i, -1)} disabled={i === 0} aria-label={t.subir(i + 1)}>
                            <ArrowUp size={16} strokeWidth={1.75} aria-hidden="true" />
                          </button>
                          <button type="button" className={styles.controle} onClick={() => mover(i, 1)} disabled={i === escolhidas.length - 1} aria-label={t.descer(i + 1)}>
                            <ArrowDown size={16} strokeWidth={1.75} aria-hidden="true" />
                          </button>
                          <button type="button" className={styles.controle} onClick={() => tirar(i)} aria-label={t.tirar(i + 1)}>
                            <X size={16} strokeWidth={1.75} aria-hidden="true" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>

            <AreaTexto
              rotulo={t.legenda}
              ajuda={t.legendaAjuda}
              value={legenda}
              onChange={(evento) => {
                setLegenda(evento.target.value);
                setErro(null);
              }}
              contador={contador}
              linhasMin={5}
              maxLength={2200 * 2}
            />

            {erro ? (
              <p className={styles.erro} role="alert">
                <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
                {erro}
              </p>
            ) : null}
            {aviso ? (
              <p className={styles.sucesso} role="status">
                <Check size={20} strokeWidth={1.75} aria-hidden="true" />
                {aviso}
              </p>
            ) : null}
            {enviando ? <p className={styles.explica} role="status">{t.enviando}</p> : null}

            <div className={styles.botoes}>
              <Botao type="button" precisaDeRede carregando={enviando} disabled={escolhidas.length === 0} onClick={() => void enviar("agora")}>
                {t.publicarAgora}
              </Botao>
              <Botao type="button" variante="secundario" precisaDeRede disabled={escolhidas.length === 0 || enviando} onClick={() => void enviar("fila")}>
                {t.poeNaFila}
              </Botao>
            </div>
            <p className={styles.nota}>{t.avisoFinal}</p>
          </section>
        </Cartao>
      ) : null}

      <section className={styles.corpo} data-parte="fila">
        <h2 className={styles.subtitulo}>{t.filaTitulo}</h2>
        {posts.length === 0 ? (
          <p className={styles.nota}>{t.filaVazia}</p>
        ) : (
          <ul className={styles.fila}>
            {posts.map((p) => (
              <li key={p.id} className={styles.post} data-estado={p.estado}>
                <div className={styles.postTopo}>
                  <span className={styles.estado} data-estado={p.estado}>
                    {t.estado[p.estado]}
                  </span>
                  <span className={styles.nota}>{t.quantas(p.imagens)}</span>
                </div>
                <p className={styles.legendaDoPost}>{p.legenda ? p.legenda.slice(0, 140) + (p.legenda.length > 140 ? "..." : "") : t.legendaVazia}</p>
                {p.aviso ? <p className={styles.nota}>{p.aviso}</p> : null}
                {p.motivo ? (
                  <p className={styles.erro} role="alert">
                    <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
                    {p.motivo}
                  </p>
                ) : null}
                {p.estado === "publicado" ? (
                  p.permalink ? (
                    <a href={p.permalink} target="_blank" rel="noreferrer" className={styles.link}>
                      <ExternalLink size={18} strokeWidth={1.75} aria-hidden="true" />
                      {t.verNoInstagram}
                    </a>
                  ) : (
                    <p className={styles.nota}>{t.publicadoSemLink}</p>
                  )
                ) : null}
                {podeMontar && p.podeCancelar ? (
                  <Botao type="button" variante="ghost" precisaDeRede disabled={mexendo !== null} onClick={() => void mexer(p.id, cancelarPostAction)}>
                    {t.cancelar}
                  </Botao>
                ) : null}
                {podeMontar && p.podeRepetir ? (
                  <Botao type="button" variante="secundario" precisaDeRede disabled={mexendo !== null} onClick={() => void mexer(p.id, repetirPostAction)}>
                    {t.tentarDeNovo}
                  </Botao>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
