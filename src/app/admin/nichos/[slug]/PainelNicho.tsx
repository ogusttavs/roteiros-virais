"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { Nicho } from "@/db/schema";
import type { ExecucaoResumo } from "@/servicos/admin-coleta";
import { textosAdmin } from "@/textos/admin";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";

import { adicionarContasSementeAction, alternarAtivoNichoAction, atualizarNichoAction, coletarAgoraAction } from "../acoes";

import styles from "./PainelNicho.module.css";

const t = textosAdmin.nichoDetalhe;

type Mensagem = { tipo: "erro" | "sucesso"; texto: string };

type Props = {
  nicho: Nicho;
  /** Um por job de coleta, na ordem YouTube, Apify, noticias (decisao 4 do PROXIMO.md). */
  jobsColeta: { nome: string; execucao: ExecucaoResumo | null }[];
};

function formatarQuando(data: Date | undefined): string {
  if (!data) return t.semExecucao;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(data);
}

export function PainelNicho({ nicho, jobsColeta }: Props) {
  const router = useRouter();

  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(nicho.nome);
  const [descricao, setDescricao] = useState(nicho.descricao ?? "");
  const [termosBruto, setTermosBruto] = useState(nicho.termos.join("\n"));
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  const [alternandoAtivo, setAlternandoAtivo] = useState(false);

  const [contasUrls, setContasUrls] = useState("");
  const [adicionandoContas, setAdicionandoContas] = useState(false);
  const [mensagemContas, setMensagemContas] = useState<Mensagem | null>(null);

  const [coletando, setColetando] = useState(false);
  const [mensagemColeta, setMensagemColeta] = useState<Mensagem | null>(null);

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    setSalvando(true);
    setErroSalvar(null);
    const resultado = await atualizarNichoAction(nicho.id, { nome, descricao, termosBruto });
    setSalvando(false);
    if (!resultado.ok) {
      setErroSalvar(resultado.mensagem ?? "");
      return;
    }
    setEditando(false);
    router.refresh();
  }

  async function alternarAtivo() {
    setAlternandoAtivo(true);
    await alternarAtivoNichoAction(nicho.id, !nicho.ativo);
    setAlternandoAtivo(false);
    router.refresh();
  }

  async function adicionarContas(evento: FormEvent) {
    evento.preventDefault();
    setAdicionandoContas(true);
    setMensagemContas(null);
    const resultado = await adicionarContasSementeAction(nicho.id, nicho.slug, contasUrls);
    setAdicionandoContas(false);
    if (!resultado.ok) {
      setMensagemContas({ tipo: "erro", texto: resultado.mensagem ?? "" });
      return;
    }
    setMensagemContas({ tipo: "sucesso", texto: t.sucessoContas(resultado.quantidade ?? 0) });
    setContasUrls("");
    router.refresh();
  }

  async function coletarAgora() {
    setColetando(true);
    setMensagemColeta(null);
    const resultado = await coletarAgoraAction(nicho.id);
    setColetando(false);

    const comErro = resultado.detalhes.filter((d) => !d.ok);
    const duplicados = resultado.detalhes.filter((d) => d.duplicado).map((d) => d.job);

    if (comErro.length > 0) {
      setMensagemColeta({ tipo: "erro", texto: t.erroColetar(comErro.map((d) => d.mensagem).join("; ")) });
    } else if (duplicados.length === resultado.detalhes.length) {
      setMensagemColeta({ tipo: "erro", texto: t.duplicadoColetar(duplicados) });
    } else {
      setMensagemColeta({ tipo: "sucesso", texto: t.sucessoColetar });
    }
    router.refresh();
  }

  return (
    <div className={styles.painel}>
      <div className={styles.linhaTitulo}>
        <h2>{t.configuracaoTitulo}</h2>
        <span className={styles.estado}>
          <span
            className={[styles.ponto, nicho.ativo ? styles.pontoPositivo : styles.pontoErro].join(" ")}
            aria-hidden="true"
          />
          {nicho.ativo ? t.ativo : t.inativo}
        </span>
      </div>

      {editando ? (
        <form className={styles.forma} onSubmit={salvar}>
          <Campo rotulo={t.campoNome} required value={nome} onChange={(e) => setNome(e.target.value)} />
          <Campo rotulo={t.campoDescricao} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          <AreaTexto
            rotulo={t.campoTermos}
            ajuda={t.ajudaTermos}
            required
            linhasMin={6}
            value={termosBruto}
            onChange={(e) => setTermosBruto(e.target.value)}
          />
          {erroSalvar ? (
            <p className={[styles.mensagem, styles.mensagemErro].join(" ")} role="alert">
              {erroSalvar}
            </p>
          ) : null}
          <div className={styles.botoes}>
            <Botao type="submit" carregando={salvando}>
              {salvando ? t.salvando : t.salvar}
            </Botao>
            <Botao type="button" variante="secundario" onClick={() => setEditando(false)} disabled={salvando}>
              {t.cancelar}
            </Botao>
          </div>
        </form>
      ) : (
        <>
          {nicho.descricao ? <p className={styles.descricao}>{nicho.descricao}</p> : null}
          <ul className={styles.termosLista}>
            {nicho.termos.map((termo) => (
              <li key={termo} className={styles.termo}>
                {termo}
              </li>
            ))}
          </ul>
          <div className={styles.botoes}>
            <Botao variante="secundario" onClick={() => setEditando(true)}>
              {t.editar}
            </Botao>
            <Botao
              variante={nicho.ativo ? "perigo" : "secundario"}
              carregando={alternandoAtivo}
              onClick={alternarAtivo}
            >
              {nicho.ativo ? t.desativar : t.ativar}
            </Botao>
          </div>
        </>
      )}

      <hr className={styles.divisor} />

      <div>
        <h2>{t.contasSementeTitulo}</h2>
        <form className={styles.forma} onSubmit={adicionarContas}>
          <AreaTexto
            rotulo={t.campoContasSemente}
            ajuda={t.contasSementeAjuda}
            required
            linhasMin={4}
            value={contasUrls}
            onChange={(e) => setContasUrls(e.target.value)}
          />
          {mensagemContas ? (
            <p
              className={[
                styles.mensagem,
                mensagemContas.tipo === "erro" ? styles.mensagemErro : styles.mensagemSucesso,
              ].join(" ")}
              role="status"
            >
              {mensagemContas.texto}
            </p>
          ) : null}
          <div className={styles.botoes}>
            <Botao type="submit" variante="secundario" carregando={adicionandoContas}>
              {adicionandoContas ? t.adicionandoContas : t.botaoAdicionarContas}
            </Botao>
          </div>
        </form>
      </div>

      <hr className={styles.divisor} />

      <div>
        <h2>{t.coletarAgoraTitulo}</h2>
        <ul className={styles.execucoesLista}>
          {jobsColeta.map((job) => (
            <li key={job.nome}>{t.ultimaExecucaoJob(job.nome, formatarQuando(job.execucao?.iniciadoEm))}</li>
          ))}
        </ul>
        <div className={styles.botoes}>
          <Botao variante="secundario" carregando={coletando} onClick={coletarAgora}>
            {coletando ? t.coletando : t.coletarAgora}
          </Botao>
        </div>
        {mensagemColeta ? (
          <p
            className={[
              styles.mensagem,
              mensagemColeta.tipo === "erro" ? styles.mensagemErro : styles.mensagemSucesso,
            ].join(" ")}
            role="status"
          >
            {mensagemColeta.texto}
          </p>
        ) : null}
      </div>
    </div>
  );
}
