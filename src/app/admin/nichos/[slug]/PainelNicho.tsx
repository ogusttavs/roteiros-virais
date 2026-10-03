"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { Nicho, ResumoPesquisaSetor } from "@/db/schema";
import type { ContaSemente, ExecucaoResumo, PassoSetor, ResumoLeituraPlataforma } from "@/servicos/admin-coleta";
import type { PerfilAnalisado } from "@/servicos/perfis-analisados";
import { textosAdmin } from "@/textos/admin";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";

import {
  aceitarTermoSugeridoAction,
  adicionarContasSementeAction,
  alternarAtivoNichoAction,
  atualizarNichoAction,
  atualizarReguaAction,
  coletarAgoraAction,
  pesquisarMercadoAction,
  preverEfeitoReguaAction,
  tirarContaAction,
  virarContaDoSetorAction,
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
  /** M3: o padrão de `config.regras`, para a tela mostrar ao lado de cada campo da régua (o número, não só "padrão"). */
  padraoPisoViews: number;
  padraoProporcaoBrasil: number;
  /** E38, parte 3: perfis que um cliente citou ou da própria marca, já conferidos na API e dentro da régua do setor. */
  perfisIndicados: (PerfilAnalisado & { clienteNome: string })[];
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

export function PainelNicho({
  nicho,
  jobsColeta,
  resumoLeitura,
  contasSemente,
  ultimaPesquisa,
  passo,
  padraoPisoViews,
  padraoProporcaoBrasil,
  perfisIndicados,
}: Props) {
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
  const [virandoId, setVirandoId] = useState<number | null>(null);
  const [mensagemVirar, setMensagemVirar] = useState<Mensagem | null>(null);

  /** M3: a régua por setor. Percentual em texto (0 a 100) porque é assim que a pessoa digita; vira fração só ao salvar. */
  const [pisoViewsInput, setPisoViewsInput] = useState(nicho.pisoViews === null ? "" : String(nicho.pisoViews));
  const [proporcaoBrasilInput, setProporcaoBrasilInput] = useState(
    nicho.proporcaoBrasil === null ? "" : String(Math.round(Number(nicho.proporcaoBrasil) * 100)),
  );
  const [videoSemFalaVale, setVideoSemFalaVale] = useState(nicho.videoSemFalaVale ?? false);
  const [salvandoRegua, setSalvandoRegua] = useState(false);
  const [mensagemRegua, setMensagemRegua] = useState<Mensagem | null>(null);
  const [efeito, setEfeito] = useState<{ acima7Dias: number; acima30Dias: number; elegiveis7Dias: number; elegiveis30Dias: number } | null>(null);
  const [calculandoEfeito, setCalculandoEfeito] = useState(false);
  const efeitoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const pisoViews = pisoViewsInput.trim() === "" ? padraoPisoViews : Number(pisoViewsInput);
    if (!Number.isFinite(pisoViews) || pisoViews < 0) {
      setEfeito(null);
      return;
    }
    if (efeitoTimerRef.current) clearTimeout(efeitoTimerRef.current);
    setCalculandoEfeito(true);
    efeitoTimerRef.current = setTimeout(() => {
      preverEfeitoReguaAction(nicho.id, pisoViews)
        .then(setEfeito)
        .finally(() => setCalculandoEfeito(false));
    }, 500);
    return () => {
      if (efeitoTimerRef.current) clearTimeout(efeitoTimerRef.current);
    };
  }, [pisoViewsInput, nicho.id, padraoPisoViews]);

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

  async function virarContaDoSetor(perfilAnalisadoId: number) {
    setVirandoId(perfilAnalisadoId);
    setMensagemVirar(null);
    const resultado = await virarContaDoSetorAction(perfilAnalisadoId, nicho.slug);
    setVirandoId(null);
    if (!resultado.ok) {
      setMensagemVirar({ tipo: "erro", texto: resultado.mensagem ?? "" });
      return;
    }
    setMensagemVirar({ tipo: "sucesso", texto: t.sucessoVirarConta });
    router.refresh();
  }

  async function salvarRegua() {
    setSalvandoRegua(true);
    setMensagemRegua(null);
    const resultado = await atualizarReguaAction(nicho.id, nicho.slug, {
      pisoViews: pisoViewsInput.trim() === "" ? null : Number(pisoViewsInput),
      proporcaoBrasil: proporcaoBrasilInput.trim() === "" ? null : Number(proporcaoBrasilInput) / 100,
      videoSemFalaVale,
    });
    setSalvandoRegua(false);
    if (!resultado.ok) {
      setMensagemRegua({ tipo: "erro", texto: resultado.mensagem ?? "" });
      return;
    }
    setMensagemRegua({ tipo: "sucesso", texto: t.sucessoRegua });
    router.refresh();
  }

  function voltarAoPadraoPiso() {
    setPisoViewsInput("");
  }

  function voltarAoPadraoProporcao() {
    setProporcaoBrasilInput("");
  }

  function voltarAoPadraoSemFala() {
    setVideoSemFalaVale(false);
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
        <h2>{t.reguaTitulo}</h2>
        <p className={styles.ajuda}>{t.reguaAjuda}</p>

        <Campo
          rotulo={t.campoPisoViews}
          ajuda={t.ajudaPisoViews}
          type="number"
          min={0}
          step={1000}
          placeholder={String(padraoPisoViews)}
          value={pisoViewsInput}
          onChange={(e) => setPisoViewsInput(e.target.value)}
        />
        <div className={styles.botoes}>
          <span className={styles.ajuda}>{t.padraoPisoViews(padraoPisoViews.toLocaleString("pt-BR"))}</span>
          <Botao type="button" variante="ghost" onClick={voltarAoPadraoPiso} disabled={pisoViewsInput.trim() === ""}>
            {t.botaoVoltarPadrao}
          </Botao>
        </div>
        {calculandoEfeito ? (
          <p className={styles.ajuda}>{t.calculandoEfeito}</p>
        ) : efeito ? (
          <p className={styles.ajuda}>
            {t.efeitoPisoFrase(efeito.acima7Dias, efeito.acima30Dias)} {t.efeitoSemFalaFrase(efeito.elegiveis7Dias, efeito.elegiveis30Dias)}
          </p>
        ) : null}

        <Campo
          rotulo={t.campoProporcaoBrasil}
          ajuda={t.ajudaProporcaoBrasil}
          type="number"
          min={0}
          max={100}
          step={1}
          placeholder={String(Math.round(padraoProporcaoBrasil * 100))}
          value={proporcaoBrasilInput}
          onChange={(e) => setProporcaoBrasilInput(e.target.value)}
        />
        <div className={styles.botoes}>
          <span className={styles.ajuda}>{t.padraoProporcaoBrasil(`${Math.round(padraoProporcaoBrasil * 100)}%`)}</span>
          <Botao type="button" variante="ghost" onClick={voltarAoPadraoProporcao} disabled={proporcaoBrasilInput.trim() === ""}>
            {t.botaoVoltarPadrao}
          </Botao>
        </div>

        <label className={styles.linhaCheckbox}>
          <input type="checkbox" checked={videoSemFalaVale} onChange={(e) => setVideoSemFalaVale(e.target.checked)} />
          {t.campoVideoSemFalaVale}
        </label>
        <p className={styles.ajuda}>{t.ajudaVideoSemFalaVale}</p>
        <div className={styles.botoes}>
          <span className={styles.ajuda}>{t.padraoVideoSemFalaVale}</span>
          <Botao type="button" variante="ghost" onClick={voltarAoPadraoSemFala} disabled={!videoSemFalaVale}>
            {t.botaoVoltarPadrao}
          </Botao>
        </div>

        {mensagemRegua ? (
          <p
            className={[styles.mensagem, mensagemRegua.tipo === "erro" ? styles.mensagemErro : styles.mensagemSucesso].join(" ")}
            role="status"
          >
            {mensagemRegua.texto}
          </p>
        ) : null}
        <div className={styles.botoes}>
          <Botao type="button" carregando={salvandoRegua} onClick={salvarRegua}>
            {salvandoRegua ? t.salvandoRegua : t.salvarRegua}
          </Botao>
        </div>
      </div>

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
        <h2>{t.perfisIndicadosTitulo}</h2>
        <p className={styles.ajuda}>{t.perfisIndicadosAjuda}</p>
        {perfisIndicados.length === 0 ? (
          <p className={styles.ajuda}>{t.vazioPerfisIndicados}</p>
        ) : (
          <ul className={styles.execucoesLista}>
            {perfisIndicados.map((perfil) => (
              <li key={perfil.id} className={styles.linhaContaSemente}>
                <span>
                  {perfil.rede} · {perfil.handle} · {perfil.clienteNome}
                </span>
                <Botao
                  variante="secundario"
                  carregando={virandoId === perfil.id}
                  onClick={() => virarContaDoSetor(perfil.id)}
                >
                  {virandoId === perfil.id ? t.virandoContaDoSetor : t.virarContaDoSetor}
                </Botao>
              </li>
            ))}
          </ul>
        )}
        {mensagemVirar ? (
          <p
            className={[
              styles.mensagem,
              mensagemVirar.tipo === "erro" ? styles.mensagemErro : styles.mensagemSucesso,
            ].join(" ")}
            role="status"
          >
            {mensagemVirar.texto}
          </p>
        ) : null}
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
