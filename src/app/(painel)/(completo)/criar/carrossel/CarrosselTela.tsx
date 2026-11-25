"use client";

import { useState } from "react";

import { TAMANHOS_DO_CARROSSEL } from "@/config/carrossel";
import { textosCarrossel as t } from "@/textos/carrossel";

import estilos from "./CarrosselTela.module.css";

type Slide = { tipo: string; titulo: string; corpo: string; fonte: string | null };
type Carrossel = { id: number; slides: Slide[]; legenda: string; hashtags: string[] };

async function lerErro(resposta: Response): Promise<string> {
  try {
    const dados = (await resposta.json()) as { erro?: string };
    return dados.erro ?? t.falhou;
  } catch {
    return t.falhou;
  }
}

/** A página provisória do carrossel (E65 PR 1): escolher, enviar fotos, gerar, ver os slides, copiar a legenda e baixar. */
export function CarrosselTela({ temasDeHoje }: { temasDeHoje: string[] }) {
  const [tema, setTema] = useState("");
  const [quantidade, setQuantidade] = useState<number>(7);
  const [fotos, setFotos] = useState<File[]>([]);
  const [cor, setCor] = useState("");
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carrossel, setCarrossel] = useState<Carrossel | null>(null);

  async function carregar(id: number) {
    const resposta = await fetch(`/api/carrossel/${id}`);
    if (!resposta.ok) throw new Error(await lerErro(resposta));
    const dados = (await resposta.json()) as { carrossel: Carrossel };
    setCarrossel(dados.carrossel);
  }

  async function enviarFotos(id: number, arquivos: File[]) {
    for (const arquivo of arquivos.slice(0, 9)) {
      const corpo = new FormData();
      corpo.append("foto", arquivo);
      const resposta = await fetch(`/api/carrossel/${id}/fotos`, { method: "POST", body: corpo });
      if (!resposta.ok) throw new Error(await lerErro(resposta));
    }
  }

  async function gerar() {
    if (!tema.trim()) {
      setErro(t.semTema);
      return;
    }
    setErro(null);
    setGerando(true);
    try {
      const resposta = await fetch("/api/carrossel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantidade,
          cor: cor || undefined,
          de: temasDeHoje.includes(tema) ? { origem: "tema", titulo: tema } : { origem: "tema", texto: tema },
        }),
      });
      if (!resposta.ok) throw new Error(await lerErro(resposta));
      const { id } = (await resposta.json()) as { id: number };
      if (fotos.length > 0) await enviarFotos(id, fotos);
      await carregar(id);
    } catch (e) {
      setErro(e instanceof Error ? e.message : t.falhou);
    } finally {
      setGerando(false);
    }
  }

  return (
    <main className={estilos.pagina}>
      <h1>{t.titulo}</h1>
      <p className={estilos.ajuda}>{t.subtitulo}</p>

      {!carrossel && (
        <section className={estilos.formulario}>
          <h2>{t.passoTema}</h2>
          {temasDeHoje.length > 0 && (
            <div className={estilos.temas} role="group" aria-label={t.temasDeHoje}>
              {temasDeHoje.map((titulo) => (
                <button key={titulo} type="button" className={titulo === tema ? estilos.temaAtivo : estilos.tema} onClick={() => setTema(titulo)}>
                  {titulo}
                </button>
              ))}
            </div>
          )}
          <label className={estilos.rotulo}>
            {t.ouEscreva}
            <textarea value={tema} onChange={(e) => setTema(e.target.value)} placeholder={t.placeholderTema} rows={3} maxLength={300} />
          </label>

          <h2>{t.passoQuantidade}</h2>
          <div className={estilos.temas} role="radiogroup" aria-label={t.passoQuantidade}>
            {TAMANHOS_DO_CARROSSEL.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={n === quantidade} className={n === quantidade ? estilos.temaAtivo : estilos.tema} onClick={() => setQuantidade(n)}>
                {t.quantidade(n)}
              </button>
            ))}
          </div>

          <h2>{t.passoFotos}</h2>
          <p className={estilos.ajuda}>{t.ajudaFotos}</p>
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setFotos(Array.from(e.target.files ?? []).slice(0, 9))} aria-label={t.passoFotos} />

          <h2>{t.passoCor}</h2>
          <input type="color" value={cor || "#1f6feb"} onChange={(e) => setCor(e.target.value)} aria-label={t.passoCor} />

          {erro && <p role="alert" className={estilos.erro}>{erro}</p>}
          <button type="button" className={estilos.principal} onClick={gerar} disabled={gerando}>
            {gerando ? t.gerando : t.gerar}
          </button>
        </section>
      )}

      {carrossel && <Resultado carrossel={carrossel} aoAtualizar={setCarrossel} aoRecarregar={() => carregar(carrossel.id)} />}
    </main>
  );
}

function Resultado({ carrossel, aoAtualizar, aoRecarregar }: { carrossel: Carrossel; aoAtualizar: (c: Carrossel) => void; aoRecarregar: () => Promise<void> }) {
  const [copiada, setCopiada] = useState(false);
  async function enviarMais(arquivos: File[]) {
    for (const arquivo of arquivos.slice(0, 9)) {
      const corpo = new FormData();
      corpo.append("foto", arquivo);
      await fetch(`/api/carrossel/${carrossel.id}/fotos`, { method: "POST", body: corpo });
    }
    await aoRecarregar();
  }
  return (
    <section>
      <h2>{t.seusSlides}</h2>
      <a className={estilos.principal} href={`/api/carrossel/${carrossel.id}/zip`}>{t.baixarTodos}</a>
      <label className={estilos.rotulo}>
        {t.enviarFotos}
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => void enviarMais(Array.from(e.target.files ?? []))} />
      </label>
      <ol className={estilos.lista}>
        {carrossel.slides.map((slide, i) => (
          <CartaoDoSlide key={`${carrossel.id}-${i}`} id={carrossel.id} indice={i} total={carrossel.slides.length} slide={slide} aoSalvar={aoAtualizar} />
        ))}
      </ol>
      <h2>{t.legenda}</h2>
      <p className={estilos.legenda}>{carrossel.legenda}</p>
      <p className={estilos.ajuda}>{carrossel.hashtags.join(" ")}</p>
      <button
        type="button"
        className={estilos.tema}
        onClick={() => {
          void navigator.clipboard.writeText(`${carrossel.legenda}\n\n${carrossel.hashtags.join(" ")}`).then(() => setCopiada(true));
        }}
      >
        {copiada ? t.copiada : t.copiarLegenda}
      </button>
    </section>
  );
}

function CartaoDoSlide({ id, indice, total, slide, aoSalvar }: { id: number; indice: number; total: number; slide: Slide; aoSalvar: (c: Carrossel) => void }) {
  const [titulo, setTitulo] = useState(slide.titulo);
  const [corpo, setCorpo] = useState(slide.corpo);
  const [salvo, setSalvo] = useState(false);
  const [imagem, setImagem] = useState<"nada" | "carregando" | "pronta" | "falhou">("nada");
  const [versao, setVersao] = useState(0);

  async function salvar() {
    const resposta = await fetch(`/api/carrossel/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ indice, titulo, corpo }) });
    if (resposta.ok) {
      const dados = (await resposta.json()) as { carrossel: Carrossel };
      aoSalvar({ ...dados.carrossel });
      setSalvo(true);
      setImagem("nada");
      setVersao((v) => v + 1);
    }
  }

  return (
    <li className={estilos.cartao}>
      <strong>
        {t.slide(indice + 1, total)} · {t.tipos[slide.tipo] ?? slide.tipo}
      </strong>
      <label className={estilos.rotulo}>
        {t.titulo_}
        <input value={titulo} onChange={(e) => { setTitulo(e.target.value); setSalvo(false); }} />
      </label>
      <label className={estilos.rotulo}>
        {t.texto}
        <textarea value={corpo} rows={3} onChange={(e) => { setCorpo(e.target.value); setSalvo(false); }} />
      </label>
      {slide.fonte && <small className={estilos.ajuda}>{slide.fonte}</small>}
      <div className={estilos.acoes}>
        <button type="button" className={estilos.tema} onClick={() => void salvar()}>{salvo ? t.salvo : t.salvar}</button>
        <button type="button" className={estilos.tema} onClick={() => setImagem("carregando")}>{t.verImagem}</button>
        <a className={estilos.tema} href={`/api/carrossel/${id}/slide/${indice + 1}`}>{t.baixarSlide}</a>
      </div>
      {imagem !== "nada" && (
        <>
          {imagem === "carregando" && <p className={estilos.ajuda}>{t.carregandoImagem}</p>}
          {imagem === "falhou" && <p className={estilos.erro}>{t.imagemFalhou}</p>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={estilos.imagem}
            src={`/api/carrossel/${id}/slide/${indice + 1}?v=${versao}`}
            alt={`${t.slide(indice + 1, total)}`}
            onLoad={() => setImagem("pronta")}
            onError={() => setImagem("falhou")}
            hidden={imagem !== "pronta"}
          />
        </>
      )}
    </li>
  );
}
