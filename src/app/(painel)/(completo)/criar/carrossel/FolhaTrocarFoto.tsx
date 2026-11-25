"use client";

import { CircleAlert, Plus } from "lucide-react";
import { useRef, useState } from "react";

import {
  SEM_FOTO,
  TETO_DA_FOTO_BYTES,
  TIPOS_COM_FOTO_DE_PACIENTE,
  type SlideDoCarrossel,
} from "@/config/carrossel";
import { textosCarrossel as t } from "@/textos/carrossel";
import { Botao } from "@/ui/componentes/Botao";
import { Folha } from "@/ui/componentes/Folha";

import estilos from "./CarrosselTela.module.css";
import { ErroDaRota, pedir, reduzirFoto, type CarrosselDaTela, type FotoDaTela } from "./tipos";

type Props = {
  aoFechar: () => void;
  carrosselId: number;
  indice: number;
  slide: SlideDoCarrossel;
  fotos: FotoDaTela[];
  /** A foto que o slide usa agora (a que ele aponta ou a que a ordem lhe deu). */
  atual: { foto: number | null; fotoDepois: number | null };
  ramoSaude: boolean;
  /** Mandou uma foto nova: a tela recarrega a lista. */
  aoMandar: () => Promise<void>;
  aoSalvar: (carrossel: CarrosselDaTela) => void;
};

/**
 * A folha "Trocar a foto do slide N": as fotos que a pessoa mandou (a do slide marcada), mandar outra, usar a escolhida ou deixar o slide sem foto (só onde a foto é opcional). No antes e depois há duas
 * fotos, uma para cada lado. Em marca de saúde, mandar ou pôr foto exige marcar a autorização do paciente.
 */
export function FolhaTrocarFoto({
  aoFechar,
  carrosselId,
  indice,
  slide,
  fotos,
  atual,
  ramoSaude,
  aoMandar,
  aoSalvar,
}: Props) {
  const ehPar = slide.tipo === "antes-depois";
  const [lado, setLado] = useState<"antes" | "depois">("antes");
  const [escolhidas, setEscolhidas] = useState<{ antes: number | null; depois: number | null }>({
    antes: atual.foto,
    depois: atual.fotoDepois,
  });
  const [autorizado, setAutorizado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const [avisoDaFoto, setAvisoDaFoto] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const doPaciente = ramoSaude && TIPOS_COM_FOTO_DE_PACIENTE.has(slide.tipo);
  const precisaMarcar = ramoSaude && !autorizado;
  const escolhidaAgora = escolhidas[ehPar ? lado : "antes"];
  const podeFicarSemFoto = slide.tipo === "passo" || slide.tipo === "antes-depois";

  async function mandar(original: File) {
    setFalha(null);
    setOcupado(true);
    try {
      // Foto grande de celular: reduzida aqui (2160 px, JPEG 0,85) antes de o teto de 6 MB do servidor olhar.
      const arquivo = await reduzirFoto(original, TETO_DA_FOTO_BYTES);
      if (arquivo.size > TETO_DA_FOTO_BYTES) {
        setFalha(t.fotoGrandeDemais);
        return;
      }
      const corpo = new FormData();
      corpo.append("foto", arquivo);
      if (ramoSaude) corpo.append("autorizacaoDoPaciente", "true");
      const { foto, aviso } = await pedir<{ foto: { id: number }; aviso?: string | null }>(
        `/api/carrossel/${carrosselId}/fotos`,
        { method: "POST", body: corpo },
        t.fotoNaoValida,
      );
      setAvisoDaFoto(aviso ?? null);
      await aoMandar();
      setEscolhidas((a) => ({ ...a, [ehPar ? lado : "antes"]: foto.id }));
    } catch (e) {
      setFalha(e instanceof ErroDaRota ? e.message : t.fotoNaoValida);
    } finally {
      setOcupado(false);
    }
  }

  async function gravar(fotoId: number) {
    setOcupado(true);
    setFalha(null);
    try {
      const { carrossel } = await pedir<{ carrossel: CarrosselDaTela }>(
        `/api/carrossel/${carrosselId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            indice,
            [ehPar && lado === "depois" ? "fotoDepoisId" : "fotoId"]: fotoId,
            autorizacaoDoPaciente: autorizado,
          }),
        },
        t.falhouAoSalvar,
      );
      aoSalvar(carrossel);
    } catch (e) {
      setFalha(e instanceof ErroDaRota ? e.message : t.falhouAoSalvar);
      setOcupado(false);
    }
  }

  const atualDoLado = ehPar ? (lado === "antes" ? atual.foto : atual.fotoDepois) : atual.foto;

  return (
    <Folha
      titulo={t.trocarFotoTitulo(indice + 1)}
      aberto
      aoFechar={aoFechar}
      rodape={
        <div className={estilos.folhaPe}>
          <Botao
            type="button"
            onClick={() => escolhidaAgora && void gravar(escolhidaAgora)}
            disabled={ocupado || !escolhidaAgora || (doPaciente && precisaMarcar)}
          >
            {t.usarEstaFoto}
          </Botao>
          {podeFicarSemFoto ? (
            <button
              type="button"
              className={estilos.textoBotao}
              style={{ justifySelf: "center", marginLeft: 0 }}
              disabled={ocupado}
              onClick={() => void gravar(SEM_FOTO)}
            >
              {t.deixarSemFoto}
            </button>
          ) : null}
        </div>
      }
    >
      <div className={estilos.folhaCorpo}>
        <p>{t.trocarFotoAjuda}</p>
        {t.metodo.dicasDeFoto[slide.tipo] ? <p>{t.metodo.dicasDeFoto[slide.tipo]}</p> : null}
        {avisoDaFoto ? <p role="status">{avisoDaFoto}</p> : null}
        {ehPar ? (
          <div className={estilos.ladoDoPar} role="radiogroup" aria-label={t.trocarFoto}>
            {(["antes", "depois"] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={lado === l}
                className={estilos.segmento}
                onClick={() => setLado(l)}
              >
                {l === "antes" ? t.fotoDoAntes : t.fotoDoDepois}
              </button>
            ))}
          </div>
        ) : null}
        {fotos.length === 0 ? <p>{t.semFotosAinda}</p> : null}
        <div className={estilos.escolherFoto}>
          {fotos.map((f, i) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={escolhidaAgora === f.id}
              aria-label={t.fotoAria(i + 1, atualDoLado === f.id)}
              onClick={() => setEscolhidas((a) => ({ ...a, [ehPar ? lado : "antes"]: f.id }))}
            >
              <span className={estilos.fotoMini}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/carrossel/${carrosselId}/fotos/${f.id}`} alt="" />
              </span>
              {atualDoLado === f.id ? <span className={estilos.neste}>{t.nesteSlide}</span> : null}
            </button>
          ))}
        </div>
        {ramoSaude ? (
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
        ) : null}
        <input
          ref={entrada}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className={estilos.escondido}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            e.target.value = "";
            if (arquivo) void mandar(arquivo);
          }}
        />
        <Botao
          type="button"
          variante="secundario"
          onClick={() => entrada.current?.click()}
          disabled={ocupado || precisaMarcar}
          style={{ justifySelf: "start" }}
        >
          <Plus className={estilos.icone} size={18} strokeWidth={1.75} aria-hidden="true" />
          {t.mandarOutraFoto}
        </Botao>
        {precisaMarcar ? <p className={estilos.miudo}>{t.autorizacaoPrecisa}</p> : null}
        {falha ? (
          <p className={estilos.erroCampo} role="alert">
            <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
            {falha}
          </p>
        ) : null}
      </div>
    </Folha>
  );
}
