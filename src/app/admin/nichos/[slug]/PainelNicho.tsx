"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { Nicho, ResumoPesquisaSetor } from "@/db/schema";
import type { ContaSemente, ExecucaoResumo, PassoSetor, ResumoLeituraPlataforma } from "@/servicos/admin-coleta";
import { textosAdmin } from "@/textos/admin";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";

import {
  aceitarTermoSugeridoAction,
  adicionarContasSementeAction,
  alternarAtivoNichoAction,
  atualizarNichoAction,
  coletarAgoraAction,
  pesquisarMercadoAction,
  tirarContaAction,
} from "../acoes";

import styles from "./PainelNicho.module.css";

const t = textosAdmin.nichoDetalhe;

type Mensagem = { tipo: "erro" | "sucesso"; texto: string };

type Props = {
  nicho: Nicho;
  /** Um por job de coleta, na ordem YouTube, Apify, noticias (decisao 4 do PROXIMO.md). */
  jobsColeta: { nome: string; execucao: ExecucaoResumo | null }[];
  /** Um por plataforma, sempre as tres (V2a, item 5: a conferencia enxerga). */
  resumoLeitura: ResumoLeituraPlataforma[];
  /** M2, item 3: as contas semente (curadoria e pesquisa), para mostrar de onde vieram e "tirar" uma. */
  contasSemente: ContaSemente[];
  /** M2, item 6: a rodada mais recente do pesquisa-de-setor, para o resumo e os termos/hashtags sugeridos. */
  ultimaPesquisa: { criadoEm: Date; resumo: ResumoPesquisaSetor } | null;
  /** M2, item 4: em que passo o setor está (pesquisando contas, coletando, lendo, pronto). */
  passo: PassoSetor;
};

function formatarQuando(data: Date | undefined): string {
  if (!data) return t.semExecucao;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(data);
}

const ROTULO_PASSO: Record<PassoSetor, string> = {
  pesquisando_contas: t.passoPesquisandoContas,
  coletando: t.passoColetando,
  lendo: t.passoLendo,
  pronto: t.passoPronto,
};

export function PainelNicho({ nicho, jobsColeta, resumoLeitura, contasSemente, ultimaPesquisa, passo }: Props) {
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

  const [pesquisando, setPesquisando] = useState(false);
  const [mensagemPesquisa, setMensagemPesquisa] = useState<Mensagem | null>(null);

  const [tirandoId, setTirandoId] = useState<number | null>(null);
  const [aceitandoTermo, setAceitandoTermo] = useState<string | null>(null);

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

  async function pesquisarMercado() {
    setPesquisando(true);
    setMensagemPesquisa(null);
    const resultado = await pesquisarMercadoAction(nicho.id);
    setPesquisando(false);
    setMensagemPesquisa({ tipo: resultado.ok ? "sucesso" : "erro", texto: resultado.ok ? t.sucessoPesquisar : (resultado.mensagem ?? "") });
    router.refresh();
  }

  async function tirarContaSemente(contaId: number) {
    setTirandoId(contaId);
    await tirarContaAction(contaId, nicho.slug);
    setTirandoId(null);
    router.refresh();
  }

  async function aceitarTermo(termo: string) {
    setAceitandoTermo(termo);
    await aceitarTermoSugeridoAction(nicho.id, nicho.slug, termo);
    setAceitandoTermo(null);
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
          {nicho.ativo ? t.ativo : t.inativo}, {ROTULO_PASSO[passo]}
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
        <h2>{t.pesquisarMercadoTitulo}</h2>
        <p className={styles.ajuda}>{t.pesquisarMercadoAjuda}</p>
        <div className={styles.botoes}>
          <Botao variante="secundario" carregando={pesquisando} onClick={pesquisarMercado}>
            {pesquisando ? t.pesquisando : t.pesquisarMercado}
          </Botao>
        </div>
        {mensagemPesquisa ? (
          <p
            className={[
              styles.mensagem,
              mensagemPesquisa.tipo === "erro" ? styles.mensagemErro : styles.mensagemSucesso,
            ].join(" ")}
            role="status"
          >
            {mensagemPesquisa.texto}
          </p>
        ) : null}

        {ultimaPesquisa ? (
          <div className={styles.resumoPesquisa}>
            <p className={styles.ajuda}>
              {t.ultimaPesquisaEm(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(ultimaPesquisa.criadoEm))}
            </p>
            <ul className={styles.execucoesLista}>
              <li>
                {t.resumoPesquisaConfirmadas(
                  ultimaPesquisa.resumo.confirmadas.youtube +
                    ultimaPesquisa.resumo.confirmadas.tiktok +
                    ultimaPesquisa.resumo.confirmadas.instagram,
                  ultimaPesquisa.resumo.sugeridas.youtube + ultimaPesquisa.resumo.sugeridas.tiktok + ultimaPesquisa.resumo.sugeridas.instagram,
                )}
              </li>
              <li>{t.resumoPesquisaContas(ultimaPesquisa.resumo.contasNovas, ultimaPesquisa.resumo.contasAtualizadas)}</li>
            </ul>

            {ultimaPesquisa.resumo.termosSugeridos.length > 0 || ultimaPesquisa.resumo.hashtagsSugeridas.length > 0 ? (
              <div>
                <p className={styles.ajuda}>{t.termosSugeridosAjuda}</p>
                <ul className={styles.termosSugeridosLista}>
                  {[...ultimaPesquisa.resumo.termosSugeridos, ...ultimaPesquisa.resumo.hashtagsSugeridas]
                    .filter((termo) => !nicho.termos.includes(termo))
                    .map((termo) => (
                      <li key={termo}>
                        <Botao
                          variante="secundario"
                          carregando={aceitandoTermo === termo}
                          onClick={() => aceitarTermo(termo)}
                        >
                          {termo}, {t.aceitarTermo}
                        </Botao>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <hr className={styles.divisor} />

      <div>
        <h2>{t.contasSementeAtuaisTitulo}</h2>
        {contasSemente.length === 0 ? (
          <p className={styles.ajuda}>{t.vazioContasSemente}</p>
        ) : (
          <ul className={styles.execucoesLista}>
            {contasSemente.map((conta) => (
              <li key={conta.id} className={styles.linhaContaSemente}>
                <span>
                  {conta.plataforma} · {conta.nome ?? conta.handle} ·{" "}
                  {conta.origem === "pesquisa" ? t.origemPesquisa : t.origemCuradoria}
                </span>
                <Botao
                  variante="secundario"
                  carregando={tirandoId === conta.id}
                  onClick={() => tirarContaSemente(conta.id)}
                >
                  {t.tirarConta}
                </Botao>
              </li>
            ))}
          </ul>
        )}
      </div>

      <hr className={styles.divisor} />

      <div>
        <h2>{t.coletarAgoraTitulo}</h2>
        <ul className={styles.execucoesLista}>
          {jobsColeta.map((job) => (
            <li key={job.nome}>{t.ultimaExecucaoJob(job.nome, formatarQuando(job.execucao?.iniciadoEm))}</li>
          ))}
          {resumoLeitura.map((linha) => (
            <li key={linha.plataforma}>
              {t.resumoLeitura(
                linha.plataforma,
                linha.transcritosHoje,
                linha.transcritosHojeBrasileiros,
                linha.analisadosHoje,
                linha.transcritosUltimos7Dias,
                linha.analisadosUltimos7Dias,
              )}
            </li>
          ))}
        </ul>
        <p className={styles.ajuda}>{t.coletarAgoraAjuda}</p>
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
